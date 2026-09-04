import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  increment,
  onSnapshot,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import type { FarcasterUser, SearchedUser } from '../../types/user';
import { db, firebaseLogger } from './config';
import { fetchWithRetry } from './helpers';
import { filterPopularFnameClones, pickExactFnameUser, rankByExactFname, normalizeSearchQuery } from '../../utils/farcasterFname';
import { PODPLAYR_ACCOUNT } from './follows';


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

// Declare searchTimeout at module level
let searchTimeout: NodeJS.Timeout | undefined;

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

  if (queryString.toLowerCase().startsWith('fid:')) {
    const fidPart = queryString.substring(4).trim();
    const fids = fidPart.split(',').map(f => parseInt(f.trim(), 10)).filter(f => !isNaN(f));
    if (fids.length === 0) return [];

    const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY;
    if (!neynarKey) throw new Error('Neynar API key not found');

    const fidsParam = fids.join(',');
    const response = await fetchWithRetry(
      `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fidsParam}`,
      {
        headers: {
          'accept': 'application/json',
          'api_key': neynarKey
        }
      }
    );

    const data = await response.json();
    return (data.users || []).map((user: any) => ({
      fid: user.fid,
      username: user.username,
      display_name: user.display_name || user.username || '',
      pfp_url: user.pfp_url || '',
      follower_count: user.follower_count || 0,
      following_count: user.following_count || 0,
      custody_address: user.custody_address || undefined,
      verified_addresses: user.verified_addresses,
      profile: {
        bio: typeof user.profile?.bio === 'string'
          ? user.profile.bio
          : user.profile?.bio?.text || '',
      },
    }));
  }

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
        const { getEnsProfile } = await import('../ens');
        const { createENSUser } = await import('../../types/ens');
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
        const { getEnsProfile } = await import('../ens');
        const { createENSUser } = await import('../../types/ens');
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

export const getPopularSearchedUsers = async (limitCount = 12): Promise<SearchedUser[]> => {
  try {
    const searchRef = collection(db, 'searchedusers');
    const popularQuery = query(
      searchRef,
      orderBy('searchCount', 'desc'),
      limit(Math.max(limitCount * 3, 30))
    );
    const snapshot = await getDocs(popularQuery);
    return filterPopularFnameClones(
      snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data() as Record<string, any>;
          return {
            fid: data.fid as number,
            username: data.username as string,
            display_name: (data.display_name as string) || (data.username as string),
            pfp_url: data.pfp_url as string,
            follower_count: (data.follower_count as number) || 0,
            following_count: (data.following_count as number) || 0,
            searchCount: (data.searchCount as number) || 0,
            isENS: Boolean(data.isENS),
          } as SearchedUser;
        })
        .filter((user) => Boolean(user.fid) && Boolean(user.username))
    ).slice(0, limitCount);
  } catch (error) {
    firebaseLogger.warn('Error getting popular searched users:', error);
    return [];
  }
};
