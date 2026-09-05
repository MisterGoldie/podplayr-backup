export { app, db } from './firebase/config';

export {
  cleanupLikes,
  subscribeToLikedNFTs,
  getLikedNFTs,
  toggleLikeNFT,
  addLikedNFT,
  removeLikedNFT,
  getUserLikedNFTsCount,
} from './firebase/likes';

export {
  cacheUserWallet,
  getCachedWallet,
  trackENSUserSearch,
  trackUserSearch,
  subscribeToRecentSearches,
  getRecentSearches,
  searchUsersByAddress,
  searchUsers,
  getPopularSearchedUsers,
} from './firebase/user';

export {
  recordRecentPlay,
  trackNFTPlay,
  getTopPlayedNFTs,
  hasBeenTopPlayed,
  subscribeToRecentPlays,
  getUserTotalPlays,
  syncTopPlayedCollection,
  getUserPlayHistory,
  subscribeToUserPlayHistory,
} from './firebase/plays';

export {
  fetchNFTDetails,
  fetchUserNFTs,
  ensureFeaturedNFTsExist,
} from './firebase/nfts';

export {
  PODPLAYR_ACCOUNT,
  followUser,
  updatePodplayrFollowerCount,
  ensurePodplayrFollow,
  unfollowUser,
  isUserFollowed,
  toggleFollowUser,
  getFollowingUsers,
  recomputeFollowingCount,
  recomputeFollowerCount,
  getFollowingCount,
  getFollowersCount,
  getFollowers,
  subscribeToFollowingUsers,
  subscribeToFollowers,
  getFollowerProfiles,
} from './firebase/follows';
