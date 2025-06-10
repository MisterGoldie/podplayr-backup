'use client';

import { useState, useEffect } from 'react';
import { hasBeenTopPlayed } from '../lib/firebase';
import type { NFT } from '../types/user';

export function useNFTTopPlayed(nft: NFT | null) {
  const [hasBeenInTopPlayed, setHasBeenInTopPlayed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const checkTopPlayed = async () => {
      if (!nft) {
        setHasBeenInTopPlayed(false);
        setLoading(false);
        return;
      }

      try {
        const isTopPlayed = await hasBeenTopPlayed(nft);
        setHasBeenInTopPlayed(isTopPlayed);
      } catch (error) {
        console.error('Error checking top played status:', error);
        setHasBeenInTopPlayed(false);
      } finally {
        setLoading(false);
      }
    };

    checkTopPlayed();
  }, [nft]);

  return { hasBeenInTopPlayed, loading };
}
