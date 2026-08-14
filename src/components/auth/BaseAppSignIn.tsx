'use client';

import { useContext, useState } from 'react';
import { SignInWithBaseButton } from '@base-org/account-ui/react';
import { UserFidContext } from '~/app/providers';

interface BaseAppSignInProps {
  variant?: 'banner' | 'profile';
}

export function BaseAppSignIn({ variant = 'profile' }: BaseAppSignInProps) {
  const { environment, walletAddress, connectBaseWallet } = useContext(UserFidContext);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (environment !== 'coinbase' || walletAddress || !connectBaseWallet) {
    return null;
  }

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await connectBaseWallet();
    } catch (err: unknown) {
      const code = typeof err === 'object' && err && 'code' in err
        ? (err as { code?: number }).code
        : undefined;
      if (code === 4001) {
        setError('Sign-in was cancelled');
      } else {
        setError(err instanceof Error ? err.message : 'Sign-in failed');
      }
    } finally {
      setLoading(false);
    }
  };

  if (variant === 'banner') {
    return (
      <div className="fixed top-0 left-0 right-0 z-[120] px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 bg-black/80 backdrop-blur-md border-b border-purple-400/20">
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-white/70">Connect your Base Account to sync likes and NFTs</p>
          <SignInWithBaseButton
            align="center"
            variant="solid"
            colorScheme="dark"
            onClick={() => {
              if (!loading) void handleSignIn();
            }}
          />
          {error && <p className="text-[11px] text-red-300">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <SignInWithBaseButton
        align="left"
        variant="solid"
        colorScheme="dark"
        onClick={() => {
          if (!loading) void handleSignIn();
        }}
      />
      {loading && <p className="text-xs text-white/50">Connecting…</p>}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
