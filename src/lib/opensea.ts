/**
 * Thin server-only wrapper around OpenSea's v2 "Get NFT" endpoint.
 *
 * OpenSea pre-renders and permanently caches a still image for every token it
 * indexes — even when the underlying asset is a raw video (e.g. Rodeo's
 * AI-art mints on Base) — which is why their thumbnails always load
 * instantly regardless of the source media. We use it purely as a best-effort
 * fallback cover source for tokens whose resolved image still points at a
 * video file, instead of paying for our own live frame-extraction.
 *
 * Never import this from a client component — it reads OPENSEA_API_KEY.
 */

const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2';

const OPENSEA_CHAIN_SLUG: Record<'base' | 'ethereum', string> = {
  base: 'base',
  ethereum: 'ethereum',
};

export interface OpenSeaNftMedia {
  imageUrl: string;
  animationUrl: string;
  name: string;
}

/**
 * Fetches OpenSea's own cached image/animation URLs for a token.
 * Returns null on any error, missing key, rate limit, or unindexed token —
 * callers must treat this as best-effort enrichment, never a hard dependency.
 */
export async function getOpenSeaNftMedia(
  contract: string,
  tokenId: string,
  network: 'base' | 'ethereum' = 'ethereum'
): Promise<OpenSeaNftMedia | null> {
  const tag = `[podplayr:opensea] ${contract}#${tokenId}`;
  const apiKey = process.env.OPENSEA_API_KEY;
  if (!apiKey) {
    console.warn(`${tag} skipped — OPENSEA_API_KEY is not set in .env.local`);
    return null;
  }
  if (!contract || !tokenId) return null;

  const chain = OPENSEA_CHAIN_SLUG[network] || 'ethereum';
  const url = `${OPENSEA_API_BASE}/chain/${chain}/contract/${contract}/nfts/${tokenId}`;

  try {
    console.log(`${tag} requesting`, { url, chain });
    const res = await fetch(url, {
      headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (!res.ok) {
      if (res.status === 429) {
        console.warn(`${tag} rate limited (429) — check X-RateLimit-Reset / back off`);
      } else if (res.status === 404) {
        console.log(`${tag} not indexed by OpenSea (404)`);
      } else {
        console.warn(`${tag} request failed`, { status: res.status });
      }
      return null;
    }
    const data = (await res.json()) as {
      nft?: {
        image_url?: string;
        display_image_url?: string;
        animation_url?: string;
        display_animation_url?: string;
        name?: string;
      };
    };
    const nft = data?.nft;
    if (!nft) {
      console.log(`${tag} response had no nft field`, data);
      return null;
    }

    console.log(`${tag} raw fields`, {
      image_url: nft.image_url,
      display_image_url: nft.display_image_url,
      animation_url: nft.animation_url,
      display_animation_url: nft.display_animation_url,
    });

    const imageUrl = nft.display_image_url || nft.image_url || '';
    if (!imageUrl) {
      console.log(`${tag} OpenSea has this token but no image_url/display_image_url`, {
        name: nft.name,
        animationUrl: nft.display_animation_url || nft.animation_url,
      });
      return null;
    }

    console.log(`${tag} got still`, { imageUrl, name: nft.name });
    return {
      imageUrl,
      animationUrl: nft.display_animation_url || nft.animation_url || '',
      name: nft.name || '',
    };
  } catch (error) {
    console.warn(`${tag} fetch threw`, error);
    return null;
  }
}
