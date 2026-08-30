import { createHash } from 'crypto';

export type NftKeySource = {
  contract?: string;
  tokenId?: string | number;
  mediaKey?: string;
  audio?: string;
  animationUrl?: string;
  videoUrl?: string;
  metadata?: { animation_url?: string };
};

const mediaKeyCache = new Map<string, string>();

export function normalizeNftContract(contract?: string | null): string {
  return (contract || '').trim().toLowerCase();
}

/** Decimal string for EVM ids (`5`, `0x5`, `0x05`, 64-char padded hex → `5`). Leave Solana mints alone. */
export function normalizeNftTokenId(tokenId?: string | number | null): string {
  if (tokenId === undefined || tokenId === null || tokenId === '') return '';
  const raw = String(tokenId).trim();
  if (/^0x[0-9a-f]+$/i.test(raw)) {
    try {
      return BigInt(raw).toString(10);
    } catch {
      return raw.toLowerCase();
    }
  }
  // Alchemy often stores uint256 as 64 hex chars with no 0x.
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    try {
      return BigInt(`0x${raw}`).toString(10);
    } catch {
      return raw.toLowerCase();
    }
  }
  if (/^\d+$/.test(raw)) {
    return raw.replace(/^0+(?=\d)/, '');
  }
  return raw;
}

export function getNftIdentityKey(nft?: NftKeySource | null): string {
  if (!nft) return '';
  const contract = normalizeNftContract(nft.contract);
  const tokenId = normalizeNftTokenId(nft.tokenId);
  if (!contract || !tokenId) return '';
  return `${contract}-${tokenId}`;
}

export function hashMediaKeySource(source: string): string {
  return createHash('sha256').update(source).digest('hex').substring(0, 32);
}

/** Stable id for the actual audio/video file (IPFS CID, Arweave tx, else normalized URL). */
export function getMediaAssetId(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  const s = url.trim().split('?')[0].split('#')[0];
  if (!s || /^(data:|blob:)/i.test(s)) return '';

  const ipfs =
    s.match(/(?:\/ipfs\/|ipfs:\/\/)(bafy[a-z0-9]+|Qm[1-9A-HJ-NP-Za-km-z]{44,})/i) ||
    s.match(/\b(bafy[a-z0-9]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44,})\b/);
  if (ipfs?.[1]) return `ipfs:${ipfs[1].toLowerCase()}`;

  const ar =
    s.match(/arweave\.net\/([A-Za-z0-9_-]{43,})/i) ||
    s.match(/ar:\/\/([A-Za-z0-9_-]{43,})/);
  if (ar?.[1]) return `ar:${ar[1]}`;

  if (/^https?:\/\//i.test(s) || s.startsWith('ipfs://') || s.startsWith('ar://')) {
    return `url:${s.replace(/^https?:\/\//i, '').toLowerCase()}`;
  }
  return '';
}

export function getNftMediaAssetId(nft?: NftKeySource | null): string {
  if (!nft) return '';
  const urls = [nft.audio, nft.animationUrl, nft.videoUrl, nft.metadata?.animation_url];
  let generic = '';
  for (const url of urls) {
    const id = getMediaAssetId(url);
    if (!id) continue;
    if (id.startsWith('ipfs:') || id.startsWith('ar:')) return id;
    if (!generic) generic = id;
  }
  return generic;
}

function cachedHash(source: string): string {
  const cached = mediaKeyCache.get(source);
  if (cached) return cached;
  const mediaKey = hashMediaKeySource(source);
  mediaKeyCache.set(source, mediaKey);
  return mediaKey;
}

/** True only for a real EVM contract address — excludes placeholders like
 * "pending" used by curated/off-chain content (podcast episodes etc.) that
 * has no on-chain identity at all. */
function isRealOnChainContract(contract?: string | null): boolean {
  return /^0x[0-9a-f]{40}$/i.test((contract || '').trim());
}

/**
 * Firestore id for likes and plays.
 *
 * Prefers the STABLE on-chain identity (contract-tokenId) whenever we have
 * one. A token's address+id never changes, but the media URL it resolves to
 * can (IPFS gateway swap, CDN migration, Alchemy re-hosting a video still,
 * etc.) — keying on the resolved URL meant every one of those resolution
 * changes silently orphaned that token's historical play/like counts under
 * an unreachable old key. Identity-first fixes that permanently, at the cost
 * of no longer merging counts across multiple token ids that intentionally
 * share identical media (e.g. reprints/editions) — those now count per-token.
 *
 * Falls back to the media asset for curated/off-chain content with no real
 * on-chain identity (e.g. podcast episodes keyed by a placeholder "pending"
 * contract) — same file → same key there, since that's the only identity
 * such content has.
 */
export function getMediaKey(nft?: NftKeySource | null): string {
  if (!nft) return '';

  if (isRealOnChainContract(nft.contract)) {
    const onChainIdentity = getNftIdentityKey(nft);
    if (onChainIdentity) return cachedHash(onChainIdentity);
  }

  const asset = getNftMediaAssetId(nft);
  if (asset) return cachedHash(`media:${asset}`);

  const identity = getNftIdentityKey(nft);
  if (identity) return cachedHash(identity);

  const fallback = `${normalizeNftContract(nft.contract)}-${String(nft.tokenId ?? '')}`;
  if (fallback === '-') return '';
  return hashMediaKeySource(fallback);
}

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

function tokenIdVariants(tokenId: string): string[] {
  const variants = new Set<string>([tokenId]);
  variants.add(tokenId.replace(/^0x+/, '0x'));
  variants.add(tokenId.replace(/^0x/i, ''));
  if (/^0x[0-9a-f]+$/i.test(tokenId)) {
    try {
      variants.add(BigInt(tokenId).toString(10));
    } catch {
      // ignore
    }
  }
  if (/^\d+$/.test(tokenId)) {
    variants.add(tokenId.replace(/^0+(?=\d)/, ''));
    try {
      variants.add(`0x${BigInt(tokenId).toString(16)}`);
    } catch {
      // ignore
    }
  }
  return [...variants];
}

function mintHashCandidates(nft: NftKeySource): string[] {
  if (!nft.contract || nft.tokenId === undefined || nft.tokenId === null || String(nft.tokenId) === '') {
    return [];
  }
  const contracts = uniqueStrings([nft.contract, nft.contract.toLowerCase()]);
  const tokens = tokenIdVariants(String(nft.tokenId));
  const keys: string[] = [];
  for (const contract of contracts) {
    for (const token of tokens) {
      const source = `${contract}-${token}`;
      keys.push(hashMediaKeySource(source));
      keys.push(source);
    }
  }
  return keys;
}

/** Current content key, old mint hashes, pre-hash contract-tokenId, and URL slugs. */
export function getLegacyMediaKeyCandidates(nft?: NftKeySource | null): string[] {
  if (!nft) return [];
  const keys = new Set<string>();
  const canonical = getMediaKey(nft);
  if (canonical) keys.add(canonical);
  if (nft.mediaKey) keys.add(nft.mediaKey);

  for (const id of mintHashCandidates(nft)) keys.add(id);

  const asset = getNftMediaAssetId(nft);
  // Pre-fix canonical key for real on-chain NFTs was media-asset-based —
  // keep it as a healing candidate so any doc that predates the identity-
  // first switch (or slips through a future edge case) still gets found.
  if (asset) keys.add(hashMediaKeySource(`media:${asset}`));
  if (asset?.startsWith('ipfs:')) {
    keys.add(`ipfs_${asset.slice(5)}`);
  }
  if (asset?.startsWith('ar:')) {
    const id = asset.slice(3);
    keys.add(`arweave_net_${id}`);
    keys.add(`arweave.net_${id}`);
    keys.add(`arweave_net_${id.toLowerCase()}`);
    keys.add(`arweave.net_${id.toLowerCase()}`);
  }

  return [...keys];
}

export function sameNftIdentity(a?: NftKeySource | null, b?: NftKeySource | null): boolean {
  const keyA = getMediaKey(a);
  const keyB = getMediaKey(b);
  if (keyA && keyB && keyA === keyB) return true;
  const identityA = getNftIdentityKey(a);
  const identityB = getNftIdentityKey(b);
  return Boolean(identityA && identityB && identityA === identityB);
}

export function uniqueNftsByIdentity<T extends NftKeySource>(nfts: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const nft of nfts) {
    if (!nft) continue;
    const id = getMediaKey(nft) || getNftIdentityKey(nft) || nft.mediaKey || '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const canonical = getMediaKey(nft);
    unique.push(canonical && nft.mediaKey !== canonical ? { ...nft, mediaKey: canonical } : nft);
  }
  return unique;
}
