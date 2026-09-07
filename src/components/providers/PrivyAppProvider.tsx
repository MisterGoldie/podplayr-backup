'use client';

import type { ReactNode } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';

export function hasPrivyAppId(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
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
        loginMethods: ['email', 'wallet'],
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
