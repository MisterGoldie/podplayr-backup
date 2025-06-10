import { 
  collection, 
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
  writeBatch,
  DocumentSnapshot,
  QueryDocumentSnapshot,
  DocumentData
} from 'firebase/firestore';
import type { FarcasterUser, FollowedUser } from '../../types/user';
import { db, firebaseLogger, PODPLAYR_FID, PODPLAYR_USERNAME, PODPLAYR_DISPLAY_NAME, PODPLAYR_PFP_URL } from './config';

// Follow a Farcaster user
export const followUser = async (currentUserFid: number, userToFollow: FarcasterUser): Promise<void> => {
  try {
    if (!currentUserFid || !userToFollow || !userToFollow.fid) {
      firebaseLogger.error('Invalid parameters for followUser');
      return;
    }
    
    // Don't allow following yourself
    if (currentUserFid === userToFollow.fid) {
      firebaseLogger.warn('User attempted to follow themselves');
      return;
    }
    
    const batch = writeBatch(db);
    
    // Add to current user's following collection
    const followingRef = doc(db, 'users', currentUserFid.toString(), 'following', userToFollow.fid.toString());
    
    batch.set(followingRef, {
      fid: userToFollow.fid,
      username: userToFollow.username || '',
      display_name: userToFollow.display_name || '',
      pfp_url: userToFollow.pfp_url || '',
      timestamp: serverTimestamp()
    });
    
    // Add to target user's followers collection
    const followerRef = doc(db, 'users', userToFollow.fid.toString(), 'followers', currentUserFid.toString());
    
    // Get current user info
    const currentUserRef = doc(db, 'users', currentUserFid.toString());
    const currentUserDoc = await getDoc(currentUserRef);
    
    if (currentUserDoc.exists()) {
      const currentUserData = currentUserDoc.data();
      
      batch.set(followerRef, {
        fid: currentUserFid,
        username: currentUserData.username || '',
        display_name: currentUserData.display_name || '',
        pfp_url: currentUserData.pfp_url || '',
        timestamp: serverTimestamp()
      });
    } else {
      // If we don't have the user data, just store the FID
      batch.set(followerRef, {
        fid: currentUserFid,
        timestamp: serverTimestamp()
      });
    }
    
    // Update follower counts
    const targetUserRef = doc(db, 'users', userToFollow.fid.toString());
    batch.update(targetUserRef, {
      follower_count: increment(1)
    });
    
    batch.update(currentUserRef, {
      following_count: increment(1)
    });
    
    await batch.commit();
    
    firebaseLogger.info(`User ${currentUserFid} followed user ${userToFollow.fid}`);
  } catch (error) {
    firebaseLogger.error('Error following user:', error);
    throw error;
  }
};

// Update PODPLAYR follower count based on total users in the system
export const updatePodplayrFollowerCount = async (): Promise<number> => {
  try {
    // Get all users
    const usersRef = collection(db, 'users');
    const usersSnapshot = await getDocs(usersRef);
    
    // Count users excluding PODPlayr itself
    let followerCount = 0;
    const userDocs: QueryDocumentSnapshot<DocumentData>[] = [];
    
    usersSnapshot.forEach(doc => {
      const userData = doc.data();
      if (userData.fid !== PODPLAYR_FID) {
        followerCount++;
        userDocs.push(doc);
      }
    });
  
    // Update PODLAYR follower count
    const podplayrRef = doc(db, 'users', PODPLAYR_FID.toString());
    await updateDoc(podplayrRef, {
      follower_count: followerCount
    });
    
    // Update followers subcollection
    await updatePodplayrFollowersSubcollection(userDocs);
    
    firebaseLogger.info(`Updated PODPlayr follower count to ${followerCount}`);
    return followerCount;
  } catch (error) {
    firebaseLogger.error('Error updating PODPlayr follower count:', error);
    return 0;
  }
};

// Update the followers subcollection for PODPLAYR
export const updatePodplayrFollowersSubcollection = async (userDocs: QueryDocumentSnapshot<DocumentData>[]): Promise<void> => {
  try {
    const batchSize = 500; // Firestore batch limit
    let currentBatch = writeBatch(db);
    let operationCount = 0;
    
    for (const userDoc of userDocs) {
      const userData = userDoc.data();
      const userFid = userData.fid;
      
      if (userFid !== PODPLAYR_FID) {
        const followerRef = doc(db, 'users', PODPLAYR_FID.toString(), 'followers', userFid.toString());
        
        currentBatch.set(followerRef, {
          fid: userFid,
          username: userData.username || '',
          display_name: userData.display_name || '',
          pfp_url: userData.pfp_url || '',
          timestamp: serverTimestamp()
        });
        
        operationCount++;
        
        // If we've reached the batch limit, commit and start a new batch
        if (operationCount >= batchSize) {
          await currentBatch.commit();
          currentBatch = writeBatch(db);
          operationCount = 0;
        }
      }
    }
    
    // Commit any remaining operations
    if (operationCount > 0) {
      await currentBatch.commit();
    }
    
    firebaseLogger.info(`Updated PODPlayr followers subcollection with ${userDocs.length} users`);
  } catch (error) {
    firebaseLogger.error('Error updating PODPlayr followers subcollection:', error);
    throw error;
  }
};

// Ensure user follows the PODPlayr account
export const ensurePodplayrFollow = async (userFid: number): Promise<void> => {
  try {
    if (!userFid || userFid === PODPLAYR_FID) {
      return; // Skip if invalid FID or if it's PODPlayr itself
    }
    
    // Check if the user already follows PODPlayr
    const followingRef = doc(db, 'users', userFid.toString(), 'following', PODPLAYR_FID.toString());
    const followingDoc = await getDoc(followingRef);
    
    if (followingDoc.exists()) {
      // Already following, no action needed
      return;
    }
    
    const batch = writeBatch(db);
    
    // Add PODPlayr to user's following collection
    batch.set(followingRef, {
      fid: PODPLAYR_FID,
      username: PODPLAYR_USERNAME,
      display_name: PODPLAYR_DISPLAY_NAME,
      pfp_url: PODPLAYR_PFP_URL,
      timestamp: serverTimestamp()
    });
    
    // Add user to PODPlayr's followers collection
    const followerRef = doc(db, 'users', PODPLAYR_FID.toString(), 'followers', userFid.toString());
    
    // Get user info
    const userRef = doc(db, 'users', userFid.toString());
    const userDoc = await getDoc(userRef);
    
    if (userDoc.exists()) {
      const userData = userDoc.data();
      
      batch.set(followerRef, {
        fid: userFid,
        username: userData.username || '',
        display_name: userData.display_name || '',
        pfp_url: userData.pfp_url || '',
        timestamp: serverTimestamp()
      });
      
      // Update following count for user
      batch.update(userRef, {
        following_count: increment(1)
      });
    } else {
      // If we don't have the user data, just store the FID
      batch.set(followerRef, {
        fid: userFid,
        timestamp: serverTimestamp()
      });
    }
    
    // Update follower count for PODPlayr
    const podplayrRef = doc(db, 'users', PODPLAYR_FID.toString());
    batch.update(podplayrRef, {
      follower_count: increment(1)
    });
    
    await batch.commit();
    
    firebaseLogger.info(`User ${userFid} now follows PODPlayr`);
  } catch (error) {
    firebaseLogger.error('Error ensuring PODPlayr follow:', error);
    // Don't throw here, as this is a background operation
  }
};

// Unfollow a Farcaster user
export const unfollowUser = async (currentUserFid: number, userToUnfollow: FarcasterUser): Promise<void> => {
  try {
    if (!currentUserFid || !userToUnfollow || !userToUnfollow.fid) {
      firebaseLogger.error('Invalid parameters for unfollowUser');
      return;
    }
    
    const batch = writeBatch(db);
    
    // Remove from current user's following collection
    const followingRef = doc(db, 'users', currentUserFid.toString(), 'following', userToUnfollow.fid.toString());
    batch.delete(followingRef);
    
    // Remove from target user's followers collection
    const followerRef = doc(db, 'users', userToUnfollow.fid.toString(), 'followers', currentUserFid.toString());
    batch.delete(followerRef);
    
    // Update follower counts
    const targetUserRef = doc(db, 'users', userToUnfollow.fid.toString());
    const currentUserRef = doc(db, 'users', currentUserFid.toString());
    
    batch.update(targetUserRef, {
      follower_count: increment(-1)
    });
    
    batch.update(currentUserRef, {
      following_count: increment(-1)
    });
    
    await batch.commit();
    
    firebaseLogger.info(`User ${currentUserFid} unfollowed user ${userToUnfollow.fid}`);
  } catch (error) {
    firebaseLogger.error('Error unfollowing user:', error);
    throw error;
  }
};

// Check if a user is followed
export const isUserFollowed = async (currentUserFid: number, userFid: number): Promise<boolean> => {
  try {
    const followingRef = doc(db, 'users', currentUserFid.toString(), 'following', userFid.toString());
    const followingDoc = await getDoc(followingRef);
    
    return followingDoc.exists();
  } catch (error) {
    firebaseLogger.error('Error checking if user is followed:', error);
    return false;
  }
};

// Toggle follow status for a user
export const toggleFollowUser = async (currentUserFid: number, user: FarcasterUser): Promise<boolean> => {
  try {
    const isFollowed = await isUserFollowed(currentUserFid, user.fid);
    
    if (isFollowed) {
      await unfollowUser(currentUserFid, user);
      return false; // Now not following
    } else {
      await followUser(currentUserFid, user);
      return true; // Now following
    }
  } catch (error) {
    firebaseLogger.error('Error toggling follow status:', error);
    throw error;
  }
};

// Get all users that the current user is following
export const getFollowingUsers = async (currentUserFid: number): Promise<FollowedUser[]> => {
  try {
    const followingRef = collection(db, 'users', currentUserFid.toString(), 'following');
    const q = query(followingRef, orderBy('timestamp', 'desc'));
    
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      return [];
    }
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        fid: data.fid,
        username: data.username || '',
        display_name: data.display_name || '',
        pfp_url: data.pfp_url || '',
        timestamp: data.timestamp?.toDate() || new Date()
      };
    });
  } catch (error) {
    firebaseLogger.error('Error getting following users:', error);
    return [];
  }
};

// Get the count of users that the current user is following
export const getFollowingCount = async (userFid: number): Promise<number> => {
  try {
    const userRef = doc(db, 'users', userFid.toString());
    const userDoc = await getDoc(userRef);
    
    if (userDoc.exists()) {
      return userDoc.data().following_count || 0;
    }
    
    return 0;
  } catch (error) {
    firebaseLogger.error('Error getting following count:', error);
    return 0;
  }
};

// Get the count of users that follow the current user
export const getFollowersCount = async (userFid: number): Promise<number> => {
  try {
    const userRef = doc(db, 'users', userFid.toString());
    const userDoc = await getDoc(userRef);
    
    if (userDoc.exists()) {
      return userDoc.data().follower_count || 0;
    }
    
    return 0;
  } catch (error) {
    firebaseLogger.error('Error getting followers count:', error);
    return 0;
  }
};

// Get all users that follow the current user
export const getFollowers = async (userFid: number): Promise<FollowedUser[]> => {
  try {
    const followersRef = collection(db, 'users', userFid.toString(), 'followers');
    const q = query(followersRef, orderBy('timestamp', 'desc'));
    
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      return [];
    }
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        fid: data.fid,
        username: data.username || '',
        display_name: data.display_name || '',
        pfp_url: data.pfp_url || '',
        timestamp: data.timestamp?.toDate() || new Date()
      };
    });
  } catch (error) {
    firebaseLogger.error('Error getting followers:', error);
    return [];
  }
};

// Subscribe to following users for real-time updates
export const subscribeToFollowingUsers = (currentUserFid: number, callback: (users: FollowedUser[]) => void) => {
  try {
    const followingRef = collection(db, 'users', currentUserFid.toString(), 'following');
    const q = query(followingRef, orderBy('timestamp', 'desc'));
    
    return onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        callback([]);
        return;
      }
      
      const users = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          fid: data.fid,
          username: data.username || '',
          display_name: data.display_name || '',
          pfp_url: data.pfp_url || '',
          timestamp: data.timestamp?.toDate() || new Date()
        };
      });
      
      callback(users);
    });
  } catch (error) {
    firebaseLogger.error('Error subscribing to following users:', error);
    callback([]);
    return () => {}; // Return empty unsubscribe function
  }
};

// Subscribe to followers for real-time updates
export const subscribeToFollowers = (userFid: number, callback: (users: FollowedUser[]) => void) => {
  try {
    const followersRef = collection(db, 'users', userFid.toString(), 'followers');
    const q = query(followersRef, orderBy('timestamp', 'desc'));
    
    return onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        callback([]);
        return;
      }
      
      const users = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          fid: data.fid,
          username: data.username || '',
          display_name: data.display_name || '',
          pfp_url: data.pfp_url || '',
          timestamp: data.timestamp?.toDate() || new Date()
        };
      });
      
      callback(users);
    });
  } catch (error) {
    firebaseLogger.error('Error subscribing to followers:', error);
    callback([]);
    return () => {}; // Return empty unsubscribe function
  }
};
