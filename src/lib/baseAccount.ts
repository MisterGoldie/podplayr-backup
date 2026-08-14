import { createBaseAccountSDK } from '@base-org/account/browser';

const BASE_CHAIN_ID = '0x2105';
const WALLET_STORAGE_KEY = 'podplyr_wallet_address';

let sdk: ReturnType<typeof createBaseAccountSDK> | null = null;

const getProvider = () => {
  if (typeof window === 'undefined') return null;
  if (!sdk) {
    sdk = createBaseAccountSDK({
      appName: 'PODPLAYR',
      appLogoUrl: `${process.env.NEXT_PUBLIC_URL || ''}/splash.png`,
      appChainIds: [8453],
    });
  }
  return sdk.getProvider();
};

export const getStoredBaseWalletAddress = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(WALLET_STORAGE_KEY);
    return saved && saved.startsWith('0x') ? saved : null;
  } catch {
    return null;
  }
};

export const storeBaseWalletAddress = (address: string) => {
  try {
    localStorage.setItem(WALLET_STORAGE_KEY, address.toLowerCase());
  } catch {
    // Ignore quota / private-mode failures
  }
};

export interface BaseSignInResult {
  address: `0x${string}`;
  message?: string;
  signature?: string;
}

/**
 * Explicit Sign in with Base: connect the wallet and request a SIWE proof.
 * Base App no longer injects FID/wallet automatically (post April 9 2026).
 */
export const signInWithBase = async (): Promise<BaseSignInResult> => {
  const provider = getProvider();
  if (!provider) {
    throw new Error('Base Account is only available in the browser');
  }

  const nonce = window.crypto.randomUUID().replace(/-/g, '');

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BASE_CHAIN_ID }],
    });
  } catch {
    // Chain switch is best-effort inside Base App
  }

  try {
    const authResult = await provider.request({
      method: 'wallet_connect',
      params: [{
        version: '1',
        capabilities: {
          signInWithEthereum: {
            nonce,
            chainId: BASE_CHAIN_ID,
          },
        },
      }],
    }) as {
      accounts: Array<{
        address: `0x${string}`;
        capabilities?: {
          signInWithEthereum?: { message: string; signature: string };
        };
      }>;
    };

    const account = authResult?.accounts?.[0];
    if (!account?.address) {
      throw new Error('No Base Account returned');
    }

    storeBaseWalletAddress(account.address);
    return {
      address: account.address,
      message: account.capabilities?.signInWithEthereum?.message,
      signature: account.capabilities?.signInWithEthereum?.signature,
    };
  } catch (error: unknown) {
    const code = typeof error === 'object' && error && 'code' in error
      ? (error as { code?: string | number }).code
      : undefined;

    // Older wallets: fall back to a plain account request.
    if (code === 'method_not_supported' || code === -32601) {
      const accounts = await provider.request({
        method: 'eth_requestAccounts',
      }) as string[];
      const address = accounts?.[0] as `0x${string}` | undefined;
      if (!address) throw new Error('No wallet address returned');
      storeBaseWalletAddress(address);
      return { address };
    }

    throw error;
  }
};
