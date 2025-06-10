// Central export file for Firebase functionality

// Export from config module
export { db, auth, storage, firebaseLogger } from './config';

// Export from utils module
export { delay, fetchWithRetry } from './utils';

// Export from user module
export { 
  cacheUserWallet,
  getCachedWallet,
  searchUsers
} from './user';

// Export from plays module
export {
  trackNFTPlay,
  getTopPlayedNFTs,
  hasBeenTopPlayed,
  subscribeToRecentPlays
} from './plays';

// Export from likes module
export {
  cleanupLikes,
  getLikedNFTs,
  toggleLikeNFT,
  addLikedNFT,
  removeLikedNFT,
  subscribeToLikedNFTs
} from './likes';

// Export from social module
export {
  followUser,
  unfollowUser,
  isUserFollowed,
  toggleFollowUser,
  getFollowingUsers,
  getFollowingCount,
  getFollowersCount,
  getFollowers,
  subscribeToFollowingUsers,
  subscribeToFollowers,
  ensurePodplayrFollow,
  updatePodplayrFollowerCount
} from './social';

// Export from storage module
export {
  uploadFile,
  uploadDataUrl,
  deleteFile,
  getFileUrl,
  generateBackgroundImagePath,
  generateProfileImagePath,
  uploadBackgroundImage,
  uploadProfileImage,
  getFileExtension,
  uploadBackgroundImageFromDataUrl,
  uploadProfileImageFromDataUrl
} from './storage';
