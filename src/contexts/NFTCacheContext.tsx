'use client';

import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { fetchUserNFTs } from '../lib/nft';
import type { NFT } from '../types/user';
import { logger } from '../utils/logger';

// Create a module-specific logger
const nftCacheLogger = logger.getModuleLogger('nftCache');

// Cache expiration time (30 minutes)
const CACHE_EXPIRATION = 30 * 60 * 1000;

interface NFTCacheContextType {
  userNFTs: NFT[];
  isLoading: boolean;
  error: string | null;
  refreshUserNFTs: (fid: number) => Promise<void>;
  lastUpdated: number | null;
  clearCache: () => void;
}

const NFTCacheContext = createContext<NFTCacheContextType>({
  userNFTs: [],
  isLoading: false,
  error: null,
  refreshUserNFTs: async () => {},
  lastUpdated: null,
  clearCache: () => {},
});

export const useNFTCache = () => useContext(NFTCacheContext);

interface NFTCacheProviderProps {
  children: React.ReactNode;
}

export const NFTCacheProvider: React.FC<NFTCacheProviderProps> = ({ children }) => {
  const [userNFTs, setUserNFTs] = useState<NFT[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [cachedFid, setCachedFid] = useState<number | null>(null);

  // Function to check if the cache is still valid
  const isCacheValid = useCallback((fid: number): boolean => {
    if (!lastUpdated || cachedFid !== fid) return false;
    
    const now = Date.now();
    return now - lastUpdated < CACHE_EXPIRATION;
  }, [lastUpdated, cachedFid]);

  // Function to refresh NFTs (used both internally and exposed to consumers)
  const refreshUserNFTs = useCallback(async (fid: number) => {
    if (!fid) return;
    
    try {
      nftCacheLogger.info(`🔄 Refreshing NFTs for FID: ${fid}`);
      setIsLoading(true);
      setError(null);
      
      const nfts = await fetchUserNFTs(fid);
      
      nftCacheLogger.info(`✅ Successfully loaded ${nfts.length} NFTs for FID: ${fid}`);
      setUserNFTs(nfts);
      setLastUpdated(Date.now());
      setCachedFid(fid);
      
      // Store in localStorage for persistence across page refreshes
      try {
        localStorage.setItem(`nft_cache_${fid}`, JSON.stringify({
          nfts,
          timestamp: Date.now(),
        }));
      } catch (e) {
        nftCacheLogger.warn('Failed to store NFTs in localStorage:', e);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load NFTs';
      nftCacheLogger.error(`❌ Error loading NFTs: ${errorMessage}`, err);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Function to clear the cache
  const clearCache = useCallback(() => {
    setUserNFTs([]);
    setLastUpdated(null);
    setCachedFid(null);
    setError(null);
    
    // Clear localStorage cache
    if (cachedFid) {
      try {
        localStorage.removeItem(`nft_cache_${cachedFid}`);
      } catch (e) {
        nftCacheLogger.warn('Failed to clear localStorage cache:', e);
      }
    }
  }, [cachedFid]);

  // Try to load from localStorage on mount
  useEffect(() => {
    const loadFromLocalStorage = (fid: number) => {
      try {
        const cachedData = localStorage.getItem(`nft_cache_${fid}`);
        if (cachedData) {
          const { nfts, timestamp } = JSON.parse(cachedData);
          const now = Date.now();
          
          // Check if cache is still valid
          if (now - timestamp < CACHE_EXPIRATION) {
            nftCacheLogger.info(`📦 Loaded ${nfts.length} NFTs from localStorage cache for FID: ${fid}`);
            setUserNFTs(nfts);
            setLastUpdated(timestamp);
            setCachedFid(fid);
            return true;
          } else {
            nftCacheLogger.info(`🕒 Cache expired for FID: ${fid}, will refresh`);
            localStorage.removeItem(`nft_cache_${fid}`);
          }
        }
        return false;
      } catch (e) {
        nftCacheLogger.warn('Failed to load from localStorage:', e);
        return false;
      }
    };

    // This effect doesn't automatically load NFTs
    // It just sets up the localStorage handling
    // The actual loading will be triggered by the components using this context
  }, []);

  return (
    <NFTCacheContext.Provider
      value={{
        userNFTs,
        isLoading,
        error,
        refreshUserNFTs,
        lastUpdated,
        clearCache,
      }}
    >
      {children}
    </NFTCacheContext.Provider>
  );
};
