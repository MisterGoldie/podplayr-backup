'use client';

import { useContext, useEffect, useRef } from 'react';
import { useLogin, usePrivy, useWallets } from '@privy-io/react-auth';
import { UserFidContext } from '~/app/providers';

type PrivyAccount = {
  type?: string;
  address?: string;
  fid?: number;
  ownerAddress?: string;
};

function walletAddressFromPrivy(user: { wallet?: { address?: string }; linkedAccounts?: PrivyAccount[] } | null): string | null {
  const linked = user?.linkedAccounts?.find(
    (account) => account?.type === 'wallet' && account.address?.startsWith('0x')
  );
  const address = user?.wallet?.address || linked?.address;
  return address && address.startsWith('0x') ? address : null;
}

function farcasterFromPrivy(user: { farcaster?: { fid?: number; ownerAddress?: string }; linkedAccounts?: PrivyAccount[] } | null) {
  const linked = user?.linkedAccounts?.find((account) => account?.type === 'farcaster');
  const fid = user?.farcaster?.fid || linked?.fid;
  if (typeof fid !== 'number' || fid <= 0) return null;
  const ownerAddress = user?.farcaster?.ownerAddress || linked?.ownerAddress;
  return {
    fid,
    ownerAddress: ownerAddress?.startsWith('0x') ? ownerAddress : null,
  };
}

export function WebPrivyController({
  onOpenReady,
}: {
  onOpenReady: (open: () => void) => void;
}) {
  const { environment, applyWalletAddress, applyFarcasterIdentity, clearWalletIdentity } = useContext(UserFidContext);
  const { ready, authenticated, user } = usePrivy();
  const { login } = useLogin();
  const { wallets } = useWallets();
  const appliedIdentityRef = useRef<string | null>(null);

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
      if (appliedIdentityRef.current) {
        appliedIdentityRef.current = null;
        clearWalletIdentity?.();
      }
      return;
    }

    const farcaster = farcasterFromPrivy(user);
    const address =
      wallets.find((wallet) => wallet.address?.startsWith('0x'))?.address ||
      walletAddressFromPrivy(user) ||
      farcaster?.ownerAddress;

    if (farcaster) {
      const key = `fid:${farcaster.fid}`;
      if (appliedIdentityRef.current === key) return;
      appliedIdentityRef.current = key;
      void applyFarcasterIdentity?.(farcaster.fid, address || undefined);
      return;
    }

    if (!address || appliedIdentityRef.current === address.toLowerCase()) return;
    appliedIdentityRef.current = address.toLowerCase();
    void applyWalletAddress?.(address);
  }, [environment, authenticated, user, wallets, applyWalletAddress, applyFarcasterIdentity, clearWalletIdentity]);

  return null;
}
