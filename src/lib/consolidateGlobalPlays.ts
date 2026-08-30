import {
  Firestore,
  collection,
  doc,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import {
  getMediaKey,
  normalizeNftContract,
  normalizeNftTokenId,
  type NftKeySource,
} from '../utils/nftIdentity';
import { mergeLegacyCountDocs } from './legacyCountDocs';

function playDocNft(id: string, data: Record<string, unknown>): NftKeySource {
  const nested =
    data.nft && typeof data.nft === 'object' ? (data.nft as Record<string, unknown>) : {};
  const nestedMeta =
    nested.metadata && typeof nested.metadata === 'object'
      ? (nested.metadata as { animation_url?: string })
      : undefined;
  const meta =
    data.metadata && typeof data.metadata === 'object'
      ? (data.metadata as { animation_url?: string })
      : nestedMeta;
  let contract = String(data.nftContract || data.contract || nested.contract || '');
  let tokenId = (data.tokenId ?? nested.tokenId) as string | number;
  if ((!contract || tokenId == null || tokenId === '') && typeof id === 'string') {
    const match = id.match(/^(0x[a-fA-F0-9]{40})-(.+)$/);
    if (match) {
      contract = match[1];
      tokenId = match[2];
    }
  }
  return {
    contract,
    tokenId,
    mediaKey: id,
    audio: String(data.audioUrl || data.audio || nested.audio || ''),
    animationUrl: String(data.animationUrl || nested.animationUrl || ''),
    videoUrl: String(data.videoUrl || nested.videoUrl || ''),
    metadata: meta,
  };
}

/** Fold leftover global_plays docs for one NFT onto the canonical mediaKey. */
export async function mergeLegacyPlayCounts(
  db: Firestore,
  nft: NftKeySource,
  canonical = getMediaKey(nft)
): Promise<number> {
  return mergeLegacyCountDocs(db, 'global_plays', 'playCount', nft, canonical);
}

type PlayRow = {
  id: string;
  data: Record<string, unknown>;
  count: number;
};

/** One-shot: sum every global_plays identity onto its canonical mediaKey. */
export async function consolidateAllGlobalPlays(db: Firestore): Promise<{
  groups: number;
  merged: number;
  deleted: number;
}> {
  const snapshot = await getDocs(collection(db, 'global_plays'));
  const groups = new Map<string, PlayRow[]>();

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() as Record<string, unknown>;
    const key = getMediaKey(playDocNft(docSnap.id, data)) || `id:${docSnap.id}`;
    const group = groups.get(key) || [];
    group.push({
      id: docSnap.id,
      data,
      count: Number(data.playCount) || 0,
    });
    groups.set(key, group);
  }

  let merged = 0;
  let deleted = 0;
  let activeBatch = writeBatch(db);
  let ops = 0;
  const flush = async () => {
    if (ops === 0) return;
    await activeBatch.commit();
    activeBatch = writeBatch(db);
    ops = 0;
  };

  for (const [canonical, group] of groups) {
    if (canonical.startsWith('id:')) continue;
    if (!canonical) continue;

    const already =
      group.length === 1 &&
      group[0].id === canonical &&
      (group[0].data.mediaKey === canonical || !group[0].data.mediaKey);
    if (already) continue;

    group.sort((a, b) => b.count - a.count);
    const keep = group[0];
    const total = group.reduce((sum, row) => sum + row.count, 0);
    const contract = normalizeNftContract(
      String(keep.data.nftContract || keep.data.contract || '')
    );
    const tokenId = normalizeNftTokenId(keep.data.tokenId as string | number);

    activeBatch.set(doc(db, 'global_plays', canonical), {
      ...keep.data,
      mediaKey: canonical,
      playCount: total,
      nftContract: contract || keep.data.nftContract,
      contract: contract || keep.data.contract,
      tokenId: tokenId || keep.data.tokenId,
    });
    ops += 1;
    merged += 1;
    if (ops >= 400) await flush();

    for (const extra of group) {
      if (extra.id === canonical) continue;
      activeBatch.delete(doc(db, 'global_plays', extra.id));
      ops += 1;
      deleted += 1;
      if (ops >= 400) await flush();
    }
  }

  await flush();
  return { groups: groups.size, merged, deleted };
}
