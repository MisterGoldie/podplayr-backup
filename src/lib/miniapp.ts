const DEFAULT_APP_URL = 'https://podplayr.xyz';

/** Domain the farcaster.json accountAssociation signature was issued for. */
export const MINIAPP_VERIFIED_DOMAIN = 'podplayr.xyz';

export function isVerifiedMiniAppHost(hostname: string): boolean {
  const host = hostname.replace(/\.$/, '').toLowerCase();
  return host === MINIAPP_VERIFIED_DOMAIN || host === `www.${MINIAPP_VERIFIED_DOMAIN}`;
}

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

export function getLiveUrl(appUrl = getAppUrl()): string {
  return `${stripSlash(appUrl)}/live`;
}

export function isLivePath(pathname: string): boolean {
  return pathname.replace(/\/$/, '') === '/live';
}

function embedPathname(embed?: string | null): { pathname: string; search: string } | null {
  if (!embed || typeof embed !== 'string') return null;
  try {
    const url = new URL(embed);
    return { pathname: url.pathname, search: url.search };
  } catch {
    return null;
  }
}

/** Pathname or a Farcaster embed URL that should open the live player. */
export function isLiveLaunch(pathname: string, search = '', embed?: string | null): boolean {
  if (parseNftDeepLink(pathname, search) || parseProfileFid(pathname, search)) {
    return false;
  }
  if (isLivePath(pathname)) return true;
  const fromEmbed = embedPathname(embed);
  if (!fromEmbed) return false;
  if (parseNftDeepLink(fromEmbed.pathname, fromEmbed.search)) return false;
  return isLivePath(fromEmbed.pathname);
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
