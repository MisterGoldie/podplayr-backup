/**
 * Defenses against airdropped spam NFTs that attach audio/video (or HTML
 * that pretends to be media) so they show up in a playable collection.
 *
 * Do NOT use Alchemy's blanket isSpam — on music wallets it false-positives
 * real membership/event passes (HighAirdropPercent / SuspiciousMetadata alone).
 * Prefer phishing CTA text + the dual Spammy+Suspicious empty-metadata pattern.
 */

const HTML_OR_SCRIPT_EXT_RE = /\.(html?|php|aspx?|js|mjs)(?:\?|#|$)/i;
const SVG_EXT_RE = /\.svg(?:\?|#|$)/i;
const BLOCKED_PROTOCOL_RE = /^(javascript|vbscript|file):/i;

/**
 * Extra contract denylist (lowercase). Add confirmed phishing/spam contracts
 * that ship playable media.
 */
export const BLOCKED_NFT_CONTRACTS = new Set<string>([
  // Base "SCAN ME to claim rewards" phishing airdrop (ERC-1155 video bait)
  '0x695d15fbc6ffd0b4617496bf2e00b8ae01aa5b99',
]);

/** Phishing / claim-bait phrases common on spam media airdrops. */
const PHISHING_CTA_RE =
  /\b(scan\s*me|scan\s*to\s*claim|claim\s*(your\s*)?(rewards?|airdrop|prize|tokens?|nft)|tap\s*to\s*claim|click\s*to\s*claim|visit\s*to\s*claim|free\s*claim|claim\s*now|connect\s*wallet\s*to\s*claim|mint\s*to\s*claim)\b/i;

export const isBlockedNftContract = (contract?: string | null): boolean => {
  if (!contract) return false;
  return BLOCKED_NFT_CONTRACTS.has(contract.toLowerCase());
};

type SpamHeuristicNft = {
  contract?: string | null;
  name?: string | null;
  description?: string | null;
  collection?: { name?: string | null } | null;
  metadata?: {
    name?: string | null;
    description?: string | null;
    attributes?: Array<{ trait_type?: string; value?: unknown }> | null;
  } | null;
  spamInfo?: {
    isSpam?: boolean | string;
    classifications?: string[];
  } | null;
  spamClassifications?: string[] | null;
};

const asBool = (value: boolean | string | undefined): boolean =>
  value === true || value === 'true';

const textBlob = (nft: SpamHeuristicNft): string =>
  [
    nft.name,
    nft.description,
    nft.collection?.name,
    nft.metadata?.name,
    nft.metadata?.description,
  ]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join('\n');

const hasBlankDescription = (nft: SpamHeuristicNft): boolean =>
  !String(nft.description || nft.metadata?.description || '').trim();

const hasPlaceholderAttributes = (nft: SpamHeuristicNft): boolean => {
  const attrs = nft.metadata?.attributes;
  if (!attrs?.length) return true;
  return attrs.every(
    (a) => !String(a?.trait_type || '').trim() && !String(a?.value ?? '').trim()
  );
};

const classificationSet = (nft: SpamHeuristicNft): Set<string> => {
  const raw = [
    ...(nft.spamInfo?.classifications || []),
    ...(nft.spamClassifications || []),
  ];
  return new Set(raw.map((c) => String(c).toLowerCase()));
};

/**
 * High-precision spam detector for playable phishing airdrops.
 * Returns true when this NFT should be hidden from media grids.
 */
export const isPhishingSpamNft = (nft: SpamHeuristicNft | null | undefined): boolean => {
  if (!nft) return false;
  if (isBlockedNftContract(nft.contract)) return true;

  if (PHISHING_CTA_RE.test(textBlob(nft))) return true;

  // Alchemy: both SpammyMetadata + SuspiciousMetadata with empty/placeholder
  // meta matches "SCAN ME…" bait. Alone, SuspiciousMetadata hits real passes
  // (AirOrb / GA Event Pass) — do not use isSpam by itself.
  const classes = classificationSet(nft);
  if (
    classes.has('spammymetadata') &&
    classes.has('suspiciousmetadata') &&
    hasBlankDescription(nft) &&
    hasPlaceholderAttributes(nft)
  ) {
    return true;
  }

  return false;
};

/** @deprecated Prefer isPhishingSpamNft — Alchemy isSpam alone is too noisy. */
export const isAlchemySpamNft = (nft: SpamHeuristicNft | null | undefined): boolean =>
  asBool(nft?.spamInfo?.isSpam);

/** javascript: / data:html — never load as src on img, audio, or video. */
export const isDangerousResourceUrl = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  const lower = url.trim().toLowerCase();
  if (!lower) return false;
  if (BLOCKED_PROTOCOL_RE.test(lower)) return true;
  if (lower.startsWith('data:')) {
    return !/^data:(audio|video|image)\//i.test(lower);
  }
  return false;
};

/** True when metadata is trying to execute or render a document, not play audio/video. */
export const isUnsafePlaybackUrl = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (isDangerousResourceUrl(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  if (HTML_OR_SCRIPT_EXT_RE.test(lower) || SVG_EXT_RE.test(lower)) return true;
  if (lower.includes('text/html') || lower.includes('application/javascript')) return true;
  if (lower.includes('text/javascript') || lower.includes('image/svg+xml')) return true;
  return false;
};
