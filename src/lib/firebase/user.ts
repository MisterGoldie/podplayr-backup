import { 
  collection, 
  addDoc, 
  query as firestoreQuery, 
  where, 
  orderBy, 
  limit, 
  getDocs,
  doc,
  increment,
  onSnapshot,
  setDoc,
  getDoc,
  serverTimestamp
} from 'firebase/firestore';
import type { FarcasterUser, SearchedUser } from '../../types/user';
import { db, firebaseLogger } from './config';
import { fetchWithRetry } from './utils';

// Helper function to ensure string type for Firestore queries
function ensureString(value: any): string {
  return typeof value === 'string' ? value : String(value);
}

// Define a type that allows string operations
type StringLike = string | String;

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

// Track user search and return Farcaster user data
export const trackUserSearch = async (username: string, fid: number): Promise<FarcasterUser> => {
  try {
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
    const searchedUser = searchData.result?.users[0];
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
    const searchedUserData = {
      fid: user.fid,
      username: user.username,
      display_name: user.display_name,
      pfp_url: user.pfp_url,
      custody_address: finalAddresses[0] || null,
      verifiedAddresses: finalAddresses,
      follower_count: user.follower_count,
      following_count: user.following_count,
      lastSearched: now,
      searchCount: increment(1)
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

    return {
      ...user,
      custody_address: finalAddresses[0] || null,
      verifiedAddresses: finalAddresses
    };
  } catch (error) {
    firebaseLogger.error('Error tracking user search:', error);
    throw error;
  }
};

// Subscribe to recent searches
export const subscribeToRecentSearches = (fid: number, callback: (searches: SearchedUser[]) => void) => {
  const searchesRef = collection(db, 'user_searches');
  // Use unified index pattern for recent searches
  const q = firestoreQuery(
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
          timestamp = new Date(data.timestamp as string).getTime();
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
        lastSearched: timestamp
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
      ? firestoreQuery(
          searchesRef,
          where('searching_fid', '==', fid),
          orderBy('timestamp', 'desc'),
          limit(20)
        )
      : firestoreQuery(
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
          lastSearched: timestamp
        });
      }
    });
    
    // Convert to array and sort by timestamp
    const searches = Array.from(uniqueSearches.values()).sort((a, b) => b.timestamp - a.timestamp);
    return searches.slice(0, 8);
  } catch (error) {
    firebaseLogger.error('Error getting recent searches:', error);
    return [];
  }
};

// Declare searchTimeout at module level
let searchTimeout: NodeJS.Timeout | undefined;

// Search for Farcaster users
export const searchUsers = async (query: string): Promise<FarcasterUser[]> => {
  try {
    if (!query || query.trim() === '') {
      return [];
    }
    
    // Clear any pending search timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    
    // Normalize search query
    const normalizedQuery: string = query.toString().trim().toLowerCase();
    // Create string suffix for range queries
    const queryEnd = `${normalizedQuery}\uf8ff`;
    
    // Check if query has special format indicating exact FIDs
    if (normalizedQuery.startsWith('fid:')) {
      const fidPart = normalizedQuery.toString().substring(4).trim();
      const fids = fidPart.split(',').map(f => parseInt(f.trim())).filter(f => !isNaN(f));
      
      if (fids.length > 0) {
        const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY;
        if (!neynarKey) throw new Error('Neynar API key not found');
        
        // Fetch users by their FIDs
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
        return data.users || [];
      }
      
      return [];
    }
    
    // Regular user search by username
    // First try to get users from cache if it's a simple query
    if (normalizedQuery.length >= 1) {
      try {
        const searchRef = collection(db, 'searchedusers');
        const usernameQuery = firestoreQuery(
          searchRef,
          where('username', '>=', normalizedQuery),
          where('username', '<=', queryEnd),
          orderBy('username'),
          limit(10)
        );
        
        const displayNameQuery = firestoreQuery(
          searchRef,
          where('display_name', '>=', normalizedQuery),
          where('display_name', '<=', queryEnd),
          orderBy('display_name'),
          limit(10)
        );
        
        // Run both queries in parallel
        const [usernameSnapshot, displayNameSnapshot] = await Promise.all([
          getDocs(usernameQuery),
          getDocs(displayNameQuery)
        ]);
        
        // Combine results without duplicates
        const userMap = new Map<number, FarcasterUser>();
        
        [...usernameSnapshot.docs, ...displayNameSnapshot.docs].forEach(doc => {
          // Use a more explicit type assertion to fix TypeScript errors
          const docData = doc.data() as Record<string, any>;
          const data = {
            fid: docData.fid as number,
            username: docData.username as string,
            display_name: docData.display_name as string,
            pfp_url: docData.pfp_url as string,
            follower_count: docData.follower_count as number,
            following_count: docData.following_count as number,
            custody_address: docData.custody_address as string,
            verifiedAddresses: (docData.verifiedAddresses as string[]) || []
          };
          const fid = data.fid;
          
          if (fid && !userMap.has(fid)) {
            userMap.set(fid, {
              fid: data.fid,
              username: data.username,
              display_name: data.display_name,
              pfp_url: data.pfp_url,
              follower_count: data.follower_count,
              following_count: data.following_count,
              custody_address: data.custody_address,
              verifiedAddresses: data.verifiedAddresses
            });
          }
        });
        
        const localUsers = Array.from(userMap.values());
        
        // If we have enough local results, return them immediately
        if (localUsers.length >= 5) {
          return localUsers.slice(0, 10);
        }
      } catch (error) {
        firebaseLogger.warn('Error searching local users:', error);
        // Continue to API search
      }
    }
    
    // Otherwise, fetch from API
    const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY;
    if (!neynarKey) throw new Error('Neynar API key not found');
    
    const response = await fetchWithRetry(
      `https://api.neynar.com/v2/farcaster/user/search?q=${encodeURIComponent(normalizedQuery)}&limit=10`,
      {
        headers: {
          'accept': 'application/json',
          'api_key': neynarKey
        }
      }
    );
    
    const data = await response.json();
    const users = data.result?.users || [];
    
    // Convert to consistent format
    return users.map((user: any) => ({
      fid: user.fid,
      username: user.username,
      display_name: user.display_name || '',
      pfp_url: user.pfp_url || '',
      follower_count: user.follower_count || 0,
      following_count: user.following_count || 0,
      custody_address: user.custody_address || null,
      verifiedAddresses: []  // Will be populated if/when user is tracked
    }));
  } catch (error) {
    firebaseLogger.error('Error searching users:', error);
    return [];
  }
};
