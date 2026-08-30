import {
  Firestore,
  QueryDocumentSnapshot,
  DocumentData,
  collection,
  doc,
  getDoc,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import {
  getLegacyMediaKeyCandidates,
  getMediaKey,
  getNftIdentityKey,
  normalizeNftContract,
  normalizeNftTokenId,
  type NftKeySource,
} from '../utils/nftIdentity';
import { sameLikedTrack, getLikeDedupeKey } from '../utils/likeDedupe';
import { likeTimeFromFields, snapshotCreateMillis } from '../utils/likeTime';
import { mergeLegacyCountDocs } from './legacyCountDocs';

/** Fold leftover global_likes docs for one NFT onto the canonical mediaKey. */
export async function mergeLegacyLikeCounts(
  db: Firestore,
  nft: NftKeySource,
  canonical = getMediaKey(nft)
): Promise<number> {
  return mergeLegacyCountDocs(db, 'global_likes', 'likeCount', nft, canonical);
}

const consolidatedUsers = new Set<string>();

function likeDocNft(id: string, data: DocumentData): NftKeySource {
  const nested = data.nft && typeof data.nft === 'object' ? data.nft : {};
  return {
    contract: data.contract || data.nftContract || nested.contract,
    tokenId: data.tokenId || nested.tokenId,
    mediaKey: data.mediaKey || id,
    audio: data.audioUrl || nested.audio || data.audio,
    animationUrl: data.animationUrl || nested.animationUrl || nested.metadata?.animation_url,
    videoUrl: data.videoUrl || nested.videoUrl,
    metadata: data.metadata || nested.metadata,
  };
}

function likeDocRow(id: string, data: DocumentData) {
  const nested = data.nft && typeof data.nft === 'object' ? data.nft : {};
  return {
    contract: data.contract || data.nftContract || nested.contract,
    tokenId: data.tokenId || nested.tokenId,
    name: data.name || nested.name,
    image: data.image || nested.image,
    audio: data.audioUrl || nested.audio,
    metadata: data.metadata || nested.metadata,
    mediaKey: data.mediaKey || id,
  };
}

export async function findExistingUserLikeIds(
  db: Firestore,
  userId: string,
  nft: NftKeySource & { audio?: string; metadata?: { animation_url?: string } }
): Promise<string[]> {
  const candidates = getLegacyMediaKeyCandidates(nft);
  const found = await Promise.all(
    candidates.map(async (id) => {
      try {
        const snap = await getDoc(doc(db, 'users', userId, 'likes', id));
        return snap.exists() ? id : '';
      } catch {
        return '';
      }
    })
  );

  const extras: string[] = [];
  try {
    const snapshot = await getDocs(collection(db, 'users', userId, 'likes'));
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const nested = data.nft && typeof data.nft === 'object' ? data.nft : {};
      const row = {
        contract: data.contract || data.nftContract || nested.contract,
        tokenId: data.tokenId || nested.tokenId,
        name: data.name || nested.name,
        image: data.image || nested.image,
        audio: data.audioUrl || nested.audio,
        metadata: data.metadata || nested.metadata,
        mediaKey: docSnap.id,
      };
      if (sameLikedTrack(row, nft)) extras.push(docSnap.id);
    }
  } catch {
    // Candidate lookup above is enough if the full scan fails.
  }

  return [...new Set([...found, ...extras].filter(Boolean))];
}

/**
 * Rewrite split like docs (old contract-tokenId ids, mixed-case hashes, 0x5 vs 5)
 * onto the canonical mediaKey. Safe to call on every library load; no-ops after
 * the first successful pass in this session.
 */
export async function consolidateUserLikes(
  db: Firestore,
  userId: string,
  docs: Array<QueryDocumentSnapshot<DocumentData> | { id: string; data: () => DocumentData }>
): Promise<number> {
  if (!userId || consolidatedUsers.has(userId) || docs.length === 0) return 0;

  const groups = new Map<string, Array<{ id: string; data: DocumentData; createdMs: number }>>();
  for (const docSnap of docs) {
    const data = docSnap.data();
    const createdMs = snapshotCreateMillis(docSnap);
    const row = likeDocRow(docSnap.id, data);
    const identity =
      getLikeDedupeKey(row) || getNftIdentityKey(likeDocNft(docSnap.id, data));
    if (!identity) continue;
    const group = groups.get(identity) || [];
    group.push({ id: docSnap.id, data, createdMs });
    groups.set(identity, group);
  }

  let activeBatch = writeBatch(db);
  let activeOps = 0;
  let ops = 0;
  const touch = async () => {
    if (activeOps >= 450) {
      await activeBatch.commit();
      activeBatch = writeBatch(db);
      activeOps = 0;
    }
  };

  try {
    for (const group of groups.values()) {
      group.sort((a, b) => {
        const timeA = likeTimeFromFields(a.data) || a.createdMs;
        const timeB = likeTimeFromFields(b.data) || b.createdMs;
        return timeB - timeA;
      });
      const keep = group[0];
      const canonical = getMediaKey(likeDocNft(keep.id, keep.data));
      if (!canonical) continue;
      const originalMs = group.reduce((earliest, item) => {
        const ms = likeTimeFromFields(item.data) || item.createdMs;
        if (!ms) return earliest;
        if (!earliest) return ms;
        return Math.min(earliest, ms);
      }, 0);
      const alreadyCanonical =
        group.length === 1 &&
        keep.id === canonical &&
        (keep.data.mediaKey === canonical || !keep.data.mediaKey);
      const missingLikedAt = originalMs > 0 && !likeTimeFromFields(keep.data);

      if (alreadyCanonical && !missingLikedAt) continue;

      const contract = normalizeNftContract(likeDocNft(keep.id, keep.data).contract);
      const tokenId = normalizeNftTokenId(likeDocNft(keep.id, keep.data).tokenId);
      const nested =
        keep.data.nft && typeof keep.data.nft === 'object' ? { ...keep.data.nft } : null;
      if (nested) {
        nested.contract = contract;
        nested.tokenId = tokenId;
      }

      activeBatch.set(doc(db, 'users', userId, 'likes', canonical), {
        ...keep.data,
        mediaKey: canonical,
        contract,
        nftContract: contract,
        tokenId,
        ...(nested ? { nft: nested } : {}),
        ...(originalMs
          ? {
              likedTimestamp: originalMs,
              likedAt: keep.data.likedAt || new Date(originalMs).toISOString(),
            }
          : {}),
      });
      activeOps += 1;
      ops += 1;
      await touch();

      for (const extra of group) {
        if (extra.id === canonical) continue;
        activeBatch.delete(doc(db, 'users', userId, 'likes', extra.id));
        activeOps += 1;
        ops += 1;
        await touch();
      }
    }

    if (activeOps > 0) {
      await activeBatch.commit();
    }

    consolidatedUsers.add(userId);
    return ops;
  } catch (error) {
    console.warn('Failed to consolidate user likes for', userId, error);
    return ops;
  }
}

export async function consolidateUserLikesCollection(
  db: Firestore,
  userId: string
): Promise<number> {
  const snapshot = await getDocs(collection(db, 'users', userId, 'likes'));
  return consolidateUserLikes(db, userId, snapshot.docs);
}
