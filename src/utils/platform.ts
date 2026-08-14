const WARPCAST_CLIENT_FID = 9152;
const COINBASE_WALLET_CLIENT_FID = 309857;
const MINI_APP_DETECT_TIMEOUT_MS = 1500;

type InjectedEthereum = {
  isCoinbaseBrowser?: boolean;
} | undefined;

function getInjectedEthereum(): InjectedEthereum {
  if (typeof window === 'undefined') return undefined;
  try {
    const top = window.top as Window & { ethereum?: InjectedEthereum };
    return top?.ethereum ?? (window as Window & { ethereum?: InjectedEthereum }).ethereum;
  } catch {
    // window.top throws when the page is cross-origin framed
    return (window as Window & { ethereum?: InjectedEthereum }).ethereum;
  }
}

export async function isFarcasterMiniApp() {
  try {
    const { sdk } = await import('@farcaster/miniapp-sdk');
    return await Promise.race([
      sdk.isInMiniApp(),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), MINI_APP_DETECT_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.warn('Failed to import Farcaster mini-app SDK:', error);
    return false;
  }
}

export function isDesktopWeb(): boolean {
  if (typeof window === 'undefined') return false;
  return !/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(navigator.userAgent.toLowerCase());
}

export function isCoinbaseWalletClientFid(clientFid?: number | null): boolean {
  return clientFid === COINBASE_WALLET_CLIENT_FID;
}

export function isWarpcastClientFid(clientFid?: number | null): boolean {
  return clientFid === WARPCAST_CLIENT_FID;
}

/** MiniKit/Farcaster inject fid -1 in a regular browser tab. */
export function isRealFid(fid?: number | null): boolean {
  return typeof fid === 'number' && fid > 0;
}

/**
 * True only inside Coinbase Wallet / Base App's in-app browser.
 *
 * 2024 MiniKit: Base App was a Farcaster mini-app host (`clientFid` 309857).
 * After April 9 2026 it is a standard webview: `sdk.isInMiniApp()` is false,
 * and MiniKit still supplies a dummy context (`fid: -1`) in Chrome/Safari.
 *
 * Coinbase's injected provider sets `isCoinbaseBrowser` in that webview only.
 * `isCoinbaseWallet` is also true for the Chrome extension — do not use it.
 * MiniKit context existing is also not a signal — OnchainKit wraps every page.
 */
export function isBaseAppBrowser(): boolean {
  if (typeof window === 'undefined') return false;

  if (getInjectedEthereum()?.isCoinbaseBrowser) return true;

  const ua = navigator.userAgent || '';
  return /CoinbaseWallet|CoinbaseBrowser|org\.toshi/i.test(ua);
}

export async function detectMiniKitEnvironment(): Promise<{
  environment: 'farcaster' | 'coinbase' | 'web';
  context?: unknown;
}> {
  try {
    if (isBaseAppBrowser()) {
      return { environment: 'coinbase' };
    }

    const isFarcaster = await isFarcasterMiniApp();
    if (isFarcaster) {
      return { environment: 'farcaster' };
    }

    return { environment: 'web' };
  } catch (error) {
    console.warn('Error detecting MiniKit environment:', error);
    return { environment: 'web' };
  }
}

export async function isCoinbaseEnvironment(): Promise<boolean> {
  const result = await detectMiniKitEnvironment();
  return result.environment === 'coinbase';
}

export async function detectMiniAppEnvironment(): Promise<'farcaster' | 'coinbase' | 'web'> {
  const result = await detectMiniKitEnvironment();
  return result.environment;
}
