import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDocs,
  updateDoc,
  arrayUnion,
  arrayRemove,
  doc,
  increment,
  onSnapshot,
  setDoc,
  getDoc,
  deleteDoc,
  documentId,
  serverTimestamp,
  Timestamp,
  writeBatch,
  DocumentSnapshot,
  QueryDocumentSnapshot,
  DocumentData,
  collectionGroup,
  startAfter
} from 'firebase/firestore';
import type { FarcasterUser, SearchedUser, NFTPlayData, FollowedUser } from '../types/user';
import { pickExactFnameUser, rankByExactFname, normalizeSearchQuery } from '../utils/farcasterFname';
import type { NFT } from '../types/nft';
import { fetchUserNFTsFromAlchemy } from './nft';
import { getMediaKey, getNftIdentityKey, normalizeNftContract, normalizeNftTokenId } from '~/utils/media';
import { uniqueLikedNfts } from '~/utils/likeDedupe';
import { consolidateUserLikes, findExistingUserLikeIds, mergeLegacyLikeCounts } from './consolidateUserLikes';
import { mergeLegacyPlayCounts } from './consolidateGlobalPlays';
import { getNftPlaybackPlan, hydrateNftPlayback, isPlayableMediaNFT, restoreStoredAnimationUrl, applyConfirmedPlayback, getCachedMediaMime } from '../utils/isMediaNFT';
import { stampNftLikeTime, sortLikedNewestFirst, snapshotCreateMillis, fetchLikeCreateTimes } from '../utils/likeTime';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { isENSUser } from '../utils/ensUtils';

// Create module-specific loggers
const firebaseLogger = logger.getModuleLogger('firebase');
const authLogger = logger.getModuleLogger('auth');

/** Playback fields persisted on play/like docs (legacy docs may omit these). */
const playbackFieldsForStore = (nft: NFT) => {
  const plan = getNftPlaybackPlan(nft);
  const animationUrl = nft.metadata?.animation_url || plan.videoUrl || '';
  return {
    videoUrl: plan.videoUrl || nft.videoUrl || '',
    animationUrl,
    isVideo: plan.mode !== 'audio-only',
    playbackMode: plan.mode,
    mediaMime: (nft.metadata as { mimeType?: string; mime_type?: string } | undefined)?.mimeType
      || (nft.metadata as { mimeType?: string; mime_type?: string } | undefined)?.mime_type
      || getCachedMediaMime(nft.audio || nft.videoUrl || nft.metadata?.animation_url)
      || '',
  };
};

/** Reconstruct NFT playback fields from a Firebase play/like document. */
const nftFromPlayRecord = (data: DocumentData): NFT => {
  const nested = data.nft && typeof data.nft === 'object' ? data.nft : {};
  const audioUrl = data.audioUrl || nested.audio || data.audio || '';
  const animationUrl = restoreStoredAnimationUrl({
    ...data,
    animationUrl: data.animationUrl || nested.metadata?.animation_url || nested.animationUrl,
    metadata: {
      ...(nested.metadata || {}),
      ...(data.metadata || {}),
    },
    isVideo: data.isVideo ?? nested.isVideo,
    playbackMode: data.playbackMode || nested.playbackMode,
    videoUrl: data.videoUrl || nested.videoUrl,
    audioUrl,
  });
  const collectionName =
    typeof data.collection === 'string'
      ? data.collection
      : data.collection?.name || nested.collection?.name || 'Unknown Collection';

  const nft: NFT = {
    contract: data.nftContract || data.contract || nested.contract,
    tokenId: data.tokenId || nested.tokenId,
    name: data.name || nested.name || 'Untitled NFT',
    description: data.description || nested.description || '',
    image: data.image || data.imageUrl || nested.image || '',
    audio: audioUrl,
    videoUrl: data.videoUrl || nested.videoUrl || undefined,
    isVideo: Boolean(data.isVideo ?? nested.isVideo),
    playbackMode: data.playbackMode || nested.playbackMode,
    hasValidAudio: Boolean(audioUrl || animationUrl),
    metadata: {
      name: data.name || nested.name || 'Untitled NFT',
      description: data.description || nested.description || '',
      image: data.image || data.imageUrl || nested.image || '',
      ...(nested.metadata || {}),
      ...(data.metadata || {}),
      animation_url: animationUrl || data.metadata?.animation_url || nested.metadata?.animation_url || undefined,
      ...(data.mediaMime ? { mimeType: data.mediaMime } : {}),
    } as NFT['metadata'],
    collection: {
      name: collectionName,
    },
    network: data.network || nested.network,
    // Prefer the media-file key so play counts match InfoPanel across mints.
    mediaKey: undefined,
  };
  const hydrated = hydrateNftPlayback(nft);
  hydrated.mediaKey = getMediaKey(hydrated) || data.mediaKey;
  return hydrated;
};
const dataLogger = logger.getModuleLogger('data');

// Call deduplication cache
const callCache = new Map<string, Promise<any>>();
const CACHE_DURATION = 1000; // 1 second

// Wrapper function to deduplicate calls
function deduplicateCall<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (callCache.has(key)) {
    return callCache.get(key)!;
  }
  
  const promise = fn();
  callCache.set(key, promise);
  
  // Clear cache after duration
  setTimeout(() => callCache.delete(key), CACHE_DURATION);
  
  return promise;
}

// Initialize Firebase with your config
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

// `src/firebase.ts` and `src/lib/firebase/config.ts` also register the
// default Firebase app — whichever of the three runs second throws
// `app/duplicate-app` (especially easy to hit via Next.js Fast Refresh
// re-executing this module). Reuse the existing app instead of re-creating it.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export { app };
export const db = getFirestore(app);

// Cache user's wallet address
export const cacheUserWallet = async (fid: number, address: string): Promise<void> => {
  try {
    const cacheRef = doc(db, 'wallet_cache', fid.toString());
    await setDoc(cacheRef, {
      address,
      timestamp: serverTimestamp()
    });
    firebaseLogger.info('Cached wallet address for FID:', fid, address);
  } catch (error) {
    firebaseLogger.error('Error caching wallet:', error);
  }
};

// Get cached wallet address
export const getCachedWallet = async (fid: number): Promise<string | null> => {
  try {
    const cacheRef = doc(db, 'wallet_cache', fid.toString());
    const cacheDoc = await getDoc(cacheRef);
    if (cacheDoc.exists()) {
      return cacheDoc.data().address;
    }
    return null;
  } catch (error) {
    firebaseLogger.error('Error getting cached wallet:', error);
    return null;
  }
};

// user_searches has no TTL — every search adds a permanent doc, so it grows
// forever unless something trims it. Cap each searcher's history so the
// collection self-maintains instead (same pattern as top_played's top-3 cap).
const USER_SEARCH_HISTORY_CAP = 100;
const pruneOldUserSearches = async (searchingFid: number): Promise<void> => {
  try {
    const excess = await getDocs(
      query(
        collection(db, 'user_searches'),
        where('searching_fid', '==', searchingFid),
        orderBy('timestamp', 'desc'),
        limit(USER_SEARCH_HISTORY_CAP + 1)
      )
    );
    if (excess.size <= USER_SEARCH_HISTORY_CAP) return;
    const oldest = excess.docs[excess.docs.length - 1];
    await deleteDoc(oldest.ref);
  } catch (error) {
    // Hygiene-only — never let a pruning failure block the search itself
    firebaseLogger.warn('Error pruning old user_searches doc:', error);
  }
};

// Track ENS user search and save to Firebase
export const trackENSUserSearch = async (ensName: string, syntheticFid: number, address: string, userData: any, currentUserFid: number = 0): Promise<FarcasterUser> => {
  try {
    firebaseLogger.info('Tracking ENS user search:', ensName, 'with address:', address, 'and synthetic FID:', syntheticFid);
    
    // Update searchedusers collection with ENS user data
    const now = new Date().getTime();
    const searchedUserRef = doc(db, 'searchedusers', syntheticFid.toString());
    
    const searchedUserData = {
      fid: syntheticFid,
      username: ensName,
      display_name: userData.display_name || ensName,
      pfp_url: userData.avatar || '',
      custody_address: address,
      verifiedAddresses: [address],
      follower_count: 0,
      following_count: 0,
      lastSearched: now,
      searchCount: increment(1),
      isENS: true
    };
    
    await setDoc(searchedUserRef, searchedUserData, { merge: true });
    
    // Cache the address for NFT retrieval
    await cacheUserWallet(syntheticFid, address);
    
    // Also track in user_searches for history
    firebaseLogger.info('=== TRACKING ENS USER SEARCH ===');
    firebaseLogger.info('ENS name:', ensName);
    firebaseLogger.info('Address:', address);
    
    const searchRef = collection(db, 'user_searches');
    const timestamp = Date.now();
    
    // Create the search record using unified index pattern
    const searchRecord = {
      searching_fid: currentUserFid, // Use the current user's FID instead of 0
      searchedFid: syntheticFid,
      searchedUsername: ensName,
      searchedDisplayName: userData.display_name || ensName,
      searchedPfpUrl: userData.avatar || '',
      searchedFollowerCount: 0,
      searchedFollowingCount: 0,
      timestamp: timestamp,
      serverTimestamp: serverTimestamp(),
      isENS: true
    };
    
    firebaseLogger.info('Adding ENS search with searching_fid:', currentUserFid);
    
    firebaseLogger.info('Adding ENS search with data:', searchRecord);
    await addDoc(searchRef, searchRecord);
    firebaseLogger.info('ENS search tracked successfully');
    await pruneOldUserSearches(currentUserFid);
    
    // Return a FarcasterUser-compatible object
    return {
      fid: syntheticFid,
      username: ensName,
      display_name: userData.display_name || ensName,
      pfp_url: userData.avatar || '',
      follower_count: 0,
      following_count: 0,
      custody_address: address,
      verifiedAddresses: [address],
      profile: {
        bio: userData.description || ''
      },
      isENS: true
    };
  } catch (error) {
    firebaseLogger.error('Error tracking ENS user search:', error);
    throw error;
  }
};

// Track user search and return Farcaster user data
export const trackUserSearch = async (username: string, fid: number): Promise<FarcasterUser> => {
  try {
    // Check if this is an ENS user (synthetic FID is negative)
    if (fid < 0 && username.endsWith('.eth')) {
      // This is an ENS user, so we need to get their data from the ENS lookup
      firebaseLogger.info('Detected ENS user in trackUserSearch:', username, 'with synthetic FID:', fid);
      
      // For ENS users, we need to check if they're already in the database
      const userDoc = await getDoc(doc(db, 'searchedusers', fid.toString()));
      if (userDoc.exists()) {
        // ENS user already exists in database, return the stored data
        const userData = userDoc.data();
        firebaseLogger.info('Found existing ENS user in database:', userData);
        
        // Update last searched time
        await updateDoc(doc(db, 'searchedusers', fid.toString()), {
          lastSearched: new Date().getTime(),
          searchCount: increment(1)
        });
        
        return {
          fid: userData.fid,
          username: userData.username,
          display_name: userData.display_name,
          pfp_url: userData.pfp_url,
          follower_count: userData.follower_count || 0,
          following_count: userData.following_count || 0,
          custody_address: userData.custody_address,
          verifiedAddresses: userData.verifiedAddresses || [userData.custody_address],
          profile: {
            bio: userData.bio || ''
          },
          isENS: true
        };
      } else {
        // If we don't have the ENS user in our database, we need to fetch their data
        // This should be handled by the ENS resolution process in SearchBar.tsx
        // which will call trackENSUserSearch directly with the proper ENS data
        throw new Error('ENS user not found in database and missing required data for tracking');
      }
    }
    
    const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY;
    if (!neynarKey) throw new Error('Neynar API key not found');

    firebaseLogger.info('Searching for user:', username);
    // First search for the user to get their FID
    const searchResponse = await fetchWithRetry(
      `https://api.neynar.com/v2/farcaster/user/search?q=${encodeURIComponent(username)}`,
      {
        headers: {
          'accept': 'application/json',
          'api_key': neynarKey
        }
      }
    );

    const searchData = await searchResponse.json();
    firebaseLogger.info('Search response:', searchData);
    const searchHits = searchData.result?.users || [];
    const searchedUser =
      pickExactFnameUser(searchHits, username) || searchHits[0];
    if (!searchedUser) throw new Error('User not found');

    firebaseLogger.info('Found user, fetching full profile for FID:', searchedUser.fid);
    // Then fetch their full profile data including verified addresses
    const profileResponse = await fetchWithRetry(
      `https://api.neynar.com/v2/farcaster/user/bulk?fids=${searchedUser.fid}`,
      {
        headers: {
          'accept': 'application/json',
          'api_key': neynarKey
        }
      }
    );

    const profileData = await profileResponse.json();
    firebaseLogger.info('Profile response:', profileData);
    const user = profileData.users?.[0];
    if (!user) throw new Error('User profile not found');

    // Extract addresses from user profile data
    const addresses = new Set<string>();
    
    // Try to get custody address from user profile
    if (user.custody_address) {
      firebaseLogger.info('Found custody address in profile:', user.custody_address);
      addresses.add(user.custody_address);
    }
    
    // Try to get verified addresses from user profile
    if (user.verified_addresses) {
      if (Array.isArray(user.verified_addresses)) {
        firebaseLogger.info('Found verified addresses (array):', user.verified_addresses);
        user.verified_addresses.forEach((addr: string) => addresses.add(addr));
      } else if (user.verified_addresses.eth_addresses) {
        firebaseLogger.info('Found verified addresses (object):', user.verified_addresses.eth_addresses);
        user.verified_addresses.eth_addresses.forEach((addr: string) => addresses.add(addr));
      }
    }

    // Try to get additional addresses from v1 API endpoints if needed
    if (addresses.size === 0) {
      try {
        // Try custody address endpoint
        const custodyResponse = await fetchWithRetry(
          `https://api.neynar.com/v2/farcaster/user/custody-address?fid=${searchedUser.fid}`,
          {
            headers: {
              'accept': 'application/json',
              'api_key': neynarKey
            }
          }
        );

        const custodyData = await custodyResponse.json();
        if (custodyData.result?.custody_address) {
          firebaseLogger.info('Found custody address from v2 API:', custodyData.result.custody_address);
          addresses.add(custodyData.result.custody_address);
        }
      } catch (error) {
        firebaseLogger.warn('Failed to fetch custody address:', error);
      }

      try {
        // Try verified addresses endpoint
        const verifiedResponse = await fetchWithRetry(
          `https://api.neynar.com/v2/farcaster/user/verified-addresses?fid=${searchedUser.fid}`,
          {
            headers: {
              'accept': 'application/json',
              'api_key': neynarKey
            }
          }
        );

        const verifiedData = await verifiedResponse.json();
        const verifiedAddresses = verifiedData.result?.verified_addresses || [];
        if (verifiedAddresses.length > 0) {
          firebaseLogger.info('Found verified addresses from v2 API:', verifiedAddresses);
          verifiedAddresses.forEach((addr: string) => addresses.add(addr));
        }
      } catch (error) {
        firebaseLogger.warn('Failed to fetch verified addresses:', error);
      }
    }

    // Convert to array
    const finalAddresses = Array.from(addresses);
    firebaseLogger.info('Final addresses:', finalAddresses);

    // Update searchedusers collection with user data and search info
    const now = new Date().getTime();
    const searchedUserRef = doc(db, 'searchedusers', user.fid.toString());
    
    // For PODPlayr, get the correct follower count from total users
    let followerCount = user.follower_count;
    
    if (user.username === 'podplayr' || user.fid === PODPLAYR_ACCOUNT.fid) {
      try {
        // The authoritative in-app follower count lives in the atomically
        // incremented `followerCount` field on this same doc (kept in sync
        // by followUser/unfollowUser on every real follow). The `users`
        // collection is NOT a reliable proxy for "total app users" — a
        // top-level users/{fid} doc only gets created when that user
        // uploads a profile background image, so its size undercounts
        // real users by a wide margin.
        const existingDoc = await getDoc(searchedUserRef);
        const cachedFollowerCount = existingDoc.exists() ? existingDoc.data().followerCount : undefined;
        if (typeof cachedFollowerCount === 'number') {
          followerCount = cachedFollowerCount;
          firebaseLogger.info(`Using cached followerCount (${followerCount}) for PODPlayr follower count in trackUserSearch`);
        }
      } catch (error) {
        console.error('Error reading cached PODPlayr follower count:', error);
      }
    }
    
    const searchedUserData = {
      fid: user.fid,
      username: user.username,
      display_name: user.display_name,
      pfp_url: user.pfp_url,
      custody_address: finalAddresses[0] || null,
      verifiedAddresses: finalAddresses,
      follower_count: followerCount,
      following_count: user.following_count,
      lastSearched: now,
      searchCount: increment(1),
      bio: user.profile?.bio || ""
    };
    await setDoc(searchedUserRef, searchedUserData, { merge: true });

    // Cache the first available address for NFT retrieval
    if (finalAddresses.length > 0) {
      await cacheUserWallet(user.fid, finalAddresses[0]);
    }
    
    // Also track in user_searches for history
    firebaseLogger.info('=== TRACKING USER SEARCH ===');
    firebaseLogger.info('FID:', fid);
    firebaseLogger.info('Searched User:', user);
    
    const searchRef = collection(db, 'user_searches');
    const timestamp = Date.now();
    firebaseLogger.info('Using timestamp:', new Date(timestamp));
    
    // Create the search record using unified index pattern
    const searchRecord = {
      searching_fid: fid, // Changed from fid to match index
      searchedFid: user.fid,
      searchedUsername: user.username,
      searchedDisplayName: user.display_name,
      searchedPfpUrl: user.pfp_url,
      searchedFollowerCount: user.follower_count,
      searchedFollowingCount: user.following_count,
      timestamp: timestamp, // Use client timestamp for immediate ordering
      serverTimestamp: serverTimestamp() // Keep server timestamp for consistency
    };
    
    firebaseLogger.info('Adding search with data:', searchRecord);
    await addDoc(searchRef, searchRecord);
    firebaseLogger.info('Search tracked successfully');
    await pruneOldUserSearches(fid);

    // Extract bio from the API response and normalize it to a string
    let bioText = "";
    const bio = user.profile?.bio;
    
    // Handle different possible bio formats
    if (typeof bio === 'string') {
      bioText = bio;
    } else if (bio && typeof bio === 'object') {
      // Some APIs return bio as an object with a text property
      const bioObj = bio as any;
      bioText = bioObj.text || "";
    }
    
    // Ensure we include the profile object with bio as a string
    return {
      ...user,
      custody_address: finalAddresses[0] || null,
      verifiedAddresses: finalAddresses,
      // Include profile object with bio as a normalized string
      profile: {
        ...(user.profile || {}),
        bio: bioText
      }
    };
  } catch (error) {
    firebaseLogger.error('Error tracking user search:', error);
    throw error;
  }
};

// Get recent searches with optional FID filter
// Subscribe to recent searches
export const subscribeToRecentSearches = (fid: number, callback: (searches: SearchedUser[]) => void) => {
  const searchesRef = collection(db, 'user_searches');
  // Use unified index pattern for recent searches
  const q = query(
    searchesRef,
    where('searching_fid', '==', fid),
    orderBy('timestamp', 'desc'),
    limit(20)
  );

  firebaseLogger.info('=== SUBSCRIBING TO RECENT SEARCHES ===');
  firebaseLogger.info('FID:', fid);
  
  firebaseLogger.info('Setting up snapshot listener with query:', {
    fid,
    orderBy: 'timestamp',
    direction: 'desc',
    limit: 20
  });

  return onSnapshot(q, (snapshot) => {
    firebaseLogger.info('=== RECEIVED SEARCH UPDATE ===');
    firebaseLogger.info('Number of docs:', snapshot.docs.length);
    
    // Check if there are any changes
    if (snapshot.empty) {
      firebaseLogger.info('No documents found');
      callback([]);
      return;
    }

    if (!snapshot.metadata.hasPendingWrites) {
      firebaseLogger.info('Update is from server, not local');
    }
    
    // Use a Map to keep only the most recent search for each searchedFid
    const uniqueSearches = new Map<number, SearchedUser>();
    const recentSearches: SearchedUser[] = [];
    
    // Process docs in order (already sorted by timestamp desc)
    const processedFids = new Set<number>();
    const updatedSearches: SearchedUser[] = [];
    
    // First handle any modifications or removals
    snapshot.docChanges().forEach(change => {
      if (change.type === 'modified' || change.type === 'removed') {
        const data = change.doc.data();
        const searchedFid = data.searchedFid;
        uniqueSearches.delete(searchedFid);
        processedFids.delete(searchedFid);
      }
    });
    
    // Then process all current documents
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const searchedFid = data.searchedFid;
      
      // Skip if we've already seen this FID
      if (processedFids.has(searchedFid)) {
        return;
      }
      
      // Handle different timestamp formats
      let timestamp: number;
      if (data.timestamp) {
        if (typeof data.timestamp === 'object' && 'toMillis' in data.timestamp) {
          // Firestore Timestamp
          timestamp = data.timestamp.toMillis();
        } else if (typeof data.timestamp === 'number') {
          // Unix timestamp in milliseconds
          timestamp = data.timestamp;
        } else if (typeof data.timestamp === 'string') {
          // ISO string timestamp
          timestamp = new Date(data.timestamp).getTime();
        } else {
          firebaseLogger.warn('Unknown timestamp format:', data.timestamp);
          timestamp = Date.now();
        }
      } else {
        timestamp = Date.now();
      }
      
      firebaseLogger.info('Processing search for FID:', searchedFid, 'with timestamp:', new Date(timestamp));
      const searchedUser = {
        fid: searchedFid,
        username: data.searchedUsername,
        display_name: data.searchedDisplayName,
        pfp_url: data.searchedPfpUrl,
        follower_count: data.searchedFollowerCount || 0,
        following_count: data.searchedFollowingCount || 0,
        searchCount: 1,
        timestamp: timestamp,
        lastSearched: timestamp,
        isENS: data.isENS || false  // Include the isENS flag
      };
      
      uniqueSearches.set(searchedFid, searchedUser);
      updatedSearches.push(searchedUser);
      processedFids.add(searchedFid);
    });

    // Sort by timestamp descending (most recent first)
    const sortedSearches = updatedSearches.sort((a, b) => b.timestamp - a.timestamp);
    
    firebaseLogger.info('Final recent searches:', sortedSearches);
    // Take first 8 unique users
    callback(sortedSearches.slice(0, 8));
  });
};

export const getRecentSearches = async (fid?: number): Promise<SearchedUser[]> => {
  try {
    // Get from user_searches to maintain proper chronological order
    const searchesRef = collection(db, 'user_searches');
    // Use unified index pattern for both filtered and unfiltered queries
    const q = fid
      ? query(
          searchesRef,
          where('searching_fid', '==', fid),
          orderBy('timestamp', 'desc'),
          limit(20)
        )
      : query(
          searchesRef,
          orderBy('timestamp', 'desc'),
          limit(20)
        );

    const snapshot = await getDocs(q);
    
    // Use a Map to keep only the most recent search for each searchedFid
    const uniqueSearches = new Map<number, SearchedUser>();
    
    // Process docs in reverse chronological order
    
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const searchedFid = data.searchedFid;
      const timestamp = data.timestamp;
      
      // Only add if this fid hasn't been seen yet (first occurrence is most recent due to orderBy)
      if (!uniqueSearches.has(searchedFid)) {
        uniqueSearches.set(searchedFid, {
          fid: searchedFid,
          username: data.searchedUsername,
          display_name: data.searchedDisplayName,
          pfp_url: data.searchedPfpUrl,
          follower_count: data.searchedFollowerCount || 0,
          following_count: data.searchedFollowingCount || 0,
          searchCount: 1,
          timestamp: timestamp,
          lastSearched: timestamp,
          isENS: data.isENS || false  // Include the isENS flag
        });
      }
    });

    // Convert to array maintaining query order (already sorted by timestamp desc)
    const recentSearches: SearchedUser[] = [];
    snapshot.docs.forEach(doc => {
      const searchedFid = doc.data().searchedFid;
      const user = uniqueSearches.get(searchedFid);
      if (user && !recentSearches.some(s => s.fid === searchedFid)) {
        recentSearches.push(user);
      }
    });

    // Take first 8 unique users
    return recentSearches.slice(0, 8);
  } catch (error) {
    firebaseLogger.error('Error getting recent searches:', error);
    return [];
  }
};

function buildPlayRecord(nft: NFT, fid: number, mediaKey: string, audioUrl: string) {
  const playbackStore = playbackFieldsForStore(nft);
  return {
    fid,
    mediaKey,
    nftContract: nft.contract,
    tokenId: nft.tokenId,
    name: nft.name || 'Untitled',
    description: nft.description || nft.metadata?.description || '',
    image: nft.image || nft.metadata?.image || '',
    audioUrl,
    videoUrl: playbackStore.videoUrl || '',
    animationUrl: playbackStore.animationUrl || '',
    isVideo: playbackStore.isVideo,
    playbackMode: playbackStore.playbackMode,
    mediaMime: playbackStore.mediaMime || '',
    collection: nft.collection?.name || 'Unknown Collection',
    network: nft.network || 'base',
    timestamp: Timestamp.now(),
    timestampMs: Date.now(),
  };
}

/**
 * Persist "last played" immediately when playback starts.
 * Play counts still wait for the 25% threshold in trackNFTPlay — recency should not.
 */
export const recordRecentPlay = async (nft: NFT, fid: number) => {
  try {
    if (!nft || !fid || !nft.contract || !nft.tokenId) {
      firebaseLogger.error('Invalid NFT or FID provided to recordRecentPlay');
      return;
    }

    const plan = getNftPlaybackPlan(nft);
    const audioUrl = plan.audioUrl || nft.metadata?.animation_url || nft.audio || '';
    if (!audioUrl) {
      firebaseLogger.error('No media URL found for recent play:', nft.name);
      return;
    }

    const mediaKey = getMediaKey(nft);
    if (!mediaKey) {
      firebaseLogger.error('Could not generate mediaKey for recent play:', nft.name);
      return;
    }

    const userRef = doc(db, 'users', fid.toString());
    const playHistoryRef = collection(userRef, 'playHistory');
    await addDoc(playHistoryRef, buildPlayRecord(nft, fid, mediaKey, audioUrl));
    firebaseLogger.info(`📝 Recorded recent play: ${nft.name}`);
  } catch (error) {
    firebaseLogger.error('Error recording recent play:', error instanceof Error ? error.message : 'Unknown error');
  }
};

// Track NFT play and update play count globally
export const trackNFTPlay = async (nft: NFT, fid: number, options?: { forceTrack?: boolean, thresholdReached?: boolean }) => {
  try {
    if (!nft || !fid) {
      firebaseLogger.error('Invalid NFT or FID provided to trackNFTPlay');
      return;
    }

    // Validate required NFT fields
    if (!nft.contract || !nft.tokenId) {
      firebaseLogger.error('NFT missing required fields:', { 
        contract: nft?.contract, 
        tokenId: nft?.tokenId,
        name: nft?.name,
        metadata: nft?.metadata
      });
      return;
    }

    // Ensure we have a valid name
    if (!nft.name) {
      nft.name = nft.metadata?.name || `NFT #${nft.tokenId}`;
    }

    // Get audio URL with fallbacks — may be a video file (video-with-audio)
    const plan = getNftPlaybackPlan(nft);
    const playbackStore = playbackFieldsForStore(nft);
    const audioUrl = plan.audioUrl || nft.metadata?.animation_url || nft.audio;
    if (!audioUrl) {
      firebaseLogger.error('No audio URL found for NFT:', {
        contract: nft.contract,
        tokenId: nft.tokenId,
        name: nft.name,
        audio: nft.audio,
        metadata: {
          animation_url: nft.metadata?.animation_url
        }
      });
      return;
    }

    // Canonical global_plays id is always getMediaKey(contract-tokenId).
    // playHistory may still carry a legacy UUID mediaKey — using that made
    // InfoPanel (which listens on getMediaKey) miss play-count increments.
    const mediaKey = getMediaKey(nft);
    if (!mediaKey) {
      firebaseLogger.error('Could not generate mediaKey for NFT:', nft);
      return;
    }

    nft.mediaKey = mediaKey;
    await mergeLegacyPlayCounts(db, nft, mediaKey);
    
    // Add debug logging for tracking
    const isThresholdPlay = options?.thresholdReached === true;
    firebaseLogger.info(`🎵 Tracking NFT play: ${nft.name}, mediaKey: ${mediaKey.substring(0, 12)}..., threshold: ${isThresholdPlay}`);

    const batch = writeBatch(db);

    // Update global_plays with mediaKey
    const globalPlayRef = doc(db, 'global_plays', mediaKey);
    const globalPlayDoc = await getDoc(globalPlayRef);

    // Get the current play count
    let currentPlayCount = 0;
    if (globalPlayDoc.exists()) {
      const data = globalPlayDoc.data();
      currentPlayCount = data.playCount || 0;
      // Keep the existing play count and increment it
      batch.update(globalPlayRef, {
        playCount: increment(1),
        lastPlayed: serverTimestamp(),
        // Always update metadata to ensure it's current
        name: nft.name || data.name || 'Untitled',
        image: nft.image || data.image || '',
        audioUrl: audioUrl || data.audioUrl,
        videoUrl: playbackStore.videoUrl || data.videoUrl || '',
        animationUrl: playbackStore.animationUrl || data.animationUrl || '',
        isVideo: playbackStore.isVideo,
        playbackMode: playbackStore.playbackMode,
        mediaMime: playbackStore.mediaMime || data.mediaMime || '',
        description: nft.description || nft.metadata?.description || data.description || '',
        collection: nft.collection?.name || data.collection || 'Unknown Collection',
        network: nft.network || data.network || 'base'
      });
    } else {
      // Ensure all required fields are present and have fallback values
      const nftData = {
        mediaKey,
        nftContract: nft.contract,
        tokenId: nft.tokenId,
        name: nft.name || 'Untitled',
        description: nft.description || nft.metadata?.description || '',
        image: nft.image || nft.metadata?.image || '',
        audioUrl,
        videoUrl: playbackStore.videoUrl,
        animationUrl: playbackStore.animationUrl,
        isVideo: playbackStore.isVideo,
        playbackMode: playbackStore.playbackMode,
        mediaMime: playbackStore.mediaMime,
        collection: nft.collection?.name || 'Unknown Collection',
        network: nft.network || 'base',
        playCount: 1,
        firstPlayed: serverTimestamp(),
        lastPlayed: serverTimestamp()
      };

      // Validate all fields before setting
      Object.entries(nftData).forEach(([key, value]) => {
        if (value === undefined) {
          firebaseLogger.error(`Required field ${key} is undefined in NFT data`);
          throw new Error(`Required field ${key} is undefined`);
        }
      });

      batch.set(globalPlayRef, nftData);
    }

    // Calculate new play count after the increment
    const newPlayCount = currentPlayCount + 1;

    // Update NFT document using mediaKey as part of the ID
    // This ensures we track plays per unique content, not just per contract-tokenId
    const nftKeyWithMedia = `${nft.contract}-${nft.tokenId}-${mediaKey.substring(0, 12)}`;
    const nftRef = doc(db, 'nfts', nftKeyWithMedia);
    const nftDoc = await getDoc(nftRef);
    
    if (nftDoc.exists()) {
      batch.update(nftRef, {
        plays: newPlayCount,
        lastPlayed: serverTimestamp(),
        mediaKey: mediaKey // Ensure mediaKey is stored
      });
    } else {
      // Create new document with mediaKey
      batch.set(nftRef, {
        contract: nft.contract,
        tokenId: nft.tokenId,
        mediaKey: mediaKey,
        name: nft.name || 'Untitled',
        plays: 1,
        firstPlayed: serverTimestamp(),
        lastPlayed: serverTimestamp()
      });
    }

    // Maintain top_played as a lean cache of ONLY the top 3 most-played NFTs.
    // A blind per-play upsert (the old behavior) turns this into a doc-per-
    // NFT-ever-played collection instead of a top-3 cache — only touch it
    // here when this NFT already qualifies, or newly displaces the current
    // #3, evicting that entry so the collection can't grow past 3.
    const topPlayedRef = doc(db, 'top_played', mediaKey);
    const topPlayedDoc = await getDoc(topPlayedRef);

    if (topPlayedDoc.exists()) {
      // Already one of the top 3 — just keep its count/metadata fresh.
      const data = topPlayedDoc.data();
      batch.update(topPlayedRef, {
        lastPlayed: serverTimestamp(),
        playCount: increment(1),
        // Always update metadata to ensure it's current
        name: nft.name || data.name || 'Untitled',
        image: nft.image || data.image || '',
        audioUrl: audioUrl || data.audioUrl,
        videoUrl: playbackStore.videoUrl || data.videoUrl || '',
        animationUrl: playbackStore.animationUrl || data.animationUrl || '',
        isVideo: playbackStore.isVideo,
        playbackMode: playbackStore.playbackMode,
        mediaMime: playbackStore.mediaMime || data.mediaMime || '',
        description: nft.description || nft.metadata?.description || data.description || '',
        collection: nft.collection?.name || data.collection || 'Unknown Collection',
        network: nft.network || data.network || 'base'
      });
    } else {
      const currentTop3 = await getDocs(
        query(collection(db, 'top_played'), orderBy('playCount', 'desc'), limit(3))
      );
      const lowestOfTop3 = currentTop3.size >= 3 ? currentTop3.docs[currentTop3.size - 1] : null;
      const qualifiesForTop3 = !lowestOfTop3 || newPlayCount > (lowestOfTop3.data().playCount || 0);

      if (qualifiesForTop3) {
        if (lowestOfTop3) {
          batch.delete(lowestOfTop3.ref);
        }
        batch.set(topPlayedRef, {
          mediaKey,
          nftContract: nft.contract,
          tokenId: nft.tokenId,
          name: nft.name || 'Untitled',
          image: nft.image || '',
          audioUrl: audioUrl,
          videoUrl: playbackStore.videoUrl,
          animationUrl: playbackStore.animationUrl,
          isVideo: playbackStore.isVideo,
          playbackMode: playbackStore.playbackMode,
          mediaMime: playbackStore.mediaMime,
          description: nft.description || nft.metadata?.description || '',
          collection: nft.collection?.name || 'Unknown Collection',
          network: nft.network || 'base',
          firstTopPlayedAt: serverTimestamp(),
          lastPlayed: serverTimestamp(),
          playCount: newPlayCount
        });
      }
    }

    // Also update nft_plays collection for backward compatibility
    const nftPlayData = {
      fid,
      mediaKey, // Add mediaKey to play data for consistency
      nftContract: nft.contract,
      tokenId: nft.tokenId,
      name: nft.name || 'Untitled',
      description: nft.description || nft.metadata?.description || '',
      image: nft.image || nft.metadata?.image || '',
      audioUrl: audioUrl,
      videoUrl: playbackStore.videoUrl,
      animationUrl: playbackStore.animationUrl,
      isVideo: playbackStore.isVideo,
      playbackMode: playbackStore.playbackMode,
      mediaMime: playbackStore.mediaMime,
      collection: nft.collection?.name || 'Unknown Collection',
      network: nft.network || 'base',
      timestamp: Timestamp.now(),
      timestampMs: Date.now(),
      playCount: currentPlayCount + 1, // Use the actual play count
      thresholdReached: options?.thresholdReached || false // Track if this was a threshold play
    };
    await addDoc(collection(db, 'nft_plays'), nftPlayData);

    // Track in user's play history
    const userRef = doc(db, 'users', fid.toString());
    const playHistoryRef = collection(userRef, 'playHistory');
    await addDoc(playHistoryRef, {
      ...nftPlayData,
      mediaKey, // Ensure mediaKey is included
      timestamp: Timestamp.now(),
      timestampMs: Date.now(),
    });

    // Commit the batch
    await batch.commit();
    
    // Return mediaKey for reference by caller
    return mediaKey;
  } catch (error) {
    firebaseLogger.error('Error tracking NFT play:', error instanceof Error ? error.message : 'Unknown error');
    throw error; // Re-throw to allow handling by the caller
  }
};

// Get top played NFTs from global plays collection
export async function getTopPlayedNFTs(): Promise<{ nft: NFT; count: number }[]> {
  try {
    // Get all global plays, ordered by play count
    const globalPlaysRef = collection(db, 'global_plays');
    const q = query(
      globalPlaysRef,
      orderBy('playCount', 'desc'),
      limit(10) // Get more than we need to account for duplicates
    );
    
    const querySnapshot = await getDocs(q);
    const topPlayed: { nft: NFT; count: number }[] = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (!data.mediaKey || !data.nftContract || !data.tokenId) return;
      
      // Create NFT object from global_plays data
      const nft = nftFromPlayRecord(data);

      topPlayed.push({
        nft,
        count: data.playCount || 0
      });
    });

    // Sort by play count in descending order and deduplicate by mediaKey
    const mediaKeyMap = new Map<string, { nft: NFT; count: number }>();
    
    // Keep only the highest play count for each unique content
    topPlayed.forEach(item => {
      const mediaKey = getMediaKey(item.nft);
      if (!mediaKey) return;
      
      const existing = mediaKeyMap.get(mediaKey);
      if (!existing || item.count > existing.count) {
        mediaKeyMap.set(mediaKey, item);
      }
    });

    // Convert back to array, sort by play count, and take top 3
    const uniqueTopPlayed = Array.from(mediaKeyMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    firebaseLogger.info('Unique top played NFTs:', uniqueTopPlayed);

    // Update top_played collection
    const batch = writeBatch(db);
    const topPlayedRef = collection(db, 'top_played');

    // First, clear existing top_played collection
    const existingTopPlayed = await getDocs(topPlayedRef);
    existingTopPlayed.forEach((doc) => {
      batch.delete(doc.ref);
    });

    // Add new top played NFTs
    for (const item of uniqueTopPlayed) {
      const mediaKey = getMediaKey(item.nft);
      if (!mediaKey) continue;
      
      const docRef = doc(topPlayedRef, mediaKey);
      const existingDoc = await getDoc(docRef);
      const now = serverTimestamp();
      
      batch.set(docRef, {
        mediaKey,
        nft: item.nft,
        playCount: item.count,
        rank: uniqueTopPlayed.indexOf(item) + 1,
        firstTopPlayedAt: existingDoc.exists() ? existingDoc.data()?.firstTopPlayedAt : now,
        lastTopPlayedAt: now,
        updatedAt: now
      });
    }

    await batch.commit();
    return uniqueTopPlayed;
  } catch (error) {
    firebaseLogger.error('Error getting top played NFTs:', error instanceof Error ? error.message : 'Unknown error');
    return [];
  }
}

// Check if an NFT is currently in the top played section
export async function hasBeenTopPlayed(nft: NFT | null): Promise<boolean> {
  if (!nft) return false;
  
  try {
    const mediaKey = getMediaKey(nft);
    if (!mediaKey) return false;

    // Get current top played NFTs
    const topPlayedRef = collection(db, 'top_played');
    const q = query(
      topPlayedRef,
      orderBy('playCount', 'desc'),
      limit(3) // Only get top 3 NFTs
    );
    
    const querySnapshot = await getDocs(q);
    let isCurrentlyTopPlayed = false;

    // Check if this NFT's mediaKey is in the current top 3
    querySnapshot.forEach(doc => {
      const data = doc.data();
      if (data.mediaKey === mediaKey) {
        isCurrentlyTopPlayed = true;
      }
    });
    
    return isCurrentlyTopPlayed;
  } catch (error) {
    firebaseLogger.error('Error checking top played status:', error);
    return false;
  }
}

// Clean up old likes and migrate to new format
export const cleanupLikes = async (fid: number) => {
  try {
    firebaseLogger.info('Starting likes cleanup for FID:', fid);
    const userLikesRef = collection(db, 'user_likes');
    const q = query(userLikesRef, where('fid', '==', fid));
    const querySnapshot = await getDocs(q);
    
    // Group documents by mediaKey
    const byMediaKey: { [key: string]: { docs: any[], latestTimestamp: any } } = {};
    
    querySnapshot.forEach(doc => {
      const data = doc.data();
      const mediaKey = data.mediaKey || getMediaKey({
        contract: data.nftContract,
        tokenId: data.tokenId,
        audio: data.audioUrl,
        image: data.image
      } as NFT);
      
      if (!byMediaKey[mediaKey]) {
        byMediaKey[mediaKey] = { docs: [], latestTimestamp: null };
      }
      byMediaKey[mediaKey].docs.push({ id: doc.id, data });
      
      // Track the latest timestamp
      if (!byMediaKey[mediaKey].latestTimestamp || 
          (data.timestamp && data.timestamp > byMediaKey[mediaKey].latestTimestamp)) {
        byMediaKey[mediaKey].latestTimestamp = data.timestamp;
      }
    });
    
    // For each mediaKey, keep only the latest document
    const batch = writeBatch(db);
    let deleteCount = 0;
    let migrateCount = 0;
    
    for (const [mediaKey, { docs, latestTimestamp }] of Object.entries(byMediaKey)) {
      // Sort by timestamp, newest first
      docs.sort((a, b) => {
        const aTime = a.data.timestamp?.toMillis() || 0;
        const bTime = b.data.timestamp?.toMillis() || 0;
        return bTime - aTime;
      });
      
      // Keep the newest document, delete others
      const keep = docs[0];
      
      // Create new document with consistent ID format
      const encoder = new TextEncoder();
      const mediaKeyBytes = encoder.encode(mediaKey);
      const hashBuffer = await crypto.subtle.digest('SHA-256', mediaKeyBytes);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      const newDocId = `${fid}-${hashHex.substring(0, 32)}`;
      
      // Create new document with clean data
      const newDocRef = doc(db, 'user_likes', newDocId);
      batch.set(newDocRef, {
        fid,
        mediaKey,
        nftContract: keep.data.nftContract,
        tokenId: keep.data.tokenId,
        name: keep.data.name || 'Untitled',
        description: keep.data.description || '',
        image: keep.data.image || '',
        audioUrl: keep.data.audioUrl || '',
        collection: keep.data.collection || 'Unknown Collection',
        timestamp: latestTimestamp || serverTimestamp()
      });
      migrateCount++;
      
      // Delete all old documents
      docs.forEach(({ id }) => {
        if (id !== newDocId) {
          const docRef = doc(db, 'user_likes', id);
          batch.delete(docRef);
          deleteCount++;
        }
      });
    }
    
    await batch.commit();
    firebaseLogger.info(`Cleanup complete. Migrated ${migrateCount} likes, deleted ${deleteCount} old documents.`);
  } catch (error) {
    firebaseLogger.error('Error during likes cleanup:', error);
  }
};

// Get liked NFTs for a user
export const getLikedNFTs = (fid: number): Promise<NFT[]> => {
  return deduplicateCall(`getLikedNFTs-${fid}`, async () => {
    // First check if user ID is valid
    if (!fid || fid <= 0) {
      firebaseLogger.error('Invalid fid provided to getLikedNFTs:', fid);
      return [];
    }
    try {
    firebaseLogger.info('Getting liked NFTs for FID:', fid);
    
    // Get the user's likes directly without filtering by removed_likes
    const userLikesRef = collection(db, 'users', fid.toString(), 'likes');
    // Do not orderBy timestamp — legacy likes stored a serverTimestamp sentinel
    // map, and mixing that with real timestamps omits docs.
    const querySnapshot = await getDocs(userLikesRef);
    
    if (querySnapshot.empty) {
      firebaseLogger.info('No liked NFTs found for user:', fid);
      return [];
    }

    const migrated = await consolidateUserLikes(db, fid.toString(), querySnapshot.docs);
    const likeDocs = migrated
      ? (await getDocs(userLikesRef)).docs
      : querySnapshot.docs;

    const likedNFTs: NFT[] = [];
    const seenMediaKeys = new Set<string>();
    const seenNFTKeys = new Set<string>(); // Track NFTs by contract-tokenId
    const missingGlobalLikes = new Map<string, any>(); // Store mediaKey -> user like data
    
    // Collect all media keys and user like data without filtering
    const createTimes = await fetchLikeCreateTimes(fid.toString());
    let mediaKeysWithData = likeDocs
      .map(docSnap => ({
        mediaKey: docSnap.id,
        data: docSnap.data(),
        createdMs: snapshotCreateMillis(docSnap) || createTimes.get(docSnap.id) || 0,
      }));
    
    firebaseLogger.info(`Found ${querySnapshot.docs.length} liked NFTs`);
    
    // Batch get all global likes to reduce number of requests
    const batchSize = 10;
    for (let i = 0; i < mediaKeysWithData.length; i += batchSize) {
      const batch = mediaKeysWithData.slice(i, i + batchSize);
      const promises = batch.map(({ mediaKey, data: userLikeData, createdMs }) => {
        if (seenMediaKeys.has(mediaKey)) {
          firebaseLogger.info(`Skipping duplicate mediaKey: ${mediaKey}`);
          return null;
        }
        seenMediaKeys.add(mediaKey);
        
        return getDoc(doc(db, 'global_likes', mediaKey))
          .then(async globalLikeDoc => {
            const globalData = globalLikeDoc.exists() ? globalLikeDoc.data() : {};
            const nested = userLikeData.nft && typeof userLikeData.nft === 'object' ? userLikeData.nft : {};
            const merged = {
              ...globalData,
              ...userLikeData,
              nftContract:
                userLikeData.contract ||
                userLikeData.nftContract ||
                nested.contract ||
                globalData.nftContract ||
                globalData.contract,
              tokenId: userLikeData.tokenId || nested.tokenId || globalData.tokenId,
              name: userLikeData.name || nested.name || globalData.name,
              description: userLikeData.description || nested.description || globalData.description,
              image:
                userLikeData.image ||
                nested.image ||
                globalData.image ||
                globalData.imageUrl,
              audioUrl: userLikeData.audioUrl || nested.audio || globalData.audioUrl,
              animationUrl:
                userLikeData.animationUrl ||
                userLikeData.metadata?.animation_url ||
                nested.metadata?.animation_url ||
                globalData.animationUrl ||
                globalData.metadata?.animation_url,
              videoUrl: userLikeData.videoUrl || nested.videoUrl || globalData.videoUrl,
              isVideo: userLikeData.isVideo ?? nested.isVideo ?? globalData.isVideo,
              playbackMode:
                userLikeData.playbackMode || nested.playbackMode || globalData.playbackMode,
              metadata: {
                ...(globalData.metadata || {}),
                ...(nested.metadata || {}),
                ...(userLikeData.metadata || {}),
              },
              network: userLikeData.network || nested.network || globalData.network,
              collection: userLikeData.collection || globalData.collection,
              mediaKey,
            };

            if (!globalLikeDoc.exists()) {
              missingGlobalLikes.set(mediaKey, { ...userLikeData, createdMs });
            }

            if (!merged.nftContract || !merged.tokenId) {
              return nested.contract && nested.tokenId
                ? stampNftLikeTime(
                    hydrateNftPlayback({
                      ...nested,
                      audio: nested.audio || userLikeData.audioUrl || '',
                      metadata: {
                        ...(nested.metadata || {}),
                        ...(userLikeData.metadata || {}),
                      },
                    } as NFT),
                    { ...userLikeData, createTime: createdMs }
                  )
                : null;
            }

            const nftKey =
              getNftIdentityKey({
                contract: merged.nftContract,
                tokenId: merged.tokenId,
              }) || `${merged.nftContract}-${merged.tokenId}`.toLowerCase();
            if (seenNFTKeys.has(nftKey)) {
              firebaseLogger.debug(`Skipping duplicate NFT: ${merged.name} (${nftKey})`);
              return null;
            }
            seenNFTKeys.add(nftKey);

            return stampNftLikeTime(nftFromPlayRecord(merged), {
              ...userLikeData,
              createTime: createdMs,
            });
          })
          .catch(err => {
            firebaseLogger.warn(`Error fetching global like for ${mediaKey}:`, err);
            return null;
          });
      });
      
      const results = await Promise.all(promises);
      likedNFTs.push(...results.filter(Boolean) as NFT[]);
    }
    
    // Fix missing global likes
    if (missingGlobalLikes.size > 0) {
      firebaseLogger.warn(`Found ${missingGlobalLikes.size} missing global like documents. Fixing...`);
      
      // Create a batch to update all missing global likes
      const batch = writeBatch(db);
      
      // Track which NFTs need to be added to likedNFTs after fixing
      const nftsToAdd: NFT[] = [];
      
      for (const [mediaKey, userLikeData] of missingGlobalLikes.entries()) {
        const nft = userLikeData.nft || {
          contract: userLikeData.contract || userLikeData.nftContract,
          tokenId: userLikeData.tokenId,
          name: userLikeData.name,
          description: userLikeData.description,
          image: userLikeData.image,
          audio: userLikeData.audioUrl,
          metadata: userLikeData.metadata,
          network: userLikeData.network,
          collection: { name: userLikeData.collection || 'Unknown Collection' },
        };
        
        if (!nft.contract || !nft.tokenId) {
          firebaseLogger.warn(`No NFT data found in user like document for mediaKey: ${mediaKey}`);
          continue;
        }
        
        // Create global like document
        const globalLikeRef = doc(db, 'global_likes', mediaKey);
        batch.set(globalLikeRef, {
          mediaKey,
          nftContract: nft.contract,
          tokenId: nft.tokenId,
          name: nft.name || 'Untitled',
          description: nft.description || '',
          image: nft.image || '',
          audioUrl: nft.audio || userLikeData.audioUrl || nft.metadata?.animation_url || '',
          animationUrl:
            userLikeData.animationUrl ||
            nft.metadata?.animation_url ||
            '',
          videoUrl: userLikeData.videoUrl || nft.videoUrl || '',
          isVideo: Boolean(userLikeData.isVideo ?? nft.isVideo),
          playbackMode: userLikeData.playbackMode || nft.playbackMode || '',
          metadata: userLikeData.metadata || nft.metadata || {},
          collection: nft.collection?.name || userLikeData.collection || 'Unknown Collection',
          network: nft.network || userLikeData.network || 'base',
          likeCount: 1,  // Start with 1 like (the current user)
          timestamp: serverTimestamp(),
          lastLiked: serverTimestamp()
        });
        
        // Add to the list of NFTs to include
        const nftKey =
          getNftIdentityKey(nft) || `${nft.contract}-${nft.tokenId}`.toLowerCase();
        if (!seenNFTKeys.has(nftKey)) {
          nftsToAdd.push(stampNftLikeTime(nft as NFT, { ...userLikeData, createTime: userLikeData.createdMs }));
          seenNFTKeys.add(nftKey);
        }
      }
      
      // Commit the batch update
      if (missingGlobalLikes.size > 0) {
        try {
          await batch.commit();
          firebaseLogger.info(`Fixed ${missingGlobalLikes.size} missing global like documents`);
          
          // Add all NFTs without filtering
          firebaseLogger.info(`Adding ${nftsToAdd.length} fixed NFTs to the list`);
          likedNFTs.push(...nftsToAdd);
        } catch (error) {
          firebaseLogger.error('Error fixing missing global likes:', error);
        }
      }
    }

    firebaseLogger.info(`Processed ${likedNFTs.length} liked NFTs after deduplication`);
    return uniqueLikedNfts(sortLikedNewestFirst(likedNFTs.filter(isPlayableMediaNFT)));
    } catch (error) {
      firebaseLogger.error('Error getting liked NFTs:', error);
      return [];
    }
  });
};

// Toggle NFT like status globally
export const toggleLikeNFT = async (nft: NFT, fid: number, forceUnlike: boolean = false): Promise<boolean> => {
  firebaseLogger.info('Starting toggleLikeNFT with NFT:', nft.name, 'and fid:', fid);
  
  if (!fid || fid <= 0) {
    firebaseLogger.error('Invalid fid provided to toggleLikeNFT:', fid);
    return false; // Return false instead of throwing to avoid breaking the UI
  }
  
  if (!nft || !nft.contract || !nft.tokenId) {
    firebaseLogger.error('Invalid NFT data provided to toggleLikeNFT:', nft);
    return false; // Return false instead of throwing to avoid breaking the UI
  }
  
  try {
    const mediaKey = getMediaKey(nft);
    if (!mediaKey) {
      firebaseLogger.error('Invalid mediaKey for NFT:', nft);
      return false;
    }
    nft.mediaKey = mediaKey;
    await mergeLegacyLikeCounts(db, nft, mediaKey);
    const variantLikeIds = await findExistingUserLikeIds(db, fid.toString(), nft);
    
    firebaseLogger.info('Using mediaKey for like operation:', mediaKey);
    
    // Reference to global likes document
    const globalLikeRef = doc(db, 'global_likes', mediaKey);
    const userLikeRef = doc(db, 'users', fid.toString(), 'likes', mediaKey);
    
    firebaseLogger.info('Document references created:', {
      globalLikeRef: globalLikeRef.path,
      userLikeRef: userLikeRef.path
    });
    
    // Get both documents in parallel for efficiency
    firebaseLogger.info('Fetching existing documents...');
    let userLikeDoc, globalLikeDoc;
    try {
      [userLikeDoc, globalLikeDoc] = await Promise.all([
        getDoc(userLikeRef),
        getDoc(globalLikeRef)
      ]);
    } catch (error) {
      firebaseLogger.error('Error fetching documents:', error);
      return false; // Return false instead of throwing to avoid breaking the UI
    }
    
    firebaseLogger.info('Document fetch complete. User like exists:', userLikeDoc.exists(), 'Global like exists:', globalLikeDoc.exists(), 'variant likes:', variantLikeIds.length);
    
    const batch = writeBatch(db);
    
    // If forceUnlike is true, we always want to unlike, regardless of current state
    // This ensures Library view unlike operations always work correctly
    const shouldUnlike = forceUnlike || userLikeDoc.exists() || variantLikeIds.length > 0;
    
    if (shouldUnlike) {
      // UNLIKE FLOW - Remove like from user's likes
      firebaseLogger.info('User like exists - removing like');
      batch.delete(userLikeRef);
      for (const variantId of variantLikeIds) {
        if (variantId !== mediaKey) {
          batch.delete(doc(db, 'users', fid.toString(), 'likes', variantId));
        }
      }
      
      // We no longer add to permanent removal list
      // This allows NFTs to be reliked and reappear in the library
      firebaseLogger.info(`Removed ${nft.name} (${mediaKey}) from likes for user ${fid}`);
      
      if (globalLikeDoc.exists()) {
        const currentCount = typeof globalLikeDoc.data()?.likeCount === 'number'
          ? globalLikeDoc.data().likeCount
          : 1;
        firebaseLogger.info('Unlike: decrementing global like count, not deleting leftover likes', {
          path: globalLikeRef.path,
          currentCount,
        });
        if (currentCount <= 1) {
          batch.update(globalLikeRef, {
            likeCount: 0,
            lastUnliked: serverTimestamp()
          });
        } else {
          batch.update(globalLikeRef, {
            likeCount: increment(-1),
            lastUnliked: serverTimestamp()
          });
        }
      }

      // Update likes count in nfts collection if it exists
      try {
        const nftRef = doc(db, 'nfts', `${nft.contract}-${nft.tokenId}`);
        const nftDoc = await getDoc(nftRef);
        if (nftDoc.exists()) {
          const currentLikes = nftDoc.data()?.likes || 1;
          batch.update(nftRef, {
            likes: Math.max(0, currentLikes - 1)
          });
        }
      } catch (error) {
        firebaseLogger.error('Error updating nft document, continuing anyway:', error);
        // Non-critical, can continue without this update
      }
      
      // Commit the batch operations
      try {
        await batch.commit();
        firebaseLogger.info('Successfully removed like for:', mediaKey);
        return false; // Return false to indicate NFT is not liked
      } catch (error) {
        firebaseLogger.error('Error committing unlike operation:', error);
        return userLikeDoc.exists(); // Return previous state on error
      }
    } else if (!forceUnlike) {
      // LIKE FLOW - Add NFT to user's likes
      firebaseLogger.info('User like does not exist - adding like');
      
      try {
        // Store NFT data in the user like document
        const userLikeData = {
          mediaKey,
          nft: {
            contract: normalizeNftContract(nft.contract),
            tokenId: normalizeNftTokenId(nft.tokenId),
            name: nft.name || 'Untitled',
            description: nft.description || nft.metadata?.description || '',
            image: nft.image || nft.metadata?.image || '',
            audio: nft.audio || nft.metadata?.animation_url || '',
            videoUrl: nft.videoUrl || '',
            isVideo: Boolean(nft.isVideo),
            playbackMode: nft.playbackMode || '',
            metadata: nft.metadata || {}
          },
          nftContract: normalizeNftContract(nft.contract),
          contract: normalizeNftContract(nft.contract),
          tokenId: normalizeNftTokenId(nft.tokenId),
          name: nft.name || 'Untitled',
          description: nft.description || nft.metadata?.description || '',
          image: nft.image || nft.metadata?.image || '',
          audioUrl: nft.audio || nft.metadata?.animation_url || '',
          animationUrl: typeof nft.metadata?.animation_url === 'string' ? nft.metadata.animation_url : '',
          videoUrl: nft.videoUrl || '',
          isVideo: Boolean(nft.isVideo),
          playbackMode: nft.playbackMode || '',
          metadata: nft.metadata || {},
          collection: nft.collection?.name || 'Unknown Collection',
          network: nft.network || 'base',
          timestamp: serverTimestamp(),
          likedAt: new Date().toISOString()
        };
        
        // We want to store only essential NFT data, excluding duplicative or derived fields
        batch.set(userLikeRef, userLikeData);
        for (const variantId of variantLikeIds) {
          if (variantId !== mediaKey) {
            batch.delete(doc(db, 'users', fid.toString(), 'likes', variantId));
          }
        }
        
        if (globalLikeDoc.exists()) {
          // Update existing global like document
          const globalData = globalLikeDoc.data();
          batch.update(globalLikeRef, {
            likeCount: increment(1),
            lastLiked: serverTimestamp(),
            // Always update metadata to ensure consistency
            name: nft.name || globalData?.name || 'Untitled',
            description: nft.description || nft.metadata?.description || globalData?.description || '',
            image: nft.image || nft.metadata?.image || globalData?.image || '',
            audioUrl: nft.audio || nft.metadata?.animation_url || globalData?.audioUrl || '',
            animationUrl:
              (typeof nft.metadata?.animation_url === 'string' ? nft.metadata.animation_url : '') ||
              globalData?.animationUrl ||
              '',
            videoUrl: nft.videoUrl || globalData?.videoUrl || '',
            isVideo: Boolean(nft.isVideo),
            playbackMode: nft.playbackMode || globalData?.playbackMode || '',
            metadata: nft.metadata || globalData?.metadata || {},
            collection: nft.collection?.name || globalData?.collection || 'Unknown Collection',
            network: nft.network || globalData?.network || 'base'
          });
        } else {
          // Create new global like document with full NFT data
          batch.set(globalLikeRef, {
            mediaKey,
            nftContract: nft.contract,
            tokenId: nft.tokenId,
            name: nft.name || 'Untitled',
            description: nft.description || nft.metadata?.description || '',
            image: nft.image || nft.metadata?.image || '',
            audioUrl: nft.audio || nft.metadata?.animation_url || '',
            animationUrl: typeof nft.metadata?.animation_url === 'string' ? nft.metadata.animation_url : '',
            videoUrl: nft.videoUrl || '',
            isVideo: Boolean(nft.isVideo),
            playbackMode: nft.playbackMode || '',
            metadata: nft.metadata || {},
            collection: nft.collection?.name || 'Unknown Collection',
            network: nft.network || 'base',
            likeCount: 1,
            firstLiked: serverTimestamp(),
            lastLiked: serverTimestamp()
          });
        }

        // Update likes count in nfts collection if it exists (non-critical)
        try {
          const nftRef = doc(db, 'nfts', `${nft.contract}-${nft.tokenId}`);
          const nftDoc = await getDoc(nftRef);
          if (nftDoc.exists()) {
            const currentLikes = nftDoc.data()?.likes || 0;
            batch.update(nftRef, {
              likes: currentLikes + 1
            });
          }
        } catch (error) {
          firebaseLogger.error('Error updating nft document, continuing anyway:', error);
          // Non-critical, can continue without this update
        }
        
        // Commit the batch operations
        await batch.commit();
        firebaseLogger.info('Successfully added like for:', mediaKey);
        return true; // Return true to indicate NFT is liked
      } catch (error) {
        firebaseLogger.error('Error adding like:', error);
        return false; // Return false to indicate operation failed
      }
    }
  } catch (error) {
    // This is the outermost error handler to ensure we never throw unhandled errors
    firebaseLogger.error('Unhandled error in toggleLikeNFT:', error);
    if (error instanceof Error) {
      firebaseLogger.error('Error details:', {
        message: error.message,
        stack: error.stack
      });
    }
    return false; // Default to not liked on error
  }
  
  // Default return to satisfy TypeScript
  return false;
};

function playTimestampMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === 'object' && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

// Subscribe to recent plays
export const subscribeToRecentPlays = (fid: number, callback: (nfts: NFT[]) => void) => {
  // Listen to user's play history collection for the most reliable recent plays tracking
  const userRef = doc(db, 'users', fid.toString());
  const playHistoryRef = collection(userRef, 'playHistory');
  
  firebaseLogger.info('=== SUBSCRIBING TO RECENT PLAYS ===');
  firebaseLogger.info(`Subscribing to recent plays for FID: ${fid}`);
  
  // Query user's play history collection, ordered by timestamp descending (most recent first)
  // This is the SINGLE SOURCE OF TRUTH for what the user has recently played
  const q = query(playHistoryRef, orderBy('timestamp', 'desc'), limit(30));

  return onSnapshot(q, (snapshot) => {
    firebaseLogger.info(`Received recent plays snapshot update with ${snapshot.docs.length} docs`);
    
    const sortedDocs = snapshot.docs.slice().sort((a, b) => {
      const aData = a.data();
      const bData = b.data();
      const aMs = aData.timestampMs || playTimestampMillis(aData.timestamp);
      const bMs = bData.timestampMs || playTimestampMillis(bData.timestamp);
      return bMs - aMs;
    });

    // One row per mint — mediaKey can differ across plays after URL enrichment.
    const nftByIdentity = new Map<string, NFT>();
    const processedIdentityKeys = new Set<string>();
    
    // Process each play history entry
    for (const playDoc of sortedDocs) {
      const playData = playDoc.data();
      const playedAt = playData.timestampMs || playTimestampMillis(playData.timestamp);
      const nft: NFT = {
        ...nftFromPlayRecord(playData),
        addedToRecentlyPlayed: true,
        addedToRecentlyPlayedAt: playedAt || Date.now(),
      };
      const identityKey = getNftIdentityKey(nft);
      if (!identityKey || processedIdentityKeys.has(identityKey)) continue;

      processedIdentityKeys.add(identityKey);
      const mediaKey = nft.mediaKey || playData.mediaKey;
      if (mediaKey) nft.mediaKey = mediaKey;
      nftByIdentity.set(identityKey, nft);

      if (nftByIdentity.size >= 8) break;
    }
    
    // Convert to array
    const recentNFTs = Array.from(nftByIdentity.values());
    
    firebaseLogger.info(`Recent plays: ${recentNFTs.length} NFTs`);
    callback(recentNFTs);
    applyConfirmedPlayback(recentNFTs, callback);
  });
};

// Fetch NFT details from contract
export const fetchNFTDetails = async (contractAddress: string, tokenId: string): Promise<NFT | null> => {
  try {
    const nftRef = doc(db, 'nft_details', `${contractAddress}-${tokenId}`);
    const snapshot = await getDocs(query(collection(db, 'nft_details'), 
      where('contract', '==', contractAddress),
      where('tokenId', '==', tokenId)
    ));

    if (!snapshot.empty) {
      const data = snapshot.docs[0].data();
      return {
        contract: data.contract,
        tokenId: data.tokenId,
        name: data.name,
        description: data.description,
        image: data.image,
        audio: data.audioUrl,
        hasValidAudio: true,
        metadata: {
          name: data.name,
          description: data.description,
          image: data.image,
          animation_url: data.animationUrl || data.videoUrl || undefined
        },
        collection: {
          name: data.collection
        },
        network: data.network
      };
    }

    // If not in our database, fetch from chain
    const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY;
    if (!neynarKey) throw new Error('Neynar API key not found');

    const response = await fetch(
      `https://api.neynar.com/v2/farcaster/cast?identifier=${contractAddress}&token_id=${tokenId}`,
      {
        headers: {
          'accept': 'application/json',
          'api_key': neynarKey
        }
      }
    );

    const data = await response.json();
    if (!data.result) return null;

    const nft: NFT = {
      contract: contractAddress,
      tokenId: tokenId,
      name: data.result.metadata?.name || 'Untitled NFT',
      description: data.result.metadata?.description,
      image: data.result.metadata?.image || '',
      audio: data.result.metadata?.animation_url || '',
      hasValidAudio: !!data.result.metadata?.animation_url,
      metadata: {
        name: data.result.metadata?.name,
        description: data.result.metadata?.description,
        image: data.result.metadata?.image,
        animation_url: data.result.metadata?.animation_url,
        attributes: data.result.metadata?.attributes
      },
      collection: {
        name: data.result.collection?.name || 'Unknown Collection',
        image: data.result.collection?.image
      },
      network: 'ethereum'
    };

    // Cache the NFT details
    await addDoc(collection(db, 'nft_details'), {
      contract: nft.contract,
      tokenId: nft.tokenId,
      name: nft.name,
      description: nft.description,
      image: nft.image,
      audioUrl: nft.audio,
      collection: nft.collection?.name,
      network: nft.network,
      timestamp: new Date().toISOString()
    });

    return nft;
  } catch (error) {
    firebaseLogger.error('Error fetching NFT details:', error);
    return null;
  }
};

// Add NFT to user's liked collection
export const addLikedNFT = async (fid: number, nft: NFT): Promise<void> => {
  try {
    const docId = `${fid}-${nft.contract}-${nft.tokenId}`;
    const userLikesRef = doc(db, 'user_likes', docId);
    
    firebaseLogger.info('Adding NFT to likes:', { fid, docId });
    
    await setDoc(userLikesRef, {
      name: nft.name || 'Untitled',
      description: nft.description || '',
      image: nft.image || nft.metadata?.image || '',
      audioUrl: nft.audio || nft.metadata?.animation_url || '',
      collection: nft.collection?.name || 'Unknown Collection',
      network: nft.network || 'base',
      timestamp: serverTimestamp()
    });
  } catch (error) {
    firebaseLogger.error('Error adding liked NFT:', error);
    throw error;
  }
};

// Remove NFT from user's liked collection
export const removeLikedNFT = async (fid: number, nft: NFT): Promise<void> => {
  try {
    const docId = `${fid}-${nft.contract}-${nft.tokenId}`;
    const userLikesRef = doc(db, 'user_likes', docId);
    
    // Delete the document for this liked NFT
    await deleteDoc(userLikesRef);
    
    firebaseLogger.info('Removed NFT from likes:', { fid, docId });
  } catch (error) {
    firebaseLogger.error('Error removing liked NFT:', error);
  }
};

// Fetch NFTs for a specific user by their fid
export const fetchUserNFTs = async (fid: number): Promise<NFT[]> => {
  try {
    firebaseLogger.info('=== START NFT FETCH for FID:', fid, ' ===');
    
    // Handle ENS users (negative FID)
    if (fid < 0) {
      firebaseLogger.info('Fetching NFTs for ENS user with synthetic FID:', fid);
      // For ENS users, we should already have their address stored
      const userDoc = await getDoc(doc(db, 'searchedusers', fid.toString()));
      
      if (!userDoc.exists()) {
        firebaseLogger.error('ENS user not found in searchedusers collection');
        return [];
      }
      
      const userData = userDoc.data();
      const address = userData.custody_address;
      const ensName = userData.username || userData.display_name;
      
      if (!address) {
        firebaseLogger.error('No address found for ENS user');
        return [];
      }
      
      firebaseLogger.info(`Found ENS user: ${ensName} with address: ${address}`);
      
      try {
        // Direct import to avoid dynamic import issues
        const { fetchUserNFTsFromAlchemy } = await import('./nft');
        firebaseLogger.info('Successfully imported nft module for ENS user');
        
        // Fetch NFTs for the ENS address with explicit logging
        firebaseLogger.info(`Calling Alchemy API to fetch NFTs for ENS ${ensName} at address: ${address}`);
        const nfts = await fetchUserNFTsFromAlchemy(address);
        
        // Process mediaKeys for all NFTs to ensure consistent tracking
        const processedNFTs = nfts.map((nft: NFT) => {
          // If NFT doesn't have a mediaKey yet (from alchemy fetching)
          if (!nft.mediaKey) {
            // Import the getMediaKey function dynamically to avoid circular dependencies
            const { getMediaKey } = require('../utils/media');
            // Generate and assign the mediaKey based on the content
        nft.mediaKey = getMediaKey(nft);
        if (!nft.mediaKey) {
          firebaseLogger.warn(`Failed to generate mediaKey for NFT ${nft.contract}-${nft.tokenId}`);
        }
          }
          return nft;
        });
        
        firebaseLogger.info('=== ENS NFT FETCH COMPLETE ===');
        firebaseLogger.info(`Total NFTs found for ENS user ${ensName} (${fid}): ${processedNFTs.length} NFTs`);
        
        // Process NFTs for media content (logging only; nft.ts already filtered)
        const mediaNFTs = processedNFTs.filter((nft: NFT) => isPlayableMediaNFT(nft));
        
        firebaseLogger.info(`Found ${mediaNFTs.length} media NFTs out of ${processedNFTs.length} total NFTs for ENS ${ensName} (${address})`);
        
        // Track mediaKeys for stats
        firebaseLogger.info(`MediaKey Stats: ${mediaNFTs.length} unique mediaKeys generated for ${ensName}`);
        return processedNFTs;
      } catch (alchemyError) {
        firebaseLogger.error('Error fetching NFTs from Alchemy for ENS user:', alchemyError);
        return [];
      }
    }
    
    // Regular Farcaster user flow:
    // First check for cached wallet
    const cachedAddress = await getCachedWallet(fid);
    let addresses = new Set<string>();
    
    if (cachedAddress) {
      firebaseLogger.info('Found cached wallet address:', cachedAddress);
      addresses.add(cachedAddress);
    }

    // If no cached wallet, get the user's addresses from searchedusers collection
    firebaseLogger.info('No cached wallet, fetching user data from searchedusers collection...');
    const userDoc = await getDoc(doc(db, 'searchedusers', fid.toString()));
    if (!userDoc.exists()) {
      firebaseLogger.error('User not found in searchedusers collection');
      return [];
    }

    const userData = userDoc.data();
    firebaseLogger.info('User data from searchedusers:', userData);
    
    // Add addresses from user data
    
    // Add custody address if it exists
    if (userData.custody_address) {
      firebaseLogger.info('Found custody address:', userData.custody_address);
      addresses.add(userData.custody_address);
      // Cache this address for future use
      await cacheUserWallet(fid, userData.custody_address);
    }
    
    // Handle both old and new data structures for verified addresses
    if (userData.verifiedAddresses) {
      if (Array.isArray(userData.verifiedAddresses)) {
        // New structure - flat array
        firebaseLogger.info('Found verified addresses (new format):', userData.verifiedAddresses);
        userData.verifiedAddresses.forEach((addr: string) => addresses.add(addr));
      } else if (typeof userData.verifiedAddresses === 'object' && 
                 userData.verifiedAddresses !== null && 
                 'eth_addresses' in userData.verifiedAddresses && 
                 Array.isArray(userData.verifiedAddresses.eth_addresses)) {
        // Old structure - nested eth_addresses
        firebaseLogger.info('Found verified addresses (old format):', userData.verifiedAddresses.eth_addresses);
        userData.verifiedAddresses.eth_addresses.forEach((addr: string) => addresses.add(addr));
      }
    }

    // Convert Set to Array
    const uniqueAddresses = Array.from(addresses);

    if (uniqueAddresses.length === 0) {
      firebaseLogger.info('No addresses found for user');
      return [];
    }

    // Cache first address if no custody address was cached
    if (!userData.custody_address && uniqueAddresses.length > 0) {
      await cacheUserWallet(fid, uniqueAddresses[0]);
    }

    firebaseLogger.info('Total unique addresses to check:', uniqueAddresses.length);
    firebaseLogger.info('Addresses:', uniqueAddresses);

    // If we found no addresses in searchedusers, try getting them from Neynar
    if (uniqueAddresses.length === 0) {
      firebaseLogger.info('No addresses found in searchedusers, fetching from Neynar...');
      const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY;
      if (!neynarKey) throw new Error('Neynar API key not found');

      const profileResponse = await fetchWithRetry(
        `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`,
        {
          headers: {
            'accept': 'application/json',
            'api_key': neynarKey
          }
        }
      );

      const profileData = await profileResponse.json();
      firebaseLogger.info('Neynar profile response:', profileData);

      if (profileData.users?.[0]) {
        const user = profileData.users[0];
        if (user.custody_address) {
          firebaseLogger.info('Found custody address from Neynar:', user.custody_address);
          uniqueAddresses.push(user.custody_address);
          await cacheUserWallet(fid, user.custody_address);
        }
        if (user.verified_addresses?.eth_addresses) {
          firebaseLogger.info('Found verified addresses from Neynar:', user.verified_addresses.eth_addresses);
          user.verified_addresses.eth_addresses.forEach((addr: string) => uniqueAddresses.push(addr));
        }
      }
    }

    if (uniqueAddresses.length === 0) {
      firebaseLogger.info('No addresses found for user after all attempts');
      return [];
    }

    // Fetch NFTs from Alchemy for all addresses
    firebaseLogger.info('Fetching NFTs from Alchemy...');
    const { fetchUserNFTsFromAlchemy } = await import('./nft');
    const alchemyPromises = uniqueAddresses.map(address => {
      firebaseLogger.info('Fetching NFTs for address:', address);
      return fetchUserNFTsFromAlchemy(address);
    });
    
    const alchemyResults = await Promise.all(alchemyPromises);
    firebaseLogger.info('Alchemy results by address:', alchemyResults.map((nfts, i) => ({
      address: uniqueAddresses[i],
      nftCount: nfts.length
    })));
    
    // Deduplicate NFTs by contract+tokenId
    const nftMap = new Map<string, NFT>();
    alchemyResults.flat().forEach(nft => {
      const key = `${nft.contract}-${nft.tokenId}`;
      if (!nftMap.has(key)) {
        // If NFT doesn't have a mediaKey yet (from alchemy fetching)
        if (!nft.mediaKey) {
          // Import the getMediaKey function dynamically to avoid circular dependencies
          const { getMediaKey } = require('../utils/media');
          // Generate and assign the mediaKey based on the content
          nft.mediaKey = getMediaKey(nft);
          if (!nft.mediaKey) {
            firebaseLogger.warn(`Failed to generate mediaKey for NFT ${nft.contract}-${nft.tokenId}`);
          }
        }
        nftMap.set(key, nft);
      }
    });

    const uniqueNFTs = Array.from(nftMap.values());
    firebaseLogger.info('=== NFT FETCH COMPLETE ===');
    firebaseLogger.info('Total unique NFTs found:', uniqueNFTs.length);
    
    // Process NFTs for media content (logging only; nft.ts already filtered)
    const mediaNFTs = uniqueNFTs.filter((nft: NFT) => isPlayableMediaNFT(nft));
    
    firebaseLogger.info(`Found ${mediaNFTs.length} media NFTs out of ${uniqueNFTs.length} total NFTs`);
    
    // Collect mediaKey stats
    const uniqueMediaKeys = new Set(uniqueNFTs.map(nft => nft.mediaKey).filter(Boolean));
    firebaseLogger.info(`MediaKey Stats: ${uniqueMediaKeys.size} unique mediaKeys generated for user ${fid}`);
    
    return uniqueNFTs;
  } catch (error) {
    firebaseLogger.error('Error fetching user NFTs:', error);
    return [];
  }
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithRetry = async (url: string, options: RequestInit, maxRetries = 3): Promise<Response> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      // Add timeout to fetch requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const enhancedOptions = {
        ...options,
        signal: controller.signal
      };
      
      const response = await fetch(url, enhancedOptions);
      clearTimeout(timeoutId);
      
      if (response.status === 429) { // Rate limit
        const waitTime = Math.pow(2, i) * 1000; // Exponential backoff
        firebaseLogger.info(`Rate limited, waiting ${waitTime}ms before retry ${i + 1}/${maxRetries}`);
        await delay(waitTime);
        continue;
      }
      
      // Handle other common error codes
      if (response.status >= 500) {
        firebaseLogger.warn(`Server error ${response.status} from ${url}, retry ${i + 1}/${maxRetries}`);
        await delay(Math.pow(2, i) * 1000);
        continue;
      }
      
      return response;
    } catch (error: any) {
      // Clear any timeout if there was an error
      
      // Check for network connectivity issues
      if (error instanceof TypeError && error.message.includes('fetch')) {
        firebaseLogger.warn(`Network error on attempt ${i + 1}/${maxRetries}: ${error.message}`);
        // Check if we're online
        if (!navigator.onLine) {
          firebaseLogger.error('Device appears to be offline');
        }
      } else if (error.name === 'AbortError') {
        firebaseLogger.warn(`Request timeout on attempt ${i + 1}/${maxRetries}`);
      } else {
        firebaseLogger.error(`Fetch attempt ${i + 1} failed:`, error);
      }
      
      if (i === maxRetries - 1) throw error;
      await delay(Math.pow(2, i) * 1000); // Exponential backoff
    }
  }
  throw new Error(`Failed after ${maxRetries} retries`);
};

// Store featured NFTs in Firebase if they don't exist
export const ensureFeaturedNFTsExist = async (nfts: NFT[]): Promise<void> => {
  try {
    const batch = writeBatch(db);
    
    for (const nft of nfts) {
      const nftRef = doc(db, 'nfts', `${nft.contract}-${nft.tokenId}`);
      const nftDoc = await getDoc(nftRef);
      
      if (!nftDoc.exists()) {
        batch.set(nftRef, {
          ...nft,
          likes: 0,
          plays: 0,
          timestamp: serverTimestamp()
        });
      }
    }
    
    await batch.commit();
    firebaseLogger.info('Featured NFTs stored in Firebase');
  } catch (error) {
    firebaseLogger.error('Error storing featured NFTs:', error);
  }
};

// Declare searchTimeout at module level
let searchTimeout: NodeJS.Timeout | undefined;

// PODPlayr official account details
export const PODPLAYR_ACCOUNT = {
  fid: 1014485,
  username: 'podplayr',
  display_name: 'PODPLAYR',
  pfp_url: 'https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/994e0d0e-3033-4261-64e3-5a91f64ba000/rectcrop3',
  custody_address: '0xdbdb6eb5d90141675eb67d79745031e4668f3fd2',
  connected_address: '0x239cc7fd1f85b18da2d3caf60e406167b2c8b972'
};

// Follow a Farcaster user
export const followUser = async (currentUserFid: number, userToFollow: FarcasterUser): Promise<void> => {
  try {
    if (!currentUserFid || !userToFollow.fid) {
      firebaseLogger.error('Invalid FIDs for follow operation', { currentUserFid, userToFollowFid: userToFollow.fid });
      return;
    }

    firebaseLogger.info(`User ${currentUserFid} is following user ${userToFollow.fid}`);
    
    // Create a document in the following collection
    const followingRef = doc(db, 'users', currentUserFid.toString(), 'following', userToFollow.fid.toString());
    
    // Create a document in the followers collection
    const followerRef = doc(db, 'users', userToFollow.fid.toString(), 'followers', currentUserFid.toString());
    
    // References to the user documents to update counts
    const currentUserRef = doc(db, 'searchedusers', currentUserFid.toString());
    const targetUserRef = doc(db, 'searchedusers', userToFollow.fid.toString());
    
    // Prepare the follow data
    let pfpUrl = userToFollow.pfp_url || `https://avatar.vercel.sh/${userToFollow.username}`;
    
    // Special handling for PODPlayr account to ensure correct profile image
    if (userToFollow.fid === PODPLAYR_ACCOUNT.fid) {
      firebaseLogger.info('Following PODPlayr account - using official profile image');
      pfpUrl = PODPLAYR_ACCOUNT.pfp_url;
    }
    
    const followData = {
      fid: userToFollow.fid,
      username: userToFollow.username,
      display_name: userToFollow.display_name || userToFollow.username,
      pfp_url: pfpUrl,
      timestamp: serverTimestamp()
    };
    
    // Read the current user's own cached profile (if any) to populate the follower doc.
    // No existence check needed here — this is a plain read, and every write below
    // uses setDoc+merge so it's safe regardless of whether these docs exist yet.
    const currentUserSnapshot = await getDoc(currentUserRef);
    const currentUserData = currentUserSnapshot.exists() ? currentUserSnapshot.data() : {};
    
    // Best-available synchronous data — good enough to commit immediately.
    // If it's not great (auto-generated username), we refine it in the background below
    // rather than blocking the whole follow action on a Neynar round trip.
    const followerData = {
      fid: currentUserFid,
      username: currentUserData.username || `user${currentUserFid}`,
      display_name: currentUserData.display_name || currentUserData.username || `User ${currentUserFid}`,
      pfp_url: currentUserData.pfp_url || `https://avatar.vercel.sh/${currentUserData.username || currentUserFid}`,
      timestamp: serverTimestamp()
    };
    
    // Use a batch write to ensure all operations succeed or fail together.
    // set()+merge is used for the counters so this never fails just because
    // the searchedusers doc hasn't been created yet.
    const batch = writeBatch(db);
    batch.set(followingRef, followData);
    batch.set(followerRef, followerData);
    batch.set(currentUserRef, { followingCount: increment(1) }, { merge: true });
    batch.set(targetUserRef, { followerCount: increment(1) }, { merge: true });
    
    // Commit the batch
    await batch.commit();
    firebaseLogger.info(`Successfully followed user ${userToFollow.username}`);
    
    // Refine the follower doc's profile info in the background if it looked incomplete.
    // Doesn't block the follow action on an external API round trip.
    if (!currentUserData.username || followerData.username.startsWith('user')) {
      refreshFollowerProfileInBackground(currentUserFid, followerRef);
    }
  } catch (error) {
    firebaseLogger.error('Error following user:', error);
    throw error;
  }
};

/** Fire-and-forget: fetch fresher Neynar profile data for a follower doc after the follow already committed. */
const refreshFollowerProfileInBackground = (fid: number, followerRef: ReturnType<typeof doc>): void => {
  (async () => {
    try {
      const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY;
      const profileResponse = await fetchWithRetry(
        `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`,
        {
          headers: {
            'accept': 'application/json',
            'api_key': neynarKey || ''
          }
        }
      );
      
      if (profileResponse.ok) {
        const profileData = await profileResponse.json();
        const userData = profileData?.users?.[0];
        if (userData) {
          await setDoc(followerRef, {
            username: userData.username,
            display_name: userData.display_name || userData.username,
            pfp_url: userData.pfp_url || `https://avatar.vercel.sh/${userData.username}`
          }, { merge: true });
        }
      }
    } catch (error) {
      // Non-critical background refresh — the follow itself already succeeded
      console.error('Error refreshing follower profile in background:', error);
    }
  })();
};

// Manual repair utility for the PODPlayr account specifically: forces a fresh full
// recount (bypassing the cache) and ensures its searchedusers doc has base profile
// fields. NOT called on any hot path anymore — followUser/unfollowUser already keep
// PODPlayr's followerCount correctly incremented for free on every mandatory-follow.
// Call this by hand only if drift is ever suspected.
export const updatePodplayrFollowerCount = async (): Promise<number> => {
  try {
    const followerCount = await recomputeFollowerCount(PODPLAYR_ACCOUNT.fid);
    
    // Make sure the base profile fields exist (harmless no-op merge if they already do)
    await setDoc(doc(db, 'searchedusers', PODPLAYR_ACCOUNT.fid.toString()), {
      fid: PODPLAYR_ACCOUNT.fid,
      username: PODPLAYR_ACCOUNT.username,
      display_name: PODPLAYR_ACCOUNT.display_name,
      pfp_url: PODPLAYR_ACCOUNT.pfp_url,
    }, { merge: true });
    
    return followerCount;
  } catch (error) {
    console.error('Error updating PODPlayr follower count:', error);
    return 0;
  }
};

// Update the followers subcollection for PODPlayr
async function updatePodplayrFollowersSubcollection(userDocs: QueryDocumentSnapshot<DocumentData>[]): Promise<void> {
  try {
    
    // Process each user
    for (const userDoc of userDocs) {
      const userFid = userDoc.id;
      
      // Skip if this is the PODPlayr account itself
      if (userFid === PODPLAYR_ACCOUNT.fid.toString()) continue;
      
      // Reference to this user in PODPlayr's followers collection
      const followerRef = doc(db, 'users', PODPLAYR_ACCOUNT.fid.toString(), 'followers', userFid);
      const followerDoc = await getDoc(followerRef);
      
      if (!followerDoc.exists()) {
        // User is not in PODPlayr's followers collection, add them
        
        // Try to get user data from searchedusers collection
        let followerData: any = {
          fid: parseInt(userFid),
          username: `user${userFid}`,
          display_name: `User ${userFid}`,
          pfp_url: `https://avatar.vercel.sh/user${userFid}`,
          timestamp: serverTimestamp()
        };
        
        try {
          const userData = await getDoc(doc(db, 'searchedusers', userFid));
          if (userData.exists()) {
            const userInfo = userData.data();
            if (userInfo.username) followerData.username = userInfo.username;
            if (userInfo.display_name) followerData.display_name = userInfo.display_name;
            if (userInfo.pfp_url) followerData.pfp_url = userInfo.pfp_url;
          }
        } catch (e) {
          console.error(`Error getting user data for ${userFid}:`, e);
          // Continue with default data if we can't get better data
        }
        
        // Add user to PODPlayr's followers
        await setDoc(followerRef, followerData);
      }
    }
    
  } catch (error) {
    console.error('Error updating PODPlayr followers subcollection:', error);
  }
};

// Ensure user follows the PODPlayr account
export const ensurePodplayrFollow = async (userFid: number): Promise<void> => {
  try {
    if (!userFid) return;
    
    // Prevent PODPlayr from following itself
    if (userFid === PODPLAYR_ACCOUNT.fid) {
      return;
    }
    
    
    // Check if the user already follows PODPlayr
    const isFollowing = await isUserFollowed(userFid, PODPLAYR_ACCOUNT.fid);
    
    if (!isFollowing) {
      
      // Create PODPlayr user object
      const podplayrUser: FarcasterUser = {
        fid: PODPLAYR_ACCOUNT.fid,
        username: PODPLAYR_ACCOUNT.username,
        display_name: PODPLAYR_ACCOUNT.display_name,
        pfp_url: PODPLAYR_ACCOUNT.pfp_url,
        custody_address: PODPLAYR_ACCOUNT.custody_address,
        verified_addresses: { eth_addresses: [PODPLAYR_ACCOUNT.connected_address] },
        follower_count: 0,
        following_count: 0
      };
      
      // Force follow the PODPlayr account. followUser() already atomically
      // increments PODPlayr's cached followerCount — no separate recompute needed.
      await followUser(userFid, podplayrUser);
      
    } else {
      
      // Even if already following, ensure the profile image is up to date
      const followingRef = doc(db, 'users', userFid.toString(), 'following', PODPLAYR_ACCOUNT.fid.toString());
      await updateDoc(followingRef, {
        pfp_url: PODPLAYR_ACCOUNT.pfp_url
      });
    }
  } catch (error) {
    console.error('Error ensuring PODPlayr follow:', error);
  }
};

// Unfollow a Farcaster user
export const unfollowUser = async (currentUserFid: number, userToUnfollow: FarcasterUser): Promise<void> => {
  try {
    if (!currentUserFid || !userToUnfollow.fid) {
      console.error('Invalid FIDs for unfollow operation', { currentUserFid, userToUnfollowFid: userToUnfollow.fid });
      return;
    }

    
    // References to the documents to delete
    const followingRef = doc(db, 'users', currentUserFid.toString(), 'following', userToUnfollow.fid.toString());
    const followerRef = doc(db, 'users', userToUnfollow.fid.toString(), 'followers', currentUserFid.toString());
    
    // References to the user documents to update counts
    const currentUserRef = doc(db, 'searchedusers', currentUserFid.toString());
    const targetUserRef = doc(db, 'searchedusers', userToUnfollow.fid.toString());
    
    // Use a batch write to ensure all operations succeed or fail together
    const batch = writeBatch(db);
    batch.delete(followingRef);
    batch.delete(followerRef);
    
    // set()+merge (not update()) so this never fails just because the
    // searchedusers doc doesn't exist yet — previously this could throw and
    // abort the whole batch (including the actual unfollow) in that case.
    batch.set(currentUserRef, { followingCount: increment(-1) }, { merge: true });
    batch.set(targetUserRef, { followerCount: increment(-1) }, { merge: true });
    
    // Commit the batch
    await batch.commit();
  } catch (error) {
    console.error('Error unfollowing user:', error);
    throw error;
  }
};

// Check if a user is followed
export const isUserFollowed = async (currentUserFid: number, userFid: number): Promise<boolean> => {
  try {
    if (!currentUserFid || !userFid) {
      return false;
    }
    
    const followingRef = doc(db, 'users', currentUserFid.toString(), 'following', userFid.toString());
    const followDoc = await getDoc(followingRef);
    
    return followDoc.exists();
  } catch (error) {
    console.error('Error checking if user is followed:', error);
    return false;
  }
};

// Toggle follow status for a user
export const toggleFollowUser = async (currentUserFid: number, user: FarcasterUser): Promise<boolean> => {
  try {
    // Prevent users from following themselves
    if (currentUserFid === user.fid) {
      return false;
    }
    
    // Prevent unfollowing the PODPlayr account
    if (user.fid === PODPLAYR_ACCOUNT.fid) {
      // If not already following, follow the PODPlayr account
      const isAlreadyFollowing = await isUserFollowed(currentUserFid, PODPLAYR_ACCOUNT.fid);
      if (!isAlreadyFollowing) {
        await followUser(currentUserFid, user);
      }
      return true; // Always return true for PODPlayr account
    }
    
    const isFollowed = await isUserFollowed(currentUserFid, user.fid);
    
    if (isFollowed) {
      await unfollowUser(currentUserFid, user);
      return false; // User is now unfollowed
    } else {
      await followUser(currentUserFid, user);
      return true; // User is now followed
    }
  } catch (error) {
    console.error('Error toggling follow status:', error);
    throw error;
  }
};

// Get all users that the current user is following
export const getFollowingUsers = async (currentUserFid: number): Promise<FollowedUser[]> => {
  try {
    const followingRef = collection(db, 'users', currentUserFid.toString(), 'following');
    const querySnapshot = await getDocs(followingRef);
    
    const followingUsers: FollowedUser[] = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      followingUsers.push({
        fid: data.fid,
        username: data.username,
        display_name: data.display_name || data.username,
        pfp_url: data.pfp_url || `https://avatar.vercel.sh/${data.username}`,
        // Legacy docs use `followed_at`; anything with neither sorts as oldest.
        timestamp: data.timestamp?.toDate() || data.followed_at?.toDate() || new Date(0)
      });
    });

    // Sort by most recently followed first
    return followingUsers.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  } catch (error) {
    console.error('Error getting following users:', error);
    return [];
  }
};

/** Paginated full count of a users/{fid}/{subcollection} — expensive, only meant to be called once per fid to seed the cached counter. */
const countSubcollection = async (fid: number, subcollection: 'following' | 'followers'): Promise<number> => {
  const colRef = collection(db, 'users', fid.toString(), subcollection);
  let q = query(colRef, limit(500));
  let lastDoc = null;
  let total = 0;
  let hasMoreDocs = true;
  
  while (hasMoreDocs) {
    if (lastDoc) {
      q = query(colRef, startAfter(lastDoc), limit(500));
    }
    
    const querySnapshot = await getDocs(q);
    const batchSize = querySnapshot.size;
    total += batchSize;
    
    if (batchSize < 500) {
      hasMoreDocs = false;
    } else {
      lastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
    }
  }
  
  return total;
};

/** Manual repair utility: force a fresh full recount and re-cache it. Not on any hot path — call by hand if drift is ever suspected. */
export const recomputeFollowingCount = async (userFid: number): Promise<number> => {
  try {
    const total = await countSubcollection(userFid, 'following');
    await setDoc(doc(db, 'searchedusers', userFid.toString()), { followingCount: total }, { merge: true });
    return total;
  } catch (error) {
    console.error('Error recomputing following count:', error);
    return 0;
  }
};

/** Manual repair utility: force a fresh full recount and re-cache it. Not on any hot path — call by hand if drift is ever suspected. */
export const recomputeFollowerCount = async (userFid: number): Promise<number> => {
  try {
    const total = await countSubcollection(userFid, 'followers');
    await setDoc(doc(db, 'searchedusers', userFid.toString()), { followerCount: total }, { merge: true });
    firebaseLogger.info(`Recomputed follower count for ${userFid}: ${total}`);
    return total;
  } catch (error) {
    console.error('Error recomputing follower count:', error);
    return 0;
  }
};

// Get the count of users that the current user is following
export const getFollowingCount = async (userFid: number): Promise<number> => {
  if (!userFid) return 0;
  return deduplicateCall(`followingCount-${userFid}`, async () => {
    try {
      const userDoc = await getDoc(doc(db, 'searchedusers', userFid.toString()));
      const cached = userDoc.exists() ? userDoc.data().followingCount : undefined;
      if (typeof cached === 'number') {
        return cached;
      }
      // Never computed under the current scheme yet — scan once and cache for next time.
      return await recomputeFollowingCount(userFid);
    } catch (error) {
      console.error('Error getting following count:', error);
      return 0;
    }
  });
};

// Get the count of users that follow the current user
export const getFollowersCount = async (userFid: number): Promise<number> => {
  if (!userFid) return 0;
  return deduplicateCall(`followerCount-${userFid}`, async () => {
    try {
      const userDoc = await getDoc(doc(db, 'searchedusers', userFid.toString()));
      const cached = userDoc.exists() ? userDoc.data().followerCount : undefined;
      if (typeof cached === 'number') {
        return cached;
      }
      // Never computed under the current scheme yet — scan once and cache for next time.
      return await recomputeFollowerCount(userFid);
    } catch (error) {
      console.error('Error getting followers count:', error);
      return 0;
    }
  });
};

// Get all users that follow the current user
export const getFollowers = async (userFid: number): Promise<FollowedUser[]> => {
  try {
    // No orderBy — see subscribeToFollowingUsers for why (would silently
    // drop legacy docs that lack a `timestamp` field).
    const followersRef = collection(db, 'users', userFid.toString(), 'followers');
    const snapshot = await getDocs(followersRef);

    const followers: FollowedUser[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      followers.push({
        fid: data.fid,
        username: data.username,
        display_name: data.display_name || data.username,
        pfp_url: data.pfp_url || `https://avatar.vercel.sh/${data.username}`,
        timestamp: data.timestamp?.toDate() || data.followed_at?.toDate() || new Date(0)
      });
    });

    return followers.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  } catch (error) {
    console.error('Error getting followers:', error);
    return [];
  }
};

// Subscribe to following users for real-time updates
export const subscribeToFollowingUsers = (currentUserFid: number, callback: (users: FollowedUser[]) => void) => {
  if (!currentUserFid) {
    callback([]);
    return () => {}; // Return empty unsubscribe function
  }
  
  // No orderBy here on purpose: Firestore silently excludes any document
  // that lacks the field being ordered on, and some legacy-migrated docs
  // only have `followed_at` instead of `timestamp` — they'd vanish from
  // this list entirely even though they're real follows. Fetch everything
  // and sort client-side instead so nothing gets silently hidden.
  const followingRef = collection(db, 'users', currentUserFid.toString(), 'following');
  
  return onSnapshot(followingRef, (snapshot) => {
    const followingUsers: FollowedUser[] = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      followingUsers.push({
        fid: data.fid,
        username: data.username,
        display_name: data.display_name || data.username,
        pfp_url: data.pfp_url || `https://avatar.vercel.sh/${data.username}`,
        // Legacy docs use `followed_at`; anything with neither sorts as oldest.
        timestamp: data.timestamp?.toDate() || data.followed_at?.toDate() || new Date(0)
      });
    });
    
    followingUsers.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    callback(followingUsers);
  }, (error) => {
    console.error('Error subscribing to following users:', error);
    callback([]);
  });
};

// Subscribe to followers for real-time updates
export const subscribeToFollowers = (userFid: number, callback: (users: FollowedUser[]) => void) => {
  if (!userFid) {
    callback([]);
    return () => {}; // Return empty unsubscribe function
  }
  
  // See subscribeToFollowingUsers above for why there's no orderBy here.
  const followersRef = collection(db, 'users', userFid.toString(), 'followers');
  
  return onSnapshot(followersRef, (snapshot) => {
    const followers: FollowedUser[] = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      followers.push({
        fid: data.fid,
        username: data.username,
        display_name: data.display_name || data.username,
        pfp_url: data.pfp_url || `https://avatar.vercel.sh/${data.username}`,
        timestamp: data.timestamp?.toDate() || data.followed_at?.toDate() || new Date(0)
      });
    });
    
    followers.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    callback(followers);
  }, (error) => {
    console.error('Error subscribing to followers:', error);
    callback([]);
  });
};

// Get total play count for a user
export const getUserTotalPlays = async (userFid: number): Promise<number> => {
  try {
    if (!userFid) {
      console.error('Invalid userFid provided to getUserTotalPlays');
      return 0;
    }
    
    const userRef = doc(db, 'users', userFid.toString());
    const playHistoryRef = collection(userRef, 'playHistory');
    
    // Use pagination to count all plays in case there are many
    let q = query(playHistoryRef, limit(500));
    let totalPlays = 0;
    let lastDoc = null;
    let hasMoreDocs = true;
    
    while (hasMoreDocs) {
      if (lastDoc) {
        q = query(playHistoryRef, startAfter(lastDoc), limit(500));
      }
      
      const querySnapshot = await getDocs(q);
      const batchSize = querySnapshot.size;
      
      totalPlays += batchSize;
      
      if (batchSize < 500) {
        hasMoreDocs = false;
      } else {
        lastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
      }
    }
    
    return totalPlays;
  } catch (error) {
    console.error('Error getting user total plays:', error);
    return 0;
  }
};

// Get the count of NFTs a user has liked
export const getUserLikedNFTsCount = async (userFid: number): Promise<number> => {
  try {
    if (!userFid) {
      console.error('Invalid userFid provided to getUserLikedNFTsCount');
      return 0;
    }
    
    // FIXED: Query the user's likes subcollection directly
    // This matches how likes are actually stored in Firebase
    const userRef = doc(db, 'users', userFid.toString());
    const userLikesRef = collection(userRef, 'likes');
    
    // Use pagination to count all liked NFTs in case there are many
    let totalLiked = 0;
    let lastDoc = null;
    let hasMoreDocs = true;
    let currentQuery = query(userLikesRef, limit(500));
    
    while (hasMoreDocs) {
      if (lastDoc) {
        currentQuery = query(
          userLikesRef,
          startAfter(lastDoc),
          limit(500)
        );
      }
      
      const querySnapshot = await getDocs(currentQuery);
      const batchSize = querySnapshot.size;
      
      totalLiked += batchSize;
      
      if (batchSize < 500) {
        hasMoreDocs = false;
      } else {
        lastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
      }
    }
    
    // Also check the global likes collection as a fallback
    // Some likes might be stored here with the userFid field
    const globalLikesRef = collection(db, 'likes');
    const globalLikesQuery = query(
      globalLikesRef,
      where('userFid', '==', userFid),
      where('isLiked', '==', true),
      limit(500)
    );
    
    const globalSnapshot = await getDocs(globalLikesQuery);
    totalLiked += globalSnapshot.size;
    
    return totalLiked;
  } catch (error) {
    console.error('Error getting user liked NFTs count:', error);
    return 0;
  }
};

/**
 * Search for users by Ethereum address
 * @param address The Ethereum address to search for
 * @returns Array of FarcasterUser objects that match the address
 */
export const searchUsersByAddress = async (address: string): Promise<FarcasterUser[]> => {
  // Validate the address
  if (!address || !address.startsWith('0x') || address.length !== 42) {
    console.warn('Invalid Ethereum address format:', address);
    return [];
  }
  
  try {
    const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY;
    if (!neynarKey) throw new Error('Neynar API key not found');

    
    // Use the correct Neynar API endpoint
    const endpoint = `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${address}`;
    
    const response = await fetchWithRetry(endpoint, {
      headers: {
        'accept': 'application/json',
        'api_key': neynarKey
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      let code = '';
      try {
        code = String(JSON.parse(errorText)?.code || '');
      } catch {
        // ignore parse errors
      }
      // No Farcaster account linked to this wallet — not a failure.
      if (response.status === 404 || code === 'NotFound') {
        return [];
      }
      console.warn('Neynar bulk-by-address failed:', response.status, errorText);
      return [];
    }

    const data = await response.json();

    // Neynar bulk-by-address returns `{ [address]: User[] }`; some versions use `{ users: [] }`.
    let rawUsers: any[] = [];
    if (Array.isArray(data.users)) {
      rawUsers = data.users;
    } else if (data && typeof data === 'object') {
      rawUsers = Object.values(data).flat().filter((user: any) => user && typeof user === 'object' && user.fid);
    }

    if (rawUsers.length === 0) {
      return [];
    }

    return rawUsers.map((user: any) => {
      return {
        fid: user.fid,
        username: user.username,
        display_name: user.display_name,
        pfp_url: user.pfp_url,
        follower_count: user.follower_count,
        following_count: user.following_count,
        profile: {
          bio: user.profile?.bio
        },
        verified_addresses: user.verified_addresses,
        custody_address: user.custody_address
      };
    });
  } catch (error) {
    console.error('Error searching users by address:', error);
    return [];
  }
};

export const searchUsers = async (queryString: string): Promise<FarcasterUser[]> => {
  queryString = normalizeSearchQuery(queryString);

  // Clear any pending search
  if (searchTimeout) clearTimeout(searchTimeout);

  // Return early if query is too short, but allow single digits (FIDs)
  if (queryString.length < 1 || (queryString.length === 1 && isNaN(Number(queryString)))) return [];
  
  // Check if this is a negative FID (ENS user)
  const queryAsNumber = Number(queryString);
  if (!isNaN(queryAsNumber) && queryAsNumber < 0) {
    
    try {
      // Try to get ENS user from Firebase
      const ensUserRef = doc(db, 'searchedusers', queryAsNumber.toString());
      const ensUserDoc = await getDoc(ensUserRef);
      
      if (ensUserDoc.exists()) {
        const ensUserData = ensUserDoc.data() as FarcasterUser;
        return [ensUserData];
      } else {
        return [];
      }
    } catch (error) {
      console.error('Error fetching ENS user from Firebase:', error);
      return [];
    }
  }
  
  // Prevent searching for incomplete ENS names (e.g. while typing "mister.et")
  // This avoids unnecessary ENS lookups during typing
  const isIncompleteEnsName = queryString.includes('.') && !queryString.endsWith('.eth');
  if (isIncompleteEnsName) {
    return [];
  }
  
  try {
    const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY;
    if (!neynarKey) {
      console.error('❌ Neynar API key not found');
      throw new Error('Neynar API key not found');
    }
    
    // Add debug logging
    
    // Check if query is a number first (FID check should come before ENS check)
    const isFid = /^\d+$/.test(queryString);
    
    // FOR FID SEARCHES: Check Firebase first before making API call
    if (isFid) {
      try {
        const userRef = doc(db, 'searchedusers', queryString);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
          const userData = userDoc.data() as FarcasterUser;
          return [userData];
        }
      } catch (firebaseError) {
        console.error('Error checking Firebase cache:', firebaseError);
        // Continue to API call as fallback
      }
    }
    
    // Only perform ENS lookup when the query ends with .eth AND is not a FID
    // This is the ONLY condition for ENS lookups - strict separation
    const isEnsQuery = queryString.endsWith('.eth') && !isFid;
    
    // CASE 1: ENS NAME SEARCH - Only when query explicitly ends with .eth
    if (isEnsQuery) {
      try {
        // Dynamically import ENS functions to avoid circular dependencies
        const { getEnsProfile } = await import('./ens');
        const { createENSUser } = await import('../types/ens');
        const ensProfile = await getEnsProfile(queryString);
        
        if (ensProfile && ensProfile.address) {
          // Create the ENS user
          const ensUser = createENSUser(ensProfile);
          
          // Check if this ENS address matches any Farcaster user's wallet
          // First, check in our local database
          try {
            const usersRef = collection(db, 'searchedusers');
            const q = query(usersRef, 
              where('custody_address', '==', ensProfile.address.toLowerCase()),
              where('isENS', '==', false), // Only get Farcaster users
              limit(1)
            );
            
            const snapshot = await getDocs(q);
            
            if (!snapshot.empty) {
              // Found a Farcaster user with the same wallet address
              const farcasterUser = snapshot.docs[0].data() as FarcasterUser;
              
              // Add a linked identity property to both users
              ensUser.linkedIdentity = {
                type: 'farcaster',
                fid: farcasterUser.fid,
                username: farcasterUser.username || '',
                display_name: farcasterUser.display_name || farcasterUser.username || ''
              };
              
              // Return the ENS user with the linked identity information
              return [ensUser];
            }
            
            // If no match found in our database, try the Neynar API as a fallback
            // This would require additional implementation to query by address
            // For now, just return the ENS user
            return [ensUser];
          } catch (error) {
            console.error('Error checking for wallet matches:', error);
            // If there's an error, just return the ENS user
            return [ensUser];
          }
        }
        // If no ENS profile found, continue with Farcaster search as fallback
      } catch (ensError) {
        console.error('Error during ENS lookup:', ensError instanceof Error ? ensError.message : `${ensError}`);
        // Continue with Farcaster search as fallback
      }
    }
    
    // CASE 2: FARCASTER USER SEARCH (including FID searches)
    const endpoint = isFid 
      ? `https://api.neynar.com/v2/farcaster/user/bulk?fids=${queryString}`
      : `https://api.neynar.com/v2/farcaster/user/search?q=${encodeURIComponent(queryString)}`;

    const response = await fetchWithRetry(endpoint, {
      headers: {
        'accept': 'application/json',
        'api_key': neynarKey
      }
    });

    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API Error Response:', errorText);
      throw new Error(`Failed to fetch user data: ${errorText}`);
    }

    const data = await response.json();
    
    // Handle different response structures for search vs bulk lookup
    let users = isFid ? data.users : data.result?.users || [];
    if (!isFid) {
      users = rankByExactFname(users, queryString);
    }
    
    // If we got users from search, fetch their full profiles
    if (!isFid && users.length > 0) {
      const fids = users
        .map((u: any) => parseInt(u.fid, 10))
        .filter((fid: number) => Number.isInteger(fid) && fid > 0 && fid <= 2147483647)
        .join(',');
      
      const profileResponse = await fetchWithRetry(
        `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fids}`,
        {
          headers: {
            'accept': 'application/json',
            'api_key': neynarKey
          }
        }
      );

      
      if (!profileResponse.ok) {
        const errorText = await profileResponse.text();
        console.error('❌ Profile Error Response:', errorText);
        throw new Error(`Failed to fetch user profiles: ${errorText}`);
      }

      const profileData = await profileResponse.json();
      users = profileData.users;
    }

    // Process Farcaster users
    const farcasterUsers = users.map((user: any) => {
      let allAddresses: string[] = [];

      // Get verified addresses
      if (user.verifications) {
        allAddresses = [...user.verifications];
      }

      // Get custody address
      if (user.custody_address) {
        allAddresses.push(user.custody_address);
      }

      // Filter addresses
      allAddresses = [...new Set(allAddresses)].filter(addr => 
        addr && addr.startsWith('0x') && addr.length === 42
      );


      // Special handling for PODPlayr account follower count
      let followerCount = user.follower_count || 0;
      
      if (user.fid === PODPLAYR_ACCOUNT.fid) {
        // This will update asynchronously - not blocking the UI
        (async () => {
          try {
            // The authoritative in-app follower count is the atomically
            // incremented `followerCount` field (kept in sync by
            // followUser/unfollowUser) — not the size of the `users`
            // collection, which only has a doc for users who've uploaded
            // a profile background image and badly undercounts real users.
            const podplayrDocRef = doc(db, 'searchedusers', PODPLAYR_ACCOUNT.fid.toString());
            const podplayrDoc = await getDoc(podplayrDocRef);
            const cachedFollowerCount = podplayrDoc.exists() ? podplayrDoc.data().followerCount : undefined;
            
            // Only update if the cached counter is present and different
            if (typeof cachedFollowerCount === 'number' && cachedFollowerCount !== followerCount) {
              firebaseLogger.info(`Correcting PODPlayr follower_count from ${followerCount} to ${cachedFollowerCount}`);
              
              // Update the searchedusers record with the correct count
              await updateDoc(podplayrDocRef, {
                follower_count: cachedFollowerCount
              });
            }
          } catch (error) {
            console.error('Error updating PODPlayr follower count:', error);
          }
        })();
      }
      
      // Extract bio from the API response and normalize it to a string
      let bioText = "";
      const bio = user.profile?.bio;
      
      // Handle different possible bio formats
      if (typeof bio === 'string') {
        bioText = bio;
      } else if (bio && typeof bio === 'object') {
        // Some APIs return bio as an object with a text property
        const bioObj = bio as any;
        bioText = bioObj.text || "";
      }
      
      return {
        fid: user.fid,
        username: user.username,
        display_name: user.display_name || user.username,
        pfp_url: user.pfp_url || `https://avatar.vercel.sh/${user.username}`,
        follower_count: followerCount,
        following_count: user.following_count || 0,
        custody_address: user.custody_address,
        verified_addresses: {
          eth_addresses: allAddresses
        },
        // Include profile object with bio as a string
        profile: {
          bio: bioText
        }
      };
    });
    
    // Save users to Firebase cache after successful API call
    if (farcasterUsers.length > 0) {
      try {
        // Save each user to Firebase cache for future lookups
        const savePromises = farcasterUsers.map(async (user: FarcasterUser) => {
          const userRef = doc(db, 'searchedusers', user.fid.toString());
          const now = new Date().getTime();
          
          const userData = {
            fid: user.fid,
            username: user.username,
            display_name: user.display_name,
            pfp_url: user.pfp_url,
            custody_address: user.custody_address,
            verifiedAddresses: user.verified_addresses?.eth_addresses || [],
            follower_count: user.follower_count,
            following_count: user.following_count,
            lastSearched: now,
            searchCount: increment(1),
            bio: user.profile?.bio || "",
            isENS: false
          };
          
          await setDoc(userRef, userData, { merge: true });
        });
        
        await Promise.all(savePromises);
      } catch (cacheError) {
        console.error('Error saving users to Firebase cache:', cacheError);
        // Don't throw - return the users even if caching fails
      }
    }
    
    // IMPORTANT: Never mix ENS and Farcaster results unless explicitly searching for an ENS name
    // For regular Farcaster searches, only return Farcaster results
    
    // If we explicitly searched for an ENS name (query ends with .eth) and found a result,
    // we should have returned it by now at the top of this function
    
    // Return only the Farcaster results - no automatic ENS lookups
    
    // By this point, if it was an ENS query, we either returned the ENS result
    // or continued with Farcaster search as a fallback. No need to check again.
    
    return farcasterUsers;
  } catch (error) {
    console.error('❌ Search Users Error:', error);
    
    // Check if query is a number for the fallback logic
    const isFid = !isNaN(Number(queryString));
    
    // Only try ENS as fallback if the query explicitly ends with .eth AND is not a FID
    // This maintains strict separation between ENS and Farcaster searches
    if (queryString.endsWith('.eth') && !isFid) {
      try {
        const { getEnsProfile } = await import('./ens');
        const { createENSUser } = await import('../types/ens');
        const ensProfile = await getEnsProfile(queryString);
        
        if (ensProfile && ensProfile.address) {
          const ensUser = createENSUser(ensProfile);
          return [ensUser];
        }
      } catch (ensError) {
        console.error('Error during ENS fallback lookup:', ensError);
      }
    }
    
    return []; // Return empty array instead of throwing to maintain backward compatibility
  }
};

// Short TTL cache so reopening the same Followers modal shortly after doesn't
// repeat the whole Firestore + Neynar refresh dance.
const followerProfilesCache = new Map<number, { data: FollowedUser[]; timestamp: number }>();
const FOLLOWER_PROFILES_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// Enhance the getFollowerProfiles function to always fetch complete profiles
export async function getFollowerProfiles(targetFid: number): Promise<FollowedUser[]> {
  if (!targetFid) {
    console.error('Invalid FID provided for fetching followers');
    return [];
  }
  
  const cached = followerProfilesCache.get(targetFid);
  if (cached && Date.now() - cached.timestamp < FOLLOWER_PROFILES_CACHE_TTL) {
    return cached.data;
  }
  
  return deduplicateCall(`followerProfiles-${targetFid}`, async () => {
    try {
      // Fetch followers from Firestore first
      const followersRef = collection(db, 'users', targetFid.toString(), 'followers');
      const snapshot = await getDocs(followersRef);
      
      // Create a Map to maintain unique FIDs and their basic profile data
      const followersMap = new Map<number, FollowedUser>();
      const followerFids: number[] = [];
      
      // Process followers from the database
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.fid) {
          followersMap.set(data.fid, {
            fid: data.fid,
            username: data.username || `user${data.fid}`,
            display_name: data.display_name || data.username || `User ${data.fid}`,
            pfp_url: data.pfp_url || `https://avatar.vercel.sh/${data.username || data.fid}`,
            timestamp: data.timestamp?.toDate() || new Date()
          });
          followerFids.push(data.fid);
        }
      });
      
      // CRITICAL: Always fetch latest profiles from Neynar API to ensure we have current data
      if (followerFids.length > 0) {
        try {
          const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY;
          if (!neynarKey) throw new Error('Neynar API key not found');
          
          // Batch profiles in groups of 50 (Neynar API limit) — fetched in parallel
          // instead of sequentially, since each batch is independent.
          const batchSize = 50;
          const fidBatches: number[][] = [];
          for (let i = 0; i < followerFids.length; i += batchSize) {
            fidBatches.push(followerFids.slice(i, i + batchSize));
          }
          
          const batchResults = await Promise.all(
            fidBatches.map(async (batch) => {
              try {
                const profileResponse = await fetchWithRetry(
                  `https://api.neynar.com/v2/farcaster/user/bulk?fids=${batch.join(',')}`,
                  {
                    headers: {
                      'accept': 'application/json',
                      'api_key': neynarKey
                    }
                  }
                );
                if (profileResponse.ok) {
                  const profileData = await profileResponse.json();
                  return profileData?.users || [];
                }
                return [];
              } catch (batchError) {
                console.error('Error fetching Neynar profile batch:', batchError);
                return [];
              }
            })
          );
          
          // Update the followers Map with complete profile data, and collect
          // the writes needed to refresh Firestore's cached copies.
          const refreshedFids: number[] = [];
          for (const user of batchResults.flat()) {
            if (followersMap.has(user.fid)) {
              const existingData = followersMap.get(user.fid)!;
              followersMap.set(user.fid, {
                ...existingData,
                username: user.username,
                display_name: user.display_name || user.username,
                pfp_url: user.pfp_url || `https://avatar.vercel.sh/${user.username}`
              });
              refreshedFids.push(user.fid);
            }
          }
          
          // Persist the refreshed profiles back to Firestore in batched writes
          // (Firestore batches cap at 500 operations) instead of one sequential
          // updateDoc per follower.
          const writeChunkSize = 450;
          for (let i = 0; i < refreshedFids.length; i += writeChunkSize) {
            const chunk = refreshedFids.slice(i, i + writeChunkSize);
            const writeBatchOp = writeBatch(db);
            for (const fid of chunk) {
              const followerData = followersMap.get(fid)!;
              const followerRef = doc(db, 'users', targetFid.toString(), 'followers', fid.toString());
              writeBatchOp.set(followerRef, {
                username: followerData.username,
                display_name: followerData.display_name,
                pfp_url: followerData.pfp_url
              }, { merge: true });
            }
            await writeBatchOp.commit();
          }
        } catch (apiError) {
          console.error('Error fetching complete profiles from Neynar:', apiError);
          // Continue with the basic profiles we have as fallback
        }
      }
      
      // Sort by display name or username for consistent order
      const result = Array.from(followersMap.values()).sort((a, b) => 
        (a.display_name || a.username).localeCompare(b.display_name || b.username)
      );
      followerProfilesCache.set(targetFid, { data: result, timestamp: Date.now() });
      return result;
    } catch (error) {
      console.error('Error getting follower profiles:', error);
      return [];
    }
  });
}
