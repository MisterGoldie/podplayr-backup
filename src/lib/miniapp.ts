const DEFAULT_APP_URL = 'https://podplayr.xyz';

function stripSlash(url: string): string {
  return url.replace(/\/$/, '');
}

export function getAppUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return stripSlash(window.location.origin);
  }

  return stripSlash(process.env.NEXT_PUBLIC_URL || DEFAULT_APP_URL);
}

export async function getServerAppUrl(): Promise<string> {
  try {
    const { headers } = await import('next/headers');
    const headerList = await headers();
    const host = headerList.get('x-forwarded-host') || headerList.get('host');
    if (host) {
      const forwardedProto = headerList.get('x-forwarded-proto');
      const proto =
        forwardedProto ||
        (host.includes('localhost') || host.startsWith('127.') ? 'http' : 'https');
      return stripSlash(`${proto}://${host}`);
    }
  } catch {
    // headers() is unavailable outside a request (e.g. client bundles)
  }

  return getAppUrl();
}

export function getProfileUrl(fid: number, appUrl = getAppUrl()): string {
  return `${stripSlash(appUrl)}/profile/${fid}`;
}

export function parseProfileFid(pathname: string, search = ''): number | null {
  const pathMatch = pathname.match(/^\/profile\/(-?\d+)\/?$/);
  if (pathMatch) {
    const fid = Number(pathMatch[1]);
    if (Number.isInteger(fid) && fid !== 0) return fid;
  }

  const fidParam = new URLSearchParams(search).get('fid');
  if (!fidParam) return null;
  const fid = Number(fidParam);
  return Number.isInteger(fid) && fid !== 0 ? fid : null;
}

export function getNftUrl(contract: string, tokenId: string, appUrl = getAppUrl()): string {
  return `${stripSlash(appUrl)}/nft/${encodeURIComponent(contract)}/${encodeURIComponent(tokenId)}`;
}

/** Matches `/nft/:contract/:tokenId` and, for older shared links, `?contract=&tokenId=`. */
export function parseNftDeepLink(
  pathname: string,
  search = ''
): { contract: string; tokenId: string } | null {
  const pathMatch = pathname.match(/^\/nft\/([^/]+)\/([^/]+)\/?$/);
  if (pathMatch) {
    const contract = decodeURIComponent(pathMatch[1]);
    const tokenId = decodeURIComponent(pathMatch[2]);
    if (contract && tokenId) return { contract, tokenId };
  }

  const params = new URLSearchParams(search);
  const contract = params.get('contract');
  const tokenId = params.get('tokenId');
  if (contract && tokenId) return { contract, tokenId };

  return null;
}

type EmbedOptions = {
  imageUrl: string;
  buttonTitle: string;
  launchUrl: string;
};

function originFromUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return getAppUrl();
  }
}

function buildEmbed(
  { imageUrl, buttonTitle, launchUrl }: EmbedOptions,
  actionType: 'launch_miniapp' | 'launch_frame'
) {
  const origin = originFromUrl(launchUrl);
  return {
    version: '1',
    imageUrl,
    button: {
      title: buttonTitle,
      action: {
        type: actionType,
        name: 'PODPLAYR',
        url: launchUrl,
        splashImageUrl: `${origin}/splash.png`,
        splashBackgroundColor: '#000000',
      },
    },
  };
}

export function miniAppMetadataTags(options: EmbedOptions) {
  return {
    'fc:miniapp': JSON.stringify(buildEmbed(options, 'launch_miniapp')),
    'fc:frame': JSON.stringify(buildEmbed(options, 'launch_frame')),
  };
}

/** Twitter + Open Graph for a share URL. Always pass a same-origin image
 *  (`/image.png` or `/api/og…`). Twitterbot cannot fetch IPFS/Pinata. */
export function socialShareMetadata({
  title,
  description,
  imageUrl,
  pageUrl,
}: {
  title: string;
  description: string;
  imageUrl: string;
  pageUrl: string;
}) {
  return {
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: 'PODPLAYR',
      type: 'website' as const,
      images: [{ url: imageUrl, width: 1200, height: 800, alt: title }],
    },
    twitter: {
      card: 'summary_large_image' as const,
      title,
      description,
      images: [imageUrl],
    },
  };
}
