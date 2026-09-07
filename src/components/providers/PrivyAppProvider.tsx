'use client';

import type { ReactNode } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';

export function hasPrivyAppId(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
}

declare global {
  interface Window {
    __podplayrPrivyWarningFilter?: boolean;
  }
}

function isHarmlessPrivyWarning(args: unknown[]): boolean {
  const strings = args.filter((arg): arg is string => typeof arg === 'string');
  const blob = strings.join(' ');
  if (blob.includes('Invalid DOM property') && (blob.includes('clip-path') || strings.includes('clip-path'))) {
    return true;
  }
  // Privy's login method list (minified `xe`/`ge`) omits keys on wallet rows.
  return blob.includes('unique "key" prop') && blob.includes('from xe');
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
