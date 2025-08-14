/**
 * Utility functions for handling ENS users
 */

/**
 * Check if a FID represents an ENS user (negative FID)
 */
export const isENSUser = (fid: number): boolean => {
  return fid < 0;
};

/**
 * Check if a user object is an ENS user
 */
export const isENSUserObject = (user: any): boolean => {
  return user && (user.isENS === true || isENSUser(user.fid));
};

/**
 * Get cache key for ENS users (different from Farcaster users)
 */
export const getENSCacheKey = (fid: number): string => {
  return `podplayr_ens_cache_${Math.abs(fid)}`;
};

/**
 * Get cache key for regular Farcaster users
 */
export const getFarcasterCacheKey = (fid: number): string => {
  return `podplayr_nft_cache_${fid}`;
};