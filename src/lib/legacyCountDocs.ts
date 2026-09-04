import {
  Firestore,
  QueryDocumentSnapshot,
  DocumentSnapshot,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  contractCasingVariants,
  getLegacyMediaKeyCandidates,
  getMediaKey,
  normalizeNftContract,
  normalizeNftTokenId,
  type NftKeySource,
} from '../utils/nftIdentity';
import { findFeaturedNft } from '../data/featuredNfts';
import { getLikeDedupeKey, sameLikedTrack } from '../utils/likeDedupe';
import { likesDebug } from '../utils/likesDebug';
import { originUrlFromMuxPlayback } from './mediaCdn';

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function muxOriginAudio(nft: NftKeySource): string {
  return (
    originUrlFromMuxPlayback(nft.audio) ||
    originUrlFromMuxPlayback(nft.animationUrl) ||
    originUrlFromMuxPlayback(nft.videoUrl) ||
    originUrlFromMuxPlayback(nft.metadata?.animation_url) ||
    ''
  );
}

function featuredForCount(nft: NftKeySource) {
  return findFeaturedNft({
    contract: nft.contract || '',
    tokenId: nft.tokenId == null ? '' : String(nft.tokenId),
    audio: nft.audio || '',
    metadata: nft.metadata,
    name: (nft as { name?: string }).name || '',
  });
}

function isExistingCountSnap(
  snap: DocumentSnapshot | QueryDocumentSnapshot | null
): snap is DocumentSnapshot | QueryDocumentSnapshot {
  return Boolean(snap?.exists());
}

/** Every historical identity we might have written a count doc under. */
export function countMergeSources(nft: NftKeySource): NftKeySource[] {
  const featured = featuredForCount(nft);
  const origin = muxOriginAudio(nft) || muxOriginAudio(featured || {});
  const sources: NftKeySource[] = [nft];
  if (origin) {
    sources.push({
      ...nft,
      audio: origin,
      animationUrl: origin,
      metadata: { ...(nft.metadata || {}), animation_url: origin },
    });
  }
  if (featured) {
    sources.push({
      contract: featured.contract,
      tokenId: featured.tokenId,
      mediaKey: nft.mediaKey,
      audio: featured.audio || origin || nft.audio,
      animationUrl: featured.animationUrl || featured.metadata?.animation_url,
      videoUrl: featured.videoUrl,
      metadata: featured.metadata,
    });
  }
  return sources;
}

const mintQueryCache = new Map<string, Promise<QueryDocumentSnapshot[]>>();

function mintQueryKey(collectionName: string, field: string, value: string) {
  return `${collectionName}:${field}:${value}`;
}

function readStoredCount(data: Record<string, unknown>, countField: string): number {
  return (
    Number(data[countField]) ||
    Number(data.playCount) ||
    Number(data.plays) ||
    Number(data.likeCount) ||
    Number(data.count) ||
    0
  );
}

async function queryMintField(
  db: Firestore,
  collectionName: string,
  field: string,
  value: string
): Promise<QueryDocumentSnapshot[]> {
  const key = mintQueryKey(collectionName, field, value);
  const cached = mintQueryCache.get(key);
  if (cached) return cached;
  const pending = getDocs(query(collection(db, collectionName), where(field, '==', value)))
    .then((snap) => {
      if (snap.docs.length === 0) mintQueryCache.delete(key);
      if (collectionName === 'global_likes') {
        likesDebug.log('global_likes field query', {
          field,
          value,
          size: snap.size,
          ids: snap.docs.slice(0, 20).map((d) => d.id),
        });
      }
      return snap.docs;
    })
    .catch((error) => {
      mintQueryCache.delete(key);
      likesDebug.error('count-doc field query FAILED', error, {
        collectionName,
        field,
        value,
      });
      return [] as QueryDocumentSnapshot[];
    });
  mintQueryCache.set(key, pending);
  return pending;
}

export async function findCountDocsByMint(
  db: Firestore,
  collectionName: string,
  nft: NftKeySource
): Promise<QueryDocumentSnapshot[]> {
  const contract = normalizeNftContract(nft.contract);
  const tokenId = normalizeNftTokenId(nft.tokenId);
  if (!contract || !tokenId) return [];

  const featured = featuredForCount(nft);
  const contracts = uniqueStrings([
    ...contractCasingVariants(nft.contract || ''),
    ...(featured?.contract ? contractCasingVariants(featured.contract) : []),
  ]);
  const tokens = new Set(
    [tokenId, normalizeNftTokenId(featured?.tokenId)].filter(Boolean) as string[]
  );
  const names = uniqueStrings([
    (nft as { name?: string }).name,
    featured?.name,
  ]);

  const found: QueryDocumentSnapshot[] = [];
  const seen = new Set<string>();
  const allowedContracts = new Set(
    [contract, normalizeNftContract(featured?.contract)].filter(Boolean) as string[]
  );

  const consider = (docSnap: QueryDocumentSnapshot) => {
    if (seen.has(docSnap.id)) return;
    const data = docSnap.data();
    const nested =
      data.nft && typeof data.nft === 'object'
        ? (data.nft as { contract?: string; tokenId?: string | number; name?: string })
        : {};
    const docContract = normalizeNftContract(
      data.nftContract || data.contract || nested.contract
    );
    const docToken = normalizeNftTokenId(data.tokenId ?? nested.tokenId);
    const docName = String(data.name || nested.name || '');
    const nameHit = !!docName && names.some((n) => n && docName === n);
    if (docToken && !tokens.has(docToken) && !nameHit) return;
    if (docContract && !allowedContracts.has(docContract) && !nameHit) return;
    if (!docToken && !nameHit) return;
    seen.add(docSnap.id);
    found.push(docSnap);
  };

  // Top-level contract fields (likes) and nested nft.contract (older plays).
  const contractFields = ['nftContract', 'contract', 'nft.contract'] as const;
  for (const field of contractFields) {
    for (const value of contracts) {
      const docs = await queryMintField(db, collectionName, field, value);
      docs.forEach(consider);
    }
  }
  for (const name of names) {
    const docs = await queryMintField(db, collectionName, 'name', name);
    docs.forEach(consider);
  }
  return found;
}

/** Highest running total (or event count) in the nft_plays event log. */
export async function peakFromNftPlayEvents(
  db: Firestore,
  nft: NftKeySource
): Promise<number> {
  const tokenId = normalizeNftTokenId(nft.tokenId);
  if (!nft.contract || !tokenId) return 0;
  const featured = featuredForCount(nft);
  const contracts = uniqueStrings([
    ...contractCasingVariants(nft.contract),
    ...(featured?.contract ? contractCasingVariants(featured.contract) : []),
  ]);
  const names = uniqueStrings([(nft as { name?: string }).name, featured?.name]);
  const tokens = new Set(
    [tokenId, normalizeNftTokenId(featured?.tokenId)].filter(Boolean) as string[]
  );

  let peak = 0;
  let events = 0;
  const seen = new Set<string>();
  const eat = (docs: QueryDocumentSnapshot[]) => {
    for (const docSnap of docs) {
      if (seen.has(docSnap.id)) continue;
      const data = docSnap.data();
      const nested =
        data.nft && typeof data.nft === 'object'
          ? (data.nft as { contract?: string; tokenId?: string | number; name?: string })
          : {};
      const docToken = normalizeNftTokenId(data.tokenId ?? nested.tokenId);
      const docName = String(data.name || nested.name || '');
      const nameHit = !!docName && names.some((n) => n && docName === n);
      if (docToken && !tokens.has(docToken) && !nameHit) continue;
      seen.add(docSnap.id);
      events += 1;
      peak = Math.max(peak, readStoredCount(data, 'playCount'));
    }
  };

  for (const field of ['nftContract', 'contract'] as const) {
    for (const value of contracts) {
      eat(await queryMintField(db, 'nft_plays', field, value));
    }
  }
  for (const name of names) {
    eat(await queryMintField(db, 'nft_plays', 'name', name));
  }
  return Math.max(peak, events);
}

const missingGroupIndex = new Set<string>();

function indexUrlFromError(error: unknown): string {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: string }).message)
      : String(error);
  return message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/)?.[0] || message;
}

async function queryLikesGroup(
  db: Firestore,
  field: string,
  value: string | number
): Promise<QueryDocumentSnapshot[]> {
  likesDebug.log('collectionGroup likes query', { field, value });
  try {
    const snap = await getDocs(query(collectionGroup(db, 'likes'), where(field, '==', value)));
    likesDebug.log('collectionGroup likes result', {
      field,
      value,
      size: snap.size,
      paths: snap.docs.slice(0, 25).map((d) => d.ref.path),
    });
    return snap.docs;
  } catch (error) {
    if (!missingGroupIndex.has(field)) {
      missingGroupIndex.add(field);
      likesDebug.log('collectionGroup index missing (not fatal)', {
        field,
        url: indexUrlFromError(error),
      });
    }
    return [];
  }
}

async function queryUserLikesCollection(
  db: Firestore,
  field: string,
  value: string
): Promise<QueryDocumentSnapshot[]> {
  likesDebug.log('user_likes collection query', { field, value });
  try {
    const snap = await getDocs(query(collection(db, 'user_likes'), where(field, '==', value)));
    likesDebug.log('user_likes collection result', {
      field,
      value,
      size: snap.size,
      ids: snap.docs.slice(0, 25).map((d) => d.id),
    });
    return snap.docs;
  } catch (error) {
    likesDebug.error('user_likes collection query FAILED', error, { field, value });
    return [];
  }
}

/** Count remaining user like docs for this track, including old mediaKey ids. */
export async function peakFromUserLikes(
  db: Firestore,
  nft: NftKeySource
): Promise<number> {
  const featured = featuredForCount(nft);
  const ids = new Set<string>();
  for (const source of countMergeSources(nft)) {
    for (const id of getLegacyMediaKeyCandidates(source)) ids.add(id);
  }

  const names = uniqueStrings([(nft as { name?: string }).name, featured?.name]);
  const canonical = getMediaKey(nft);

  likesDebug.log('peakFromUserLikes start', {
    name: (nft as { name?: string }).name,
    contract: nft.contract,
    tokenId: nft.tokenId,
    canonical,
    featured: featured
      ? { name: featured.name, contract: featured.contract, tokenId: featured.tokenId }
      : null,
    nftDedupeKey: getLikeDedupeKey(nft as { name?: string }),
    featuredDedupeKey: featured ? getLikeDedupeKey(featured) : '',
    candidateIds: [...ids],
    names,
  });

  const seen = new Set<string>();
  const rejected: Array<Record<string, unknown>> = [];
  const consider = (docSnap: DocumentSnapshot) => {
    if (!docSnap.exists() || seen.has(docSnap.ref.path)) return;
    const data = docSnap.data();
    const nested =
      data.nft && typeof data.nft === 'object'
        ? (data.nft as Record<string, unknown>)
        : {};
    const row = {
      contract: (data.contract || data.nftContract || nested.contract) as string,
      tokenId: (data.tokenId ?? nested.tokenId) as string | number,
      name: String(data.name || nested.name || ''),
      image: String(data.image || nested.image || ''),
      audio: String(data.audioUrl || nested.audio || ''),
      metadata: (data.metadata || nested.metadata) as { animation_url?: string } | undefined,
      mediaKey: String(data.mediaKey || docSnap.id),
    };
    const idHit = ids.has(docSnap.id) || ids.has(row.mediaKey);
    const trackHit = sameLikedTrack(row, nft) || (featured ? sameLikedTrack(row, featured) : false);
    if (trackHit || idHit) {
      seen.add(docSnap.ref.path);
      if (seen.size <= 20) {
        likesDebug.log('like doc ACCEPTED', {
          path: docSnap.ref.path,
          id: docSnap.id,
          reason: trackHit ? 'sameLikedTrack' : 'candidate-id',
          row,
          dedupeKey: getLikeDedupeKey(row),
        });
      }
      return;
    }
    if (rejected.length < 30) {
      rejected.push({
        path: docSnap.ref.path,
        id: docSnap.id,
        row,
        dedupeKey: getLikeDedupeKey(row),
      });
    }
  };

  const hashedIds = [...ids].filter((id) => /^[a-f0-9]{32}$/i.test(id));
  likesDebug.log('collectionGroup mediaKey ids that look like hashes', hashedIds);

  const lookups: Array<Promise<QueryDocumentSnapshot[]>> = [
    ...hashedIds.map((id) => queryLikesGroup(db, 'mediaKey', id)),
    ...names.map((name) => queryLikesGroup(db, 'name', name)),
    ...hashedIds.map((id) => queryUserLikesCollection(db, 'mediaKey', id)),
    ...names.map((name) => queryUserLikesCollection(db, 'name', name)),
  ];

  const results = await Promise.all(lookups);
  const rawHits = results.reduce((sum, docs) => sum + docs.length, 0);
  for (const docs of results) {
    docs.forEach(consider);
  }

  likesDebug.log('peakFromUserLikes done', {
    rawHits,
    accepted: seen.size,
    acceptedPaths: [...seen],
    rejectedSample: rejected,
  });
  return seen.size;
}

export async function mergeLegacyCountDocs(
  db: Firestore,
  collectionName: 'global_plays' | 'global_likes',
  countField: 'playCount' | 'likeCount',
  nft: NftKeySource,
  canonical = getMediaKey(nft)
): Promise<number> {
  if (!canonical) return 0;
  const debugLikes = collectionName === 'global_likes';

  const ids = new Set<string>();
  for (const source of countMergeSources(nft)) {
    for (const id of getLegacyMediaKeyCandidates(source)) ids.add(id);
  }

  if (debugLikes) {
    likesDebug.log('mergeLegacyCountDocs start', {
      collectionName,
      canonical,
      name: (nft as { name?: string }).name,
      contract: nft.contract,
      tokenId: nft.tokenId,
      candidateIds: [...ids],
    });
  }

  const missingIds: string[] = [];
  const presentDocs: Array<{ id: string; likeCount: number }> = [];
  const snaps = await Promise.all(
    [...ids].map(async (id) => {
      try {
        const snap = await getDoc(doc(db, collectionName, id));
        if (debugLikes) {
          if (snap.exists()) {
            presentDocs.push({
              id,
              likeCount: readStoredCount(snap.data() as Record<string, unknown>, countField),
            });
          } else {
            missingIds.push(id);
          }
        }
        return snap;
      } catch (error) {
        if (debugLikes) likesDebug.error('global_likes getDoc FAILED', error, { id });
        return null;
      }
    })
  );
  if (debugLikes) {
    likesDebug.log('global_likes getDoc summary', {
      present: presentDocs,
      missingCount: missingIds.length,
      missingIds,
    });
  }
  const byMint = await findCountDocsByMint(db, collectionName, nft);
  const seen = new Set<string>();
  const existing = [...snaps, ...byMint].filter(isExistingCountSnap).filter((snap) => {
    if (seen.has(snap.id)) return false;
    seen.add(snap.id);
    return true;
  });
  const eventPeak =
    collectionName === 'global_plays' ? await peakFromNftPlayEvents(db, nft) : 0;
  const likePeak =
    collectionName === 'global_likes' ? await peakFromUserLikes(db, nft) : 0;

  const canonicalSnap = existing.find((snap) => snap.id === canonical) || null;
  let best = 0;
  let keep = canonicalSnap?.data() || existing[0]?.data() || {};
  const batch = writeBatch(db);
  let extras = 0;

  for (const snap of existing) {
    const count = readStoredCount(snap.data() as Record<string, unknown>, countField);
    best = Math.max(best, count);
    if (count >= readStoredCount(keep as Record<string, unknown>, countField)) {
      keep = snap.data() || keep;
    }
    if (snap.id !== canonical) {
      batch.delete(snap.ref);
      extras += 1;
    }
  }
  best = Math.max(best, eventPeak, likePeak);

  const currentCanonical = canonicalSnap
    ? readStoredCount(canonicalSnap.data() as Record<string, unknown>, countField)
    : 0;

  if (debugLikes) {
    likesDebug.log('mergeLegacyCountDocs totals', {
      existingIds: existing.map((snap) => ({
        id: snap.id,
        likeCount: readStoredCount(snap.data() as Record<string, unknown>, countField),
      })),
      extras,
      likePeak,
      eventPeak,
      best,
      currentCanonical,
      canonicalExists: Boolean(canonicalSnap?.exists()),
    });
  }

  if (best <= 0 && existing.length === 0) {
    if (debugLikes) likesDebug.log('mergeLegacyCountDocs skip — no docs and peak is 0');
    return 0;
  }

  if (extras === 0 && canonicalSnap?.exists() && best <= currentCanonical) {
    if (debugLikes) {
      likesDebug.log('mergeLegacyCountDocs skip write — canonical already has best', {
        currentCanonical,
        best,
      });
    }
    return currentCanonical;
  }

  if (debugLikes) {
    likesDebug.log('mergeLegacyCountDocs WRITE global_likes', {
      canonical,
      likeCount: best,
      extrasDeleted: extras,
    });
  }

  batch.set(doc(db, collectionName, canonical), {
    ...keep,
    mediaKey: canonical,
    [countField]: best,
    nftContract: normalizeNftContract(nft.contract) || keep.nftContract,
    contract: normalizeNftContract(nft.contract) || keep.contract,
    tokenId: normalizeNftTokenId(nft.tokenId) || keep.tokenId,
    name: (nft as { name?: string }).name || keep.name,
  });
  await batch.commit();
  return best;
}
