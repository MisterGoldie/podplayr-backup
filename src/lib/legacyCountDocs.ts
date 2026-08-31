import {
  Firestore,
  QueryDocumentSnapshot,
  DocumentSnapshot,
  collection,
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
      return snap.docs;
    })
    .catch(() => {
      mintQueryCache.delete(key);
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

export async function mergeLegacyCountDocs(
  db: Firestore,
  collectionName: 'global_plays' | 'global_likes',
  countField: 'playCount' | 'likeCount',
  nft: NftKeySource,
  canonical = getMediaKey(nft)
): Promise<number> {
  if (!canonical) return 0;

  const ids = new Set<string>();
  for (const source of countMergeSources(nft)) {
    for (const id of getLegacyMediaKeyCandidates(source)) ids.add(id);
  }

  const snaps = await Promise.all(
    [...ids].map(async (id) => {
      try {
        return await getDoc(doc(db, collectionName, id));
      } catch {
        return null;
      }
    })
  );
  const byMint = await findCountDocsByMint(db, collectionName, nft);
  const seen = new Set<string>();
  const existing = [...snaps, ...byMint].filter(isExistingCountSnap).filter((snap) => {
    if (seen.has(snap.id)) return false;
    seen.add(snap.id);
    return true;
  });
  const eventPeak =
    collectionName === 'global_plays' ? await peakFromNftPlayEvents(db, nft) : 0;

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
  best = Math.max(best, eventPeak);

  if (best <= 0 && existing.length === 0) return 0;

  const currentCanonical = canonicalSnap
    ? readStoredCount(canonicalSnap.data() as Record<string, unknown>, countField)
    : 0;
  if (extras === 0 && canonicalSnap?.exists() && best <= currentCanonical) {
    return currentCanonical;
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
