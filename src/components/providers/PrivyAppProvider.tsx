'use client';

import type { ReactNode } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { isVerifiedMiniAppHost } from '~/lib/miniapp';

export function hasPrivyAppId(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
}

declare global {
  interface Window {
    __podplayrPrivyWarningFilter?: boolean;
  }
}

function consoleArgText(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.message;
  return '';
}

function isHarmlessPrivyWarning(args: unknown[]): boolean {
  const strings = args.map(consoleArgText);
  const blob = strings.join(' ');
  if (blob.includes('Invalid DOM property') && (blob.includes('clip-path') || strings.includes('clip-path'))) {
    return true;
  }
  // Privy's login method list (minified `xe`/`ge`) omits keys on wallet rows.
  if (blob.includes('unique "key" prop') && blob.includes('from xe')) {
    return true;
  }
  // Farcaster SDK logs this when addMiniApp runs on a tunnel/preview host.
  if (
    typeof window !== 'undefined' &&
    !isVerifiedMiniAppHost(window.location.hostname) &&
    (blob.includes('invalid_domain_manifest') || blob.includes('Mini app add rejected'))
  ) {
    return true;
  }
  return false;
}

// Privy's modal SVG/list warnings are internal and do not break login.
if (typeof window !== 'undefined' && !window.__podplayrPrivyWarningFilter) {
  window.__podplayrPrivyWarningFilter = true;
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (isHarmlessPrivyWarning(args)) return;
    original.apply(console, args as Parameters<typeof console.error>);
  };
}

export function PrivyAppProvider({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#c084fc',
          logo: '/splash.png',
          walletChainType: 'ethereum-only',
          walletList: ['metamask', 'coinbase_wallet', 'rainbow'],
        },
        loginMethods: ['farcaster', 'email', 'wallet'],
        embeddedWallets: {
          ethereum: {
            // Email logins have no injected wallet; create one so profile
            // NFT loading still has an address to resolve.
            createOnLogin: 'users-without-wallets',
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
