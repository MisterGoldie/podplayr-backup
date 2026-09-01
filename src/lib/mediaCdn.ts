import { extractIPFSHash, parseArweaveMediaPath } from '../utils/media';

/**
 * Mobile playback cannot stream the original Arweave/IPFS files.
 * Featured videos are hundreds of MB to ~1.3GB progressive MP4s.
 *
 * Put transcoded derivatives on a CDN and set NEXT_PUBLIC_MEDIA_CDN_BASE.
 * Convention (id = Arweave tx or IPFS CID):
 *   {BASE}/{id}/480p.mp4   ← mobile (required)
 *   {BASE}/{id}/720p.mp4   ← desktop (optional, falls back to 480p)
 *
 * ffmpeg example (faststart is required so the first frame does not wait
 * for the whole file):
 *   ffmpeg -i original.mp4 -vf "scale=-2:480" -c:v libx264 -preset veryfast \
 *     -crf 28 -c:a aac -b:a 96k -movflags +faststart 480p.mp4
 *
 * A CDN of the *original* GB files will not make mobile usable.
 */

export type CdnPlaybackSource = {
  url: string;
  quality: '480p' | '720p' | 'hls';
};

const CDN_BASE = (process.env.NEXT_PUBLIC_MEDIA_CDN_BASE || '').replace(/\/+$/, '');

/**
 * Optional per-id overrides (Cloudflare Stream HLS, Mux, etc.).
 * Key = Arweave tx id, IPFS CID, Alchemy nft-cdn filename, or OpenSea seadn filename.
 */
const muxHls = (playbackId: string) => `https://stream.mux.com/${playbackId}.m3u8`;

const PLAYBACK_OVERRIDES: Record<string, { mobile: string; desktop?: string }> = {
  // ACYL RADIO - Chili Sounds 🌶️
  GujXDFCEk4FmJl9b_TlofLEmx_YnY_LRSB2aSY8AcRg: {
    mobile: muxHls('CHno5MdpD02WNJzrX1R4vEerYBs021RE4zraz00I00q2MZs'),
    desktop: muxHls('CHno5MdpD02WNJzrX1R4vEerYBs021RE4zraz00I00q2MZs'),
  },
  // ACYL RADIO - Topia Hour
  'YV3PQYn-NAX3cC6t6yhlmMtSzZ_SxIcAb3Np6SKBCuQ': {
    mobile: muxHls('odx02ZC8FxRV01JLxoJ02Mhz3v1m012e5HpSuw9fWdhck02c'),
    desktop: muxHls('odx02ZC8FxRV01JLxoJ02Mhz3v1m012e5HpSuw9fWdhck02c'),
  },
  // I Found It
  qsVEbTD0FUZ8VebK4yxOrKWDQtW8BpNWj7o46HzKsV8: {
    mobile: muxHls('sQK66svaOrzGdPAjhtuqe00mhTLMe02AXL00bF9jUKJ01B00'),
    desktop: muxHls('sQK66svaOrzGdPAjhtuqe00mhTLMe02AXL00bF9jUKJ01B00'),
  },
  // Group (Think) Love
  'KPKrKgdACqggYesQqRCR4MeLWDlpR6i16xL-Q_e35q4': {
    mobile: muxHls('skHAVIRP6ujsh5eCF5GMPpBPzECaTHl00sW6LuxekWh00'),
    desktop: muxHls('skHAVIRP6ujsh5eCF5GMPpBPzECaTHl00sW6LuxekWh00'),
  },
  // Salem Tries - The Forest EP1
  'Df6hOV1--hsJBtTL1cEbhBkRZuggxSpR9eM0DXsdcv0': {
    mobile: muxHls('WxcAI5024DWcKveO202ipEZU00rVHsxUy02DTGLWJrBEp9o'),
    desktop: muxHls('WxcAI5024DWcKveO202ipEZU00rVHsxUy02DTGLWJrBEp9o'),
  },
  // ACYL RADIO - WILL01
  'FXMkBkgV79p3QIL8589uh68-sKuXbmuBzQwvWH10v74': {
    mobile: muxHls('ZEKVzDhMOAQZ6iJKypsqCZHDrw019Vs11DfLoA23HO7c'),
    desktop: muxHls('ZEKVzDhMOAQZ6iJKypsqCZHDrw019Vs11DfLoA23HO7c'),
  },
  // Music Mondays
  '6Y0t6OM1QybUlzHmbw2BLiFNjrG_jJfr4Md_pIF4o3c': {
    mobile: muxHls('VLW3nHxl5oW02dBMn02kombVDy3B5OtT86jJesGzDl6j00'),
    desktop: muxHls('VLW3nHxl5oW02dBMn02kombVDy3B5OtT86jJesGzDl6j00'),
  },
  // YOU WIN!! 592
  bafybeibbsp5qo6xhupb66ychgwwvzv2ae3kwesyvxuv4dynq3rr4jbo23q: {
    mobile: muxHls('fUxKFIvWyFTKKjrdLnGMQYUGbL01SIkjsIdI02pJi3bW8'),
    desktop: muxHls('fUxKFIvWyFTKKjrdLnGMQYUGbL01SIkjsIdI02pJi3bW8'),
  },
  // Seasoning with Sazón - COD Zombies Terminus EP1
  noYvGupxQyo2P7C2GMNNUseml29HEN6HLyvXOBD7jYQ: {
    mobile: muxHls('oTt2eSe8ONvIQ5U9iJ013kRyYWj2LRU2fxSLMuhm3tC00'),
    desktop: muxHls('oTt2eSe8ONvIQ5U9iJ013kRyYWj2LRU2fxSLMuhm3tC00'),
  },
  // Isolation(2020)
  bafybeibops7cqqf5ssqvueexmsyyrf6q4x6jbeaicymrnnzbg7dx34k2jq: {
    mobile: muxHls('EbduV02z1BQpMwykl2qYJ4OwQZliLBRoK7sL4YjN8LLY'),
    desktop: muxHls('EbduV02z1BQpMwykl2qYJ4OwQZliLBRoK7sL4YjN8LLY'),
  },
  // DIGITAL DAYDREAM
  'C3ZD4vH-nmHjYvtA9qWrEy2UZXajitmLMOQf9AsKBOU': {
    mobile: muxHls('YmErvai7JAbDK01EpZIoOEkZIBU01YbT19IL2R02CXSnVo'),
    desktop: muxHls('YmErvai7JAbDK01EpZIoOEkZIBU01YbT19IL2R02CXSnVo'),
  },
  // LATASHÁ - A Ten (OFFICIAL VIDEO) — Alchemy nft2-cdn animation hash
  '7d1b91517fd57375c124c9f8b6a66a2c_animation': {
    mobile: muxHls('TGr1d27X01mvnVSH7R4101cIC7Q4wyMazgBdpxW6ZaK34'),
    desktop: muxHls('TGr1d27X01mvnVSH7R4101cIC7Q4wyMazgBdpxW6ZaK34'),
  },
  // NEYBORS Music Video - Heno. featuring Elujay & J.Robb
  bafybeieaq7nqlv5j2wndfkxwlodqddelahlmuwczbrzei7py5enzftuska: {
    mobile: muxHls('V01CIYB6vZHqf01eHIGDt102f2XHE02xIUrvFp4neqi42ag'),
    desktop: muxHls('V01CIYB6vZHqf01eHIGDt102f2XHE02xIUrvFp4neqi42ag'),
  },
  // ISLAND 221
  bafybeicod3m7as3y7luyvfgclltnps235hhevt64xqmo3nyhojn2mv3owq: {
    mobile: muxHls('XG00lGsg01DVCnI02bhj4e6ybzknmr6oBuWSE7G5G01vu54'),
    desktop: muxHls('XG00lGsg01DVCnI02bhj4e6ybzknmr6oBuWSE7G5G01vu54'),
  },
  // CALLING - ai music video (XTincT)
  bafybeifgapj7vufewz6cynxjcjof36zqrf34274afyp2uwxbac34igcrny: {
    mobile: muxHls('JPhUp9wGoD4DrWp02DoKfOGx48WZ4f00D7uuS9MkpxU6I'),
    desktop: muxHls('JPhUp9wGoD4DrWp02DoKfOGx48WZ4f00D7uuS9MkpxU6I'),
  },
  // Energy (OFFICIAL VISUALIZER)
  bafybeigxtbuhw3zvhjfruzrfzcprmbxyryxqidnja5w4gj2dthhi4tuiyi: {
    mobile: muxHls('OyxgVCF400m5RVH6Q01sGk01ANkD01nONIMRvw9HLLe02M8M'),
    desktop: muxHls('OyxgVCF400m5RVH6Q01sGk01ANkD01nONIMRvw9HLLe02M8M'),
  },
  // PLATTER (music video) — OpenSea raw2.seadn.io filename
  bf83edeeba95c9390959ccd1febaca30: {
    mobile: muxHls('49KMUH00qnSlvwdqt00qjik02aFFGI02ott3eZqn00neQJv8'),
    desktop: muxHls('49KMUH00qnSlvwdqt00qjik02aFFGI02ott3eZqn00neQJv8'),
  },
  // Shadows of Love — Jon Blok
  d743b4d201538d858190ff0d83f8bafa: {
    mobile: muxHls('uNsYJbAtLikGjqZYpOFwRojr6Vv917D4O8N6j1gMHsY'),
    desktop: muxHls('uNsYJbAtLikGjqZYpOFwRojr6Vv917D4O8N6j1gMHsY'),
  },
  // BETTY! ft Rob Apollo [Official Music Video]
  bafybeihdev5rpice3ps7sma7dymr5avzkhvaastrsen2bmn2x4quidivfy: {
    mobile: muxHls('B00glZFc67CoWhE4KHC00cFRKnEt5D7yR2yhl013gvwnT8'),
    desktop: muxHls('B00glZFc67CoWhE4KHC00cFRKnEt5D7yR2yhl013gvwnT8'),
  },
  // I Asked My Friends A Serious Question — Mux-only
  '1C023gIJ9baWRdDavLYzKqB02iBPUHeO00wfTaL2AnGp00s': {
    mobile: muxHls('1C023gIJ9baWRdDavLYzKqB02iBPUHeO00wfTaL2AnGp00s'),
    desktop: muxHls('1C023gIJ9baWRdDavLYzKqB02iBPUHeO00wfTaL2AnGp00s'),
  },
  // NFT Podcast with Logik (Julian Gilliam) — Mux-only until Manifold mint
  '8VjskmcBC3w6R01xpsgLHUKb31wjrhKch23uZBjmJuOQ': {
    mobile: muxHls('8VjskmcBC3w6R01xpsgLHUKb31wjrhKch23uZBjmJuOQ'),
    desktop: muxHls('8VjskmcBC3w6R01xpsgLHUKb31wjrhKch23uZBjmJuOQ'),
  },
  // GUD by LOGIK — profile NFT (IPFS CID the player uses)
  bafybeif3tgmh7gerytonss7234qguvbjgrpz54ydgz753fyxekml52dppe: {
    mobile: muxHls('XEKtpfguXO0000noJMdbo55uNa7ueFtHMqvSl2oSzVME4'),
    desktop: muxHls('XEKtpfguXO0000noJMdbo55uNa7ueFtHMqvSl2oSzVME4'),
  },
  // GUD by LOGIK — OpenSea raw2.seadn.io filename
  b5994894da074ccc58e950bba0df0866: {
    mobile: muxHls('XEKtpfguXO0000noJMdbo55uNa7ueFtHMqvSl2oSzVME4'),
    desktop: muxHls('XEKtpfguXO0000noJMdbo55uNa7ueFtHMqvSl2oSzVME4'),
  },
  // EVOL by LOGIK — profile NFT (IPFS CID the player uses)
  bafybeicgubczfdpbk5rb4pqxepnwwxgzrac4oe373kgsemoupbqyykq4qu: {
    mobile: muxHls('1QpmuU7j2bE02s3yk5Sp2XPoxSjuldroY5UshhZ00c8qw'),
    desktop: muxHls('1QpmuU7j2bE02s3yk5Sp2XPoxSjuldroY5UshhZ00c8qw'),
  },
  // EVOL by LOGIK — OpenSea raw2.seadn.io filename
  '69da006bc1c3fa13216a6d32700fad09': {
    mobile: muxHls('1QpmuU7j2bE02s3yk5Sp2XPoxSjuldroY5UshhZ00c8qw'),
    desktop: muxHls('1QpmuU7j2bE02s3yk5Sp2XPoxSjuldroY5UshhZ00c8qw'),
  },
  // BLUE! #2 — SUPALOUDS / $LOUDER (IPFS CID the player uses)
  QmXeipbB5iZbqqJshR7shzxenwCQQCXnbW3uQ2TcTRyhjZ: {
    mobile: muxHls('JNhj00XWMFk2ooHAyzAW200NyCh9pnH02dHrgFkuZzdY6M'),
    desktop: muxHls('JNhj00XWMFk2ooHAyzAW200NyCh9pnH02dHrgFkuZzdY6M'),
  },
  // BLUE! #2 — Alchemy nft2-cdn animation hash
  '37f5d5d172be653a33b7390d53e91117_animation': {
    mobile: muxHls('JNhj00XWMFk2ooHAyzAW200NyCh9pnH02dHrgFkuZzdY6M'),
    desktop: muxHls('JNhj00XWMFk2ooHAyzAW200NyCh9pnH02dHrgFkuZzdY6M'),
  },
};

/** Alchemy NFT CDN media filename, e.g. 7d1b91517fd57375c124c9f8b6a66a2c_animation */
function extractAlchemyMediaId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith('alchemy.com') && !host.endsWith('alchemyapi.com')) return null;
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    if (!last) return null;
    return last.replace(/\.(mp4|m3u8|webm|mov)$/i, '') || null;
  } catch {
    return null;
  }
}

/** OpenSea CDN filename, e.g. bf83edeeba95c9390959ccd1febaca30.mp4 */
function extractOpenSeaMediaId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes('seadn.io')) return null;
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    if (!last) return null;
    return last.replace(/\.(mp4|m3u8|webm|mov|gif|png|jpe?g|webp)$/i, '') || null;
  } catch {
    return null;
  }
}

function extractMuxPlaybackId(url: string): string | null {
  const match = url.match(/stream\.mux\.com\/([A-Za-z0-9]+)/i);
  return match?.[1] || null;
}

export function mediaAssetIdFromUrl(url: string): string | null {
  if (!url) return null;
  const ar = parseArweaveMediaPath(url);
  if (ar.fileTxId) return ar.fileTxId;
  const cid = extractIPFSHash(url);
  if (cid) return cid;
  return extractMuxPlaybackId(url) || extractAlchemyMediaId(url) || extractOpenSeaMediaId(url);
}

function isUsableUrl(url?: string): url is string {
  return Boolean(url && /^https?:\/\//i.test(url));
}

const KNOWN_MUX_PLAYBACK_URLS = new Set(
  Object.values(PLAYBACK_OVERRIDES).flatMap((o) =>
    [o.mobile, o.desktop].filter((u): u is string => Boolean(u))
  )
);

const MUX_URL_TO_ORIGIN_ID = new Map<string, string>();
for (const [originId, override] of Object.entries(PLAYBACK_OVERRIDES)) {
  for (const url of [override.mobile, override.desktop]) {
    if (url) MUX_URL_TO_ORIGIN_ID.set(url, originId);
  }
}

/** Durable Arweave/IPFS URL for a Mux override — used to recover play/like keys. */
export function originUrlFromMuxPlayback(url?: string | null): string {
  if (!url) return '';
  const originId = MUX_URL_TO_ORIGIN_ID.get(url);
  if (!originId) return '';
  if (/^(bafy|bafkrei|qm)/i.test(originId)) {
    return `https://gateway.pinata.cloud/ipfs/${originId}`;
  }
  return `https://arweave.net/${originId}`;
}

export function isMuxPlaybackUrl(url?: string | null): boolean {
  // Only stream.mux.com HLS counts as "Mux playback" for override matching.
  // mezzanine.mux.com progressive mp4s are Alchemy/on-chain derivatives — separate.
  return !!url && /stream\.mux\.com/i.test(url);
}

/** Progressive mp4 derivative hosted by Mux (often Alchemy's animation.originalUrl). */
export function isMezzanineMuxUrl(url?: string | null): boolean {
  return !!url && /mezzanine\.mux\.com/i.test(url);
}

/**
 * Mux URL that is not one of our intentional PLAYBACK_OVERRIDES.
 * Polluted NFT caches / Firebase docs sometimes stamp a dead Mux stream onto
 * audio/animation — those must not replace the real Arweave/IPFS origin.
 */
export function isOrphanMuxPlaybackUrl(url?: string | null): boolean {
  if (!isMuxPlaybackUrl(url)) return false;
  return !KNOWN_MUX_PLAYBACK_URLS.has(url as string);
}

/**
 * Alchemy `…_animation` CDN URLs are often failed HLS ingest stubs
 * (contentType x-mpegURL, partialUpload, ~128B) — not playable media.
 */
/** @deprecated Use `isBrokenAlchemyAnimationCache` in nft.ts (needs contentType/size). */
export function isBrokenAlchemyAnimationCdnUrl(url?: string | null): boolean {
  if (!url) return false;
  // Intentional Mux HLS is playable. Only Alchemy's failed ingest stubs are junk.
  if (isMuxPlaybackUrl(url)) return false;
  return (
    /nft2?-cdn\.alchemy\.com|nft-cdn\.alchemy\.com/i.test(url) &&
    /\.m3u8(?:\?|#|$)/i.test(url)
  );
}

/** Playback URL that must never win over a real Arweave/IPFS/mp4 origin. */
export function isPollutedPlaybackUrl(url?: string | null): boolean {
  return isOrphanMuxPlaybackUrl(url) || isBrokenAlchemyAnimationCdnUrl(url);
}

/**
 * Weak / non-durable playback: orphan Mux HLS, broken Alchemy stubs, or
 * signed mezzanine.mux.com mp4s (signatures expire → 403 in browser).
 * Prefer ar://; never treat mezzanine as a playable origin.
 */
export function isWeakPlaybackUrl(url?: string | null): boolean {
  return isPollutedPlaybackUrl(url) || isMezzanineMuxUrl(url);
}

/** CDN / transcoded URLs to try *before* the original Arweave/IPFS file. */
export function resolveCdnPlaybackUrls(
  sourceUrl: string,
  options: { mobile?: boolean } = {}
): string[] {
  const id = mediaAssetIdFromUrl(sourceUrl);
  if (!id) return [];

  const urls: string[] = [];
  const push = (url?: string) => {
    if (isUsableUrl(url) && !urls.includes(url)) urls.push(url);
  };

  const override = PLAYBACK_OVERRIDES[id];
  if (override) {
    if (options.mobile) {
      push(override.mobile);
      push(override.desktop);
    } else {
      push(override.desktop);
      push(override.mobile);
    }
  }

  if (CDN_BASE) {
    if (options.mobile) {
      push(`${CDN_BASE}/${id}/480p.mp4`);
      push(`${CDN_BASE}/${id}/720p.mp4`);
    } else {
      push(`${CDN_BASE}/${id}/720p.mp4`);
      push(`${CDN_BASE}/${id}/480p.mp4`);
    }
    push(`${CDN_BASE}/${id}/master.m3u8`);
  }

  return urls;
}
