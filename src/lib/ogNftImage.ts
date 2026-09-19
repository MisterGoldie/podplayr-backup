import sharp from 'sharp';
import type { NFT } from '../types/user';
import { rewriteLegacyOpenSeaMediaUrl, unwrapMediaProxyUrl } from '../utils/openSeaMedia';

const GATEWAYS = ['https://gateway.pinata.cloud/ipfs/', 'https://dweb.link/ipfs/'];
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
type OgNft = Pick<NFT, 'name' | 'image' | 'metadata' | 'collection'> &
  Partial<Pick<NFT, 'contract' | 'network' | 'coverIsVideo'>>;

/** Keep the whole content path: a CID alone may point to a directory. */
export function ogImageUrls(raw: string, nft: OgNft): string[] {
  const source = unwrapMediaProxyUrl(raw.trim());
  if (!source) return [];
  if (source.startsWith('data:image/')) return [source];
  if (source.startsWith('ipfs://')) {
    const path = source.slice(7).replace(/^ipfs\//, '');
    return GATEWAYS.map((gateway) => gateway + path);
  }
  if (source.startsWith('ar://')) return ['https://arweave.net/' + source.slice(5)];
  try {
    const url = new URL(source);
    if (!['https:', 'http:'].includes(url.protocol)) return [];
    const ipfsPath = url.pathname.match(/\/ipfs\/(.+)/)?.[1];
    const subdomainCid = url.hostname.match(/^([^.]+)\.ipfs\./)?.[1];
    const path = ipfsPath || (subdomainCid ? subdomainCid + url.pathname : '');
    const rewritten = rewriteLegacyOpenSeaMediaUrl(source, nft.contract, nft.network);
    return [...new Set([rewritten, ...(path ? GATEWAYS.map((g) => g + path + url.search) : [])])];
  } catch {
    return [];
  }
}

async function loadImage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'image/*', 'User-Agent': 'PODPLAYR-OG/1.0' },
      cache: 'no-store',
    });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) return null;
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    // Decode real bytes, including AVIF/WebP/GIF, instead of renaming extensions.
    // Embed the PNG so ImageResponse never has to fetch this URL a second time.
    const png = await sharp(Buffer.concat(chunks), { limitInputPixels: 100_000_000 })
      .rotate().resize(520, 520, { fit: 'cover' }).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function loadOgNftImage(nft: OgNft, attempted = new Set<string>()): Promise<string | null> {
  const fields = [nft.image, nft.metadata?.image, nft.metadata?.image_url,
    nft.metadata?.display_image_url, nft.metadata?.original_image_url];
  for (const raw of fields) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    for (const url of ogImageUrls(raw, nft)) {
      const alreadyStill = /res\.cloudinary\.com\/alchemyapi\/(?:image|video)\/fetch\/.*f_(?:png|jpg|webp)/i.test(url);
      const video = !alreadyStill && (/\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url) ||
        (nft.coverIsVideo && /^https?:\/\/nft2?-cdn\.alchemy\.com\//i.test(url)));
      const candidate = video
        ? `https://res.cloudinary.com/alchemyapi/video/fetch/w_520,h_520,c_fill,f_png,so_0/${url}`
        : url;
      if (attempted.has(candidate)) continue;
      attempted.add(candidate);
      const image = await loadImage(candidate);
      if (image) return image;
    }
  }
  return null;
}

/** A cache hit only ends the search when its artwork actually decodes. */
export async function resolveOgNft(
  sources: Array<() => Promise<Array<OgNft | null | undefined>>>,
  fallbackTitle: string,
): Promise<{ image: string; title: string }> {
  const attempted = new Set<string>();
  let title = fallbackTitle;
  let hasTitle = false;
  for (const source of sources) {
    let candidates: Array<OgNft | null | undefined>;
    try { candidates = await source(); } catch { continue; }
    for (const nft of candidates) {
      if (!nft) continue;
      const name = nft.name || nft.metadata?.name || nft.collection?.name;
      if (!hasTitle && name) { title = name; hasTitle = true; }
      const image = await loadOgNftImage(nft, attempted);
      if (image) return { image, title: name || title };
    }
  }
  return { image: '', title };
}
