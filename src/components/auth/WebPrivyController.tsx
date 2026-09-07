'use client';

import { useContext, useEffect, useRef } from 'react';
import { useLogin, usePrivy, useWallets } from '@privy-io/react-auth';
import { UserFidContext } from '~/app/providers';

function walletAddressFromPrivy(user: { wallet?: { address?: string }; linkedAccounts?: Array<{ type?: string; address?: string }> } | null): string | null {
  const linked = user?.linkedAccounts?.find(
    (account) => account?.type === 'wallet' && account.address?.startsWith('0x')
  );
  const address = user?.wallet?.address || linked?.address;
  return address && address.startsWith('0x') ? address : null;
}

export function WebPrivyController({
  onOpenReady,
}: {
  onOpenReady: (open: () => void) => void;
}) {
  const { environment, applyWalletAddress, clearWalletIdentity } = useContext(UserFidContext);
  const { ready, authenticated, user } = usePrivy();
  const { login } = useLogin();
  const { wallets } = useWallets();
  const appliedAddressRef = useRef<string | null>(null);

  useEffect(() => {
    if (environment !== 'web') {
      onOpenReady(() => {});
      return;
    }

    onOpenReady(() => {
      if (!ready) return;
      if (!authenticated) login();
    });
  }, [environment, ready, authenticated, login, onOpenReady]);

  useEffect(() => {
    if (environment !== 'web') return;

    if (!authenticated) {
      if (appliedAddressRef.current) {
        appliedAddressRef.current = null;
        clearWalletIdentity?.();
      }
      return;
    }

    const address =
      wallets.find((wallet) => wallet.address?.startsWith('0x'))?.address ||
      walletAddressFromPrivy(user);
    if (!address || appliedAddressRef.current === address.toLowerCase()) return;
    appliedAddressRef.current = address.toLowerCase();
    void applyWalletAddress?.(address);
  }, [environment, authenticated, user, wallets, applyWalletAddress, clearWalletIdentity]);

  return null;
}
