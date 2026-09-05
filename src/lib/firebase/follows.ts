import {
  collection,
  query,
  limit,
  getDocs,
  doc,
  increment,
  onSnapshot,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
  writeBatch,
  QueryDocumentSnapshot,
  DocumentData,
  startAfter,
} from 'firebase/firestore';
import type { FarcasterUser, FollowedUser } from '../../types/user';
import { db, firebaseLogger } from './config';
import { deduplicateCall, fetchWithRetry } from './helpers';

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

export const getFollowCounts = async (
  userFid: number
): Promise<{ followers: number; following: number }> => {
  if (!userFid) return { followers: 0, following: 0 };
  return deduplicateCall(`followCounts-${userFid}`, async () => {
    try {
      const userDoc = await getDoc(doc(db, 'searchedusers', userFid.toString()));
      const data = userDoc.exists() ? userDoc.data() : {};
      const followers =
        typeof data.followerCount === 'number'
          ? data.followerCount
          : await recomputeFollowerCount(userFid);
      const following =
        typeof data.followingCount === 'number'
          ? data.followingCount
          : await recomputeFollowingCount(userFid);
      return { followers, following };
    } catch (error) {
      console.error('Error getting follow counts:', error);
      return { followers: 0, following: 0 };
    }
  });
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

