import { 
  collection,
  collectionGroup,
  query, 
  where, 
  orderBy, 
  limit, 
  startAfter,
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
  DocumentData,
  Unsubscribe,
  QuerySnapshot
} from 'firebase/firestore';
import type { NFT } from '../../types/user';
import { db, firebaseLogger } from './config';
import { v4 as uuidv4 } from 'uuid';
import { getMediaKey, getNftIdentityKey, normalizeNftContract, normalizeNftTokenId } from '../../utils/media';
import { uniqueLikedNfts } from '../../utils/likeDedupe';
import { applyConfirmedPlayback, hydrateNftPlayback, restoreStoredAnimationUrl, isPlayableMediaNFT } from '../../utils/isMediaNFT';
import { stampNftLikeTime, sortLikedNewestFirst, getNftLikedTime, snapshotCreateMillis, fetchLikeCreateTimes } from '../../utils/likeTime';
import { consolidateUserLikes, findExistingUserLikeIds, mergeLegacyLikeCounts } from '../consolidateUserLikes';
import { likesDebug } from '../../utils/likesDebug';



// Clean up old likes and migrate to new mediaKey-based format
export const cleanupLikes = async (fid: number) => {
  try {
    // Check if user exists
    if (!fid) {
      firebaseLogger.error('Invalid FID provided to cleanupLikes');
      return { success: false, error: 'Invalid FID' };
    }
    
    // Get the user document first
    const userRef = doc(db, 'users', fid.toString());
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      firebaseLogger.warn(`User ${fid} does not exist, skipping cleanup`);
      return { success: true, message: 'User does not exist' };
    }
    
    const userData = userDoc.data();
    let migratedCount = 0;
    
    // Create a batch for efficiency
    const batch = writeBatch(db);
    
    // STEP 1: Migrate from old liked_nfts array in user document (oldest format)
    if (userData.liked_nfts && Array.isArray(userData.liked_nfts) && userData.liked_nfts.length > 0) {
      firebaseLogger.info(`Found ${userData.liked_nfts.length} NFTs in old liked_nfts array for user ${fid}`);
      
      for (const nft of userData.liked_nfts) {
        // Only process valid NFTs
        if (nft && nft.contract && nft.tokenId) {
          try {
            // Generate mediaKey for content-based tracking
            const mediaKey = getMediaKey(nft);
            
            if (mediaKey) {
              // Reference to user's likes subcollection document using mediaKey
              const userLikeRef = doc(db, 'users', fid.toString(), 'likes', mediaKey);
              
              // Store essential NFT data with both timestamps
              const now = Date.now();
              batch.set(userLikeRef, {
                mediaKey,
                contract: nft.contract,
                tokenId: nft.tokenId,
                name: nft.name || 'Untitled',
                description: nft.description || '',
                image: nft.image || '',
                audioUrl: nft.audio || nft.metadata?.animation_url || '',
                metadata: nft.metadata || {},
                serverTimestamp: serverTimestamp(),
                timestamp: now,
                timestampISO: new Date(now).toISOString()
              });
              
              migratedCount++;
              firebaseLogger.info(`Migrating ${nft.name || 'Unknown NFT'} to mediaKey format: ${mediaKey}`);
            } else {
              firebaseLogger.warn(`Couldn't generate mediaKey for NFT: ${nft.contract}-${nft.tokenId}`);
            }
          } catch (error) {
            firebaseLogger.error(`Error processing NFT ${nft.contract}-${nft.tokenId}:`, error);
            // Continue with the next NFT
          }
        }
      }
      
      // Clear the old array
      batch.update(userRef, { liked_nfts: [] });
    }
    
    // STEP 2: Migrate from old user_likes collection to subcollection (newer format)
    try {
      const oldLikesRef = collection(db, 'user_likes');
      const oldLikesQuery = query(oldLikesRef, where(documentId(), '>=', `${fid}-`), where(documentId(), '<', `${fid+1}-`));
      const oldLikesSnapshot = await getDocs(oldLikesQuery);
      
      if (!oldLikesSnapshot.empty) {
        firebaseLogger.info(`Found ${oldLikesSnapshot.size} NFTs in old user_likes collection for user ${fid}`);
        
        for (const docSnapshot of oldLikesSnapshot.docs) {
          const data = docSnapshot.data();
          
          if (data.contract && data.tokenId) {
            // Construct minimal NFT object to get mediaKey
            const nft: NFT = {
              contract: data.contract,
              tokenId: data.tokenId,
              name: data.name || 'Untitled',
              description: data.description || '',
              image: data.image || '',
              audio: data.audioUrl || '',
              metadata: data.metadata || {}
            };
            
            const mediaKey = getMediaKey(nft);
            
            if (mediaKey) {
              // Add to user's likes subcollection
              const userLikeRef = doc(db, 'users', fid.toString(), 'likes', mediaKey);
              
              // Create numerical timestamp alongside serverTimestamp
              const now = Date.now();
              batch.set(userLikeRef, {
                mediaKey,
                ...data,
                serverTimestamp: serverTimestamp(),
                timestamp: data.timestamp || now,
                timestampISO: new Date(now).toISOString()
              });
              
              // Delete from old collection
              batch.delete(docSnapshot.ref);
              
              migratedCount++;
              firebaseLogger.info(`Migrating from old collection: ${data.name || 'Unknown NFT'} to mediaKey format: ${mediaKey}`);
            }
          }
        }
      }
    } catch (error) {
      firebaseLogger.error('Error migrating from old user_likes collection:', error);
    }
    
    // Commit all changes if we have any
    if (migratedCount > 0) {
      await batch.commit();
      firebaseLogger.info(`Successfully migrated ${migratedCount} NFTs to mediaKey-based format for user ${fid}`);
    } else {
      firebaseLogger.info(`No likes to migrate for user ${fid}`);
    }
    
    return { success: true, migratedCount };
  } catch (error) {
    firebaseLogger.error('Error in cleanupLikes:', error);
    return { success: false, error };
  }
};

// Subscribe to liked NFTs for a user with real-time updates using mediaKey approach
export const subscribeToLikedNFTs = (fid: number, callback: (nfts: NFT[]) => void): () => void => {
  // Allow negative FIDs for ENS users
  if (!fid || fid === 0) {
    firebaseLogger.error('Invalid fid provided to subscribeToLikedNFTs:', fid);
    callback([]);
    return () => {};
  }

  // Get real-time updates from user's likes subcollection
  const likesRef = collection(db, 'users', fid.toString(), 'likes');
  
  firebaseLogger.info(`Subscribing to liked NFTs for user ${fid}`);
  
  const unsubscribe = onSnapshot(likesRef, async (snapshot) => {
    try {
      // Provide immediate empty array if no data
      if (snapshot.empty) {
        callback([]);
        return;
      }
      
      // Transform documents to NFTs quickly
      const createTimes = await fetchLikeCreateTimes(fid.toString());
      const likedNFTs: NFT[] = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        const mediaKey = docSnap.id;
        const animationUrl = restoreStoredAnimationUrl(data);
        const nft = {
          mediaKey,
          contract: data.contract || data.nftContract,
          tokenId: data.tokenId,
          name: data.name || 'Untitled',
          description: data.description || '',
          image: data.image || data.imageUrl || '',
          audio: data.audioUrl || data.nft?.audio || '',
          videoUrl: data.videoUrl || undefined,
          isVideo: Boolean(data.isVideo),
          playbackMode: data.playbackMode || undefined,
          network: data.network,
          metadata: {
            ...(data.nft?.metadata || {}),
            ...(data.metadata || {}),
            animation_url: animationUrl || data.metadata?.animation_url,
            ...(data.mediaMime ? { mimeType: data.mediaMime } : {}),
          },
        } as NFT;
        if (animationUrl) {
          nft.metadata = { ...(nft.metadata || {}), animation_url: animationUrl };
        }
        hydrateNftPlayback(nft);
        stampNftLikeTime(nft, {
          ...data,
          createTime: snapshotCreateMillis(docSnap) || createTimes.get(docSnap.id) || 0,
        });
        return nft;
      });
      
      firebaseLogger.info(`Found ${likedNFTs.length} liked NFTs for user ${fid}`);
      const playable = uniqueLikedNfts(sortLikedNewestFirst(likedNFTs.filter(isPlayableMediaNFT)));
      callback(playable);
      applyConfirmedPlayback(playable, (nfts) => callback(uniqueLikedNfts(sortLikedNewestFirst(nfts))));
      void consolidateUserLikes(db, fid.toString(), snapshot.docs);
    } catch (error) {
      firebaseLogger.error('Error in liked NFTs subscription:', error);
      callback([]);
    }
  }, (error) => {
    firebaseLogger.error('Error in liked NFTs subscription:', error);
    callback([]);
  });
  
  return unsubscribe;
};

// Helper function to get liked NFTs from old global collection
// This is only used for migration/backward compatibility
const getGlobalLikedNFTs = async (fid: number): Promise<NFT[]> => {
  try {
    if (!fid || fid <= 0) {
      firebaseLogger.error('Invalid fid provided to getGlobalLikedNFTs:', fid);
      return [];
    }
    
    const globalLikesRef = collection(db, 'user_likes');
    const globalQ = query(globalLikesRef, where(documentId(), '>=', `${fid}-`), where(documentId(), '<', `${fid+1}-`));
    const snapshot = await getDocs(globalQ);
    
    if (snapshot.empty) {
      return [];
    }
    
    // Transform the documents into NFT objects and calculate mediaKey
    const likedNFTs: NFT[] = [];
    
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.contract && data.tokenId) {
        // Create NFT object
        const nft: NFT = {
          contract: data.contract,
          tokenId: data.tokenId,
          name: data.name || 'Untitled',
          description: data.description || '',
          image: data.image || '',
          audio: data.audioUrl || '',
          metadata: data.metadata || {}
        };
        
        // Calculate mediaKey if not present
        if (!data.mediaKey) {
          nft.mediaKey = getMediaKey(nft);
        } else {
          nft.mediaKey = data.mediaKey;
        }
        
        likedNFTs.push(nft);
      }
    }
    
    return likedNFTs;
  } catch (error) {
    firebaseLogger.error('Error getting global liked NFTs:', error);
    return [];
  }
};

const likesCleanupStarted = new Set<number>();

function scheduleLikesCleanup(fid: number) {
  if (likesCleanupStarted.has(fid)) return;
  likesCleanupStarted.add(fid);
  const later = typeof setTimeout === 'function' ? setTimeout : null;
  if (!later) {
    void cleanupLikes(fid).catch((err) =>
      firebaseLogger.error(`Background cleanup failed for user ${fid}:`, err)
    );
    return;
  }
  later(() => {
    cleanupLikes(fid).catch((err) =>
      firebaseLogger.error(`Background cleanup failed for user ${fid}:`, err)
    );
  }, 2500);
}

async function likedNftsFromLikeDocs(
  userId: string,
  likeDocs: QueryDocumentSnapshot<DocumentData>[]
): Promise<NFT[]> {
  const needsCreateTimes = likeDocs.some((docSnap) => {
    const data = docSnap.data();
    return !getNftLikedTime(data) && !snapshotCreateMillis(docSnap);
  });
  const createTimes = needsCreateTimes
    ? await fetchLikeCreateTimes(userId)
    : new Map<string, number>();

  const likedNFTs = likeDocs.map((docSnap) => {
    const data = docSnap.data();
    const animationUrl = restoreStoredAnimationUrl(data);
    const nft = {
      mediaKey: docSnap.id,
      contract: data.contract || data.nftContract,
      tokenId: data.tokenId,
      name: data.name || data.nft?.name || 'Untitled',
      description: data.description || data.nft?.description || '',
      image: data.image || data.imageUrl || data.nft?.image || '',
      audio: data.audioUrl || data.nft?.audio || '',
      videoUrl: data.videoUrl || undefined,
      isVideo: Boolean(data.isVideo),
      playbackMode: data.playbackMode || undefined,
      network: data.network,
      metadata: {
        ...(data.nft?.metadata || {}),
        ...(data.metadata || {}),
        animation_url: animationUrl || data.metadata?.animation_url,
        ...(data.mediaMime ? { mimeType: data.mediaMime } : {}),
      },
      collection: data.collection
        ? { name: typeof data.collection === 'string' ? data.collection : data.collection.name }
        : data.nft?.collection
          ? { name: data.nft.collection.name || 'Unknown Collection', image: data.nft.collection.image }
          : undefined,
    } as NFT;
    hydrateNftPlayback(nft);
    stampNftLikeTime(nft, {
      ...data,
      createTime: snapshotCreateMillis(docSnap) || createTimes.get(docSnap.id) || 0,
    });
    return nft;
  });

  return uniqueLikedNfts(sortLikedNewestFirst(likedNFTs.filter(isPlayableMediaNFT)));
}

// Get liked NFTs for a user using mediaKey-based approach
// Updated to support both wallet addresses (string) and FIDs (number)
export const getLikedNFTs = async (userIdOrWallet: number | string): Promise<NFT[]> => {
  try {
    // Validate the user ID - allow negative FIDs for ENS users
    if (typeof userIdOrWallet === 'number' && (!userIdOrWallet || userIdOrWallet === 0)) {
      firebaseLogger.error('Invalid FID provided to getLikedNFTs:', userIdOrWallet);
      return [];
    }
    
    if (typeof userIdOrWallet === 'string' && (!userIdOrWallet || !userIdOrWallet.startsWith('0x'))) {
      firebaseLogger.error('Invalid wallet address provided to getLikedNFTs:', userIdOrWallet);
      return [];
    }
    
    // Convert to string for Firestore path
    const userId = userIdOrWallet.toString();

    const likesRef = collection(db, 'users', userId, 'likes');
    
    firebaseLogger.info(`Getting liked NFTs for user ${userId} using mediaKey-based approach`);
    const snapshot = await getDocs(likesRef);

    if (typeof userIdOrWallet === 'number') {
      scheduleLikesCleanup(userIdOrWallet);
    }

    if (snapshot.empty) {
      firebaseLogger.info(`No liked NFTs found for user ${userId}`);
      if (typeof userIdOrWallet === 'number') {
        await cleanupLikes(userIdOrWallet);
        const afterCleanup = await getDocs(likesRef);
        if (afterCleanup.empty) return [];
        return likedNftsFromLikeDocs(userId, afterCleanup.docs);
      }
      return [];
    }

    const migrated = await consolidateUserLikes(db, userId, snapshot.docs);
    const likeDocs = migrated ? (await getDocs(likesRef)).docs : snapshot.docs;
    return likedNftsFromLikeDocs(userId, likeDocs);
  } catch (error) {
    firebaseLogger.error('Error getting liked NFTs:', error);
    return [];
  }
};

// Toggle NFT like status globally - SIMPLIFIED TO MATCH PLAY COUNTING SYSTEM
export const toggleLikeNFT = async (nft: NFT, fidOrWalletAddress: number | string, forceUnlike: boolean = false): Promise<boolean> => {
  firebaseLogger.info('Starting toggleLikeNFT with NFT:', nft.name, 'and user ID:', fidOrWalletAddress, 
    typeof fidOrWalletAddress === 'string' ? '(wallet address)' : '(fid)');
  
  // Validate the user identifier (either fid or wallet address)
  if (typeof fidOrWalletAddress === 'number' && (!fidOrWalletAddress || fidOrWalletAddress <= 0)) {
    firebaseLogger.error('Invalid fid provided to toggleLikeNFT:', fidOrWalletAddress);
    
    // Try to recover from localStorage as a fallback for Privy users
    try {
      const savedAddress = localStorage.getItem('podplyr_wallet_address');
      if (savedAddress && savedAddress.startsWith('0x')) {
        fidOrWalletAddress = savedAddress.toLowerCase();
        firebaseLogger.info('Recovered wallet address from localStorage as fallback:', fidOrWalletAddress);
      } else {
        return false; // No valid user ID available
      }
    } catch (storageError) {
      firebaseLogger.error('Failed to recover wallet address from localStorage:', storageError);
      return false;
    }
  } else if (typeof fidOrWalletAddress === 'string') {
    // For string identifiers, ensure it's a valid wallet address
    if (!fidOrWalletAddress || !fidOrWalletAddress.startsWith('0x')) {
      firebaseLogger.error('Invalid wallet address provided to toggleLikeNFT:', fidOrWalletAddress);
      return false;
    }
    // CRITICAL: Ensure wallet addresses are always lowercase for consistency
    fidOrWalletAddress = fidOrWalletAddress.toLowerCase();
    
    // Store the wallet address in localStorage for persistence across sessions
    try {
      localStorage.setItem('podplyr_wallet_address', fidOrWalletAddress);
      firebaseLogger.info('Saved wallet address to localStorage for persistence');
    } catch (storageError) {
      firebaseLogger.error('Failed to save wallet address to localStorage:', storageError);
      // Continue with the operation even if localStorage fails
    }
  }
  
  if (!nft || !nft.contract || !nft.tokenId) {
    firebaseLogger.error('Invalid NFT data provided to toggleLikeNFT:', nft);
    return false;
  }
  
  // Define userId at the top level of the function for error handling access
  // CRITICAL: Ensure consistent user ID format for both Privy and Farcaster users
  let userId: string;
  
  // Handle wallet addresses (Privy users)
  if (typeof fidOrWalletAddress === 'string') {
    userId = fidOrWalletAddress.toLowerCase(); // Ensure wallet addresses are lowercase
  } 
  // Handle Farcaster IDs
  else {
    userId = fidOrWalletAddress.toString(); // Convert FID to string
  }
  
  // CRITICAL: Verify the userId is valid before proceeding
  if (!userId || (userId.startsWith('0x') && userId.length < 10)) {
    firebaseLogger.error('Invalid user ID after normalization:', userId);
    return false;
  }
  
  try {
    // Get mediaKey - critical for content-based likes
    const mediaKey = getMediaKey(nft);
    
    if (!mediaKey) {
      firebaseLogger.error('Invalid mediaKey for NFT:', nft);
      return false;
    }
    nft.mediaKey = mediaKey;
    await mergeLegacyLikeCounts(db, nft, mediaKey);
    const variantLikeIds = await findExistingUserLikeIds(db, userId, nft);
    
    // CRITICAL: This is the path where likes are stored in Firebase
    // Format: users/{userId}/likes/{mediaKey}
    // For Farcaster users, userId is the FID as a string
    // For Privy users, userId is the wallet address (lowercase)
    const userLikeRef = doc(db, 'users', userId, 'likes', mediaKey);
    firebaseLogger.info('Using mediaKey for like operation:', mediaKey);
    
    // Check if user already liked this NFT
    const userLikeDoc = await getDoc(userLikeRef);
    const isLiked = userLikeDoc.exists() || variantLikeIds.length > 0;
    
    // CRITICAL: Save this mediaKey in localStorage to help recover liked state
    try {
      // Get existing liked mediaKeys from localStorage
      const existingLikedKeys = localStorage.getItem('podplyr_liked_mediakeys') || '';
      const likedKeysArray = existingLikedKeys ? existingLikedKeys.split(',') : [];
      
      // Update the localStorage depending on the like action
      if (!isLiked && !forceUnlike) {
        // Add this mediaKey if it's not already in the list
        if (!likedKeysArray.includes(mediaKey)) {
          likedKeysArray.push(mediaKey);
          localStorage.setItem('podplyr_liked_mediakeys', likedKeysArray.join(','));
          firebaseLogger.info('Added mediaKey to liked keys in localStorage:', mediaKey);
        }
      } else if (forceUnlike || isLiked) {
        // Remove this mediaKey from the list
        const updatedKeys = likedKeysArray.filter(key => key !== mediaKey);
        localStorage.setItem('podplyr_liked_mediakeys', updatedKeys.join(','));
        firebaseLogger.info('Removed mediaKey from liked keys in localStorage:', mediaKey);
      }
    } catch (storageError) {
      firebaseLogger.error('Failed to update liked mediaKeys in localStorage:', storageError);
      // Continue with the operation even if localStorage fails
    }
    
    // If forceUnlike is true, we always want to unlike, regardless of current state
    // This ensures Library view unlike operations always work correctly
    const shouldUnlike = forceUnlike || isLiked;
    
    // Create a batch for all operations
    const batch = writeBatch(db);
    
    // CRITICAL: Update all DOM elements with this mediaKey before Firebase operations
    // This ensures immediate UI feedback regardless of Firebase operation timing
    try {
      const newLikeState = !isLiked;
      
      // Use a direct DOM update to ensure all instances are updated immediately
      const elementsToUpdate = document.querySelectorAll(`[data-media-key="${mediaKey}"]`);
      
      // Track which elements were updated for verification later
      const updatedElements: Element[] = [];
      
      // Force update ALL elements regardless of current state to ensure consistency
      elementsToUpdate.forEach(element => {
        // Update all elements to ensure consistent state
        element.setAttribute('data-liked', newLikeState ? 'true' : 'false');
        // Also update any isLiked data attribute if it exists
        if (element.hasAttribute('data-is-liked')) {
          element.setAttribute('data-is-liked', newLikeState ? 'true' : 'false');
        }
        updatedElements.push(element);
      });
      
      // Also force update any NFT cards that might be using this NFT
      // This is a backup mechanism to ensure UI consistency
      if (nft.contract && nft.tokenId) {
        const nftSelector = `[data-nft-id="${nft.contract}-${nft.tokenId}"]`;
        document.querySelectorAll(nftSelector).forEach(element => {
          element.setAttribute('data-liked', newLikeState ? 'true' : 'false');
        });
      }
      
    } catch (domError) {
      console.error('Error updating DOM elements:', domError);
      // Continue with Firebase operations even if DOM update fails
    }
    
    if (shouldUnlike) {
      // UNLIKE: Simple deletion from user's likes collection using mediaKey
      firebaseLogger.info(`Unliking NFT: ${nft.name} (mediaKey: ${mediaKey})`);
      batch.delete(userLikeRef);
      for (const variantId of variantLikeIds) {
        if (variantId !== mediaKey) {
          batch.delete(doc(db, 'users', userId, 'likes', variantId));
        }
      }
      
      // Also delete from global_likes if this is the only user who liked it
      const globalLikeRef = doc(db, 'global_likes', mediaKey);
      const globalLikeDoc = await getDoc(globalLikeRef);
      
      if (globalLikeDoc.exists()) {
        const globalData = globalLikeDoc.data();
        const currentCount = typeof globalData?.likeCount === 'number' ? globalData.likeCount : 0;
        likesDebug.log('unlike decrement global_likes, not deleting', {
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
    } else {
      // LIKE: Add to user's likes collection using mediaKey as document ID
      firebaseLogger.info(`Liking NFT: ${nft.name} (mediaKey: ${mediaKey})`);
      
      // Store essential NFT data
      const userLikeData = {
        mediaKey,
        contract: normalizeNftContract(nft.contract),
        tokenId: normalizeNftTokenId(nft.tokenId),
        name: nft.name || 'Untitled',
        description: nft.description || '',
        image: nft.image || '',
        audioUrl: nft.audio || '',
        animationUrl: nft.metadata?.animation_url || '',
        videoUrl: nft.videoUrl || '',
        isVideo: Boolean(nft.isVideo),
        playbackMode: nft.playbackMode || '',
        metadata: nft.metadata || {},
        timestamp: serverTimestamp(),
        network: nft.network,
        // CRITICAL: Add explicit isLiked flag to ensure consistent state
        isLiked: true,
        // CRITICAL: Add user identifier information to help with debugging
        userId: userId,
        isWalletAddress: userId.startsWith('0x'),
        isFid: !userId.startsWith('0x'),
        likedAt: new Date().toISOString()
      };
      
      batch.set(userLikeRef, userLikeData);
      for (const variantId of variantLikeIds) {
        if (variantId !== mediaKey) {
          batch.delete(doc(db, 'users', userId, 'likes', variantId));
        }
      }
      
      // We no longer need to track permanently removed NFTs
      // Simply adding to the likes collection is sufficient
      firebaseLogger.info(`Adding ${mediaKey} to likes collection`);
      
      // Update or create global like entry
      const globalLikeRef = doc(db, 'global_likes', mediaKey);
      const globalLikeDoc = await getDoc(globalLikeRef);
      
      if (globalLikeDoc.exists()) {
        batch.update(globalLikeRef, {
          likeCount: increment(1),
          lastLiked: serverTimestamp()
        });
      } else {
        batch.set(globalLikeRef, {
          likeCount: 1,
          contract: nft.contract,
          tokenId: nft.tokenId,
          name: nft.name || 'Untitled',
          metadata: nft.metadata || {},
          imageUrl: nft.image || '',
          audioUrl: nft.audio || '',
          firstLiked: serverTimestamp(),
          lastLiked: serverTimestamp(),
          mediaKey
        });
      }
    }
    
    // Commit all changes
    await batch.commit();
    
    // Double-check the like status after the operation AND verify synchronization
    const verifyUserDoc = await getDoc(userLikeRef);
    const verifyGlobalDoc = await getDoc(doc(db, 'global_likes', mediaKey));
    const finalLikeStatus = verifyUserDoc.exists();
    
    // Check if the user document and global document are in sync
    const globalExists = verifyGlobalDoc.exists();
    const globalLikeCount = globalExists ? verifyGlobalDoc.data()?.likeCount || 0 : 0;
    
    // Log synchronization status
    
    // AUTO-RECOVERY: If collections are out of sync, fix it with another batch
    if (finalLikeStatus && (!globalExists || globalLikeCount <= 0)) {
      const restored = await mergeLegacyLikeCounts(db, nft, mediaKey);
      likesDebug.log('like with empty global_likes — restored from user likes', {
        mediaKey,
        restored,
      });
      if (restored <= 0) {
        const recoveryBatch = writeBatch(db);
        const globalLikeRef = doc(db, 'global_likes', mediaKey);
        recoveryBatch.set(globalLikeRef, {
          likeCount: 1,
          contract: nft.contract,
          tokenId: nft.tokenId,
          name: nft.name || 'Untitled',
          metadata: nft.metadata || {},
          imageUrl: nft.image || '',
          audioUrl: nft.audio || '',
          firstLiked: serverTimestamp(),
          lastLiked: serverTimestamp(),
          mediaKey,
          syncFixed: true,
          syncFixedAt: serverTimestamp()
        });
        await recoveryBatch.commit();
      }
    } else if (!finalLikeStatus && globalExists && globalLikeCount > 0) {
      likesDebug.log('unlike left global_likes in place (old-key likes may still exist)', {
        mediaKey,
        globalLikeCount,
      });
    }
    
    // Final verification after potential fixes
    const finalVerifyUserDoc = await getDoc(userLikeRef);
    const finalVerifyGlobalDoc = await getDoc(doc(db, 'global_likes', mediaKey));
    const finalFinalLikeStatus = finalVerifyUserDoc.exists();
    const finalGlobalExists = finalVerifyGlobalDoc.exists();
    
    
    // CRITICAL: Update all DOM elements again after Firebase operation completes
    // This ensures UI state is consistent with Firebase state
    try {
      // Force update ALL elements with this mediaKey
      const elementsToUpdate = document.querySelectorAll(`[data-media-key="${mediaKey}"]`);
      
      elementsToUpdate.forEach(element => {
        // Update the data-liked attribute
        element.setAttribute('data-liked', finalLikeStatus ? 'true' : 'false');
        // Also update any isLiked data attribute if it exists
        if (element.hasAttribute('data-is-liked')) {
          element.setAttribute('data-is-liked', finalLikeStatus ? 'true' : 'false');
        }
      });
      
      // Also update any elements that might be identified by contract-tokenId
      if (nft.contract && nft.tokenId) {
        const nftSelector = `[data-nft-id="${nft.contract}-${nft.tokenId}"]`;
        document.querySelectorAll(nftSelector).forEach(element => {
          element.setAttribute('data-liked', finalLikeStatus ? 'true' : 'false');
        });
      }
    } catch (domError) {
      console.error('Error in final DOM update:', domError);
      // Continue even if DOM update fails
    }
    
    // Return the new like state
    return finalLikeStatus;
  } catch (error) {
    firebaseLogger.error('Error in toggleLikeNFT:', error);
    
    // CRITICAL: On error, revert any DOM changes to maintain consistency
    try {
      const mediaKey = getMediaKey(nft);
      if (mediaKey) {
        // Check current state in Firebase to revert correctly
        // Even in error handling, use the proper user identifier
        const errorUserRef = doc(db, 'users', userId, 'likes', mediaKey);
        const errorUserDoc = await getDoc(errorUserRef);
        const currentLikeState = errorUserDoc.exists();
        
        const elementsToRevert = document.querySelectorAll(`[data-media-key="${mediaKey}"]`);
        
        elementsToRevert.forEach(element => {
          element.setAttribute('data-liked', currentLikeState ? 'true' : 'false');
        });
      }
    } catch (revertError) {
      console.error('Error reverting DOM changes:', revertError);
    }
    
    return false;
  }
};

// Add NFT to user's liked collection using mediaKey (content-first approach)
export const addLikedNFT = async (fid: number, nft: NFT): Promise<void> => {
  try {
    // Validate inputs
    if (!fid || fid <= 0) {
      firebaseLogger.error('Invalid fid provided to addLikedNFT:', fid);
      throw new Error('Invalid user ID');
    }
    
    if (!nft || !nft.contract || !nft.tokenId) {
      firebaseLogger.error('Invalid NFT data provided to addLikedNFT:', nft);
      throw new Error('Invalid NFT data');
    }
    
    // Get mediaKey - critical for content-based likes
    const mediaKey = getMediaKey(nft);
    
    if (!mediaKey) {
      firebaseLogger.error('Could not generate mediaKey for NFT:', nft);
      throw new Error('Could not generate mediaKey');
    }
    
    // Reference to user's likes subcollection document using mediaKey
    const userLikeRef = doc(db, 'users', fid.toString(), 'likes', mediaKey);
    
    // Store essential NFT data
    const userLikeData = {
      mediaKey,
      contract: nft.contract,
      tokenId: nft.tokenId,
      name: nft.name || 'Untitled',
      description: nft.description || (typeof nft.metadata?.description === 'string' ? nft.metadata.description : '') || '',
      image: nft.image || (typeof nft.metadata?.image === 'string' ? nft.metadata.image : '') || '',
      audioUrl: nft.audio || (typeof nft.metadata?.animation_url === 'string' ? nft.metadata.animation_url : '') || '',
      animationUrl: typeof nft.metadata?.animation_url === 'string' ? nft.metadata.animation_url : '',
      videoUrl: nft.videoUrl || '',
      isVideo: Boolean(nft.isVideo),
      playbackMode: nft.playbackMode || '',
      metadata: nft.metadata || {},
      timestamp: serverTimestamp(),
      network: nft.network,
    };
    
    // Create a batch for all operations
    const batch = writeBatch(db);
    
    // Add to user's likes subcollection
    batch.set(userLikeRef, userLikeData);
    
    // Also update or create global like entry
    const globalLikeRef = doc(db, 'global_likes', mediaKey);
    const globalLikeDoc = await getDoc(globalLikeRef);
    
    if (globalLikeDoc.exists()) {
      batch.update(globalLikeRef, {
        likeCount: increment(1),
        lastLiked: serverTimestamp()
      });
    } else {
      batch.set(globalLikeRef, {
        likeCount: 1,
        contract: nft.contract,
        tokenId: nft.tokenId,
        name: nft.name || 'Untitled',
        metadata: nft.metadata || {},
        imageUrl: nft.image || '',
        audioUrl: nft.audio || '',
        firstLiked: serverTimestamp(),
        lastLiked: serverTimestamp(),
        mediaKey
      });
    }
    
    // Commit all changes
    await batch.commit();
    
    firebaseLogger.info(`Added NFT to likes: ${nft.name} (mediaKey: ${mediaKey})`);
  } catch (error) {
    firebaseLogger.error('Error adding liked NFT:', error);
    throw error;
  }
};

// Remove NFT from user's liked collection using mediaKey (content-first approach)
export const removeLikedNFT = async (fid: number, nft: NFT): Promise<void> => {
  try {
    // Validate inputs
    if (!fid || fid <= 0) {
      firebaseLogger.error('Invalid fid provided to removeLikedNFT:', fid);
      throw new Error('Invalid user ID');
    }
    
    if (!nft || !nft.contract || !nft.tokenId) {
      firebaseLogger.error('Invalid NFT data provided to removeLikedNFT:', nft);
      throw new Error('Invalid NFT data');
    }
    
    // Get mediaKey - critical for content-based likes
    const mediaKey = getMediaKey(nft);
    
    if (!mediaKey) {
      firebaseLogger.error('Could not generate mediaKey for NFT:', nft);
      throw new Error('Could not generate mediaKey');
    }
    
    // Reference to user's likes subcollection document using mediaKey
    const userLikeRef = doc(db, 'users', fid.toString(), 'likes', mediaKey);
    
    // Create a batch for all operations
    const batch = writeBatch(db);
    
    // Remove from user's likes collection
    batch.delete(userLikeRef);
    
    // Also update global like entry
    const globalLikeRef = doc(db, 'global_likes', mediaKey);
    const globalLikeDoc = await getDoc(globalLikeRef);
    
    if (globalLikeDoc.exists()) {
      const globalData = globalLikeDoc.data();
      const currentCount = globalData?.likeCount || 1;
      
      if (currentCount <= 1) {
        batch.delete(globalLikeRef);
      } else {
        batch.update(globalLikeRef, {
          likeCount: currentCount - 1,
          lastUnliked: serverTimestamp()
        });
      }
    }
    
    await batch.commit();
    
    firebaseLogger.info(`Removed NFT from likes: ${nft.name} (mediaKey: ${mediaKey})`);
  } catch (error) {
    firebaseLogger.error('Error removing liked NFT:', error);
    throw error;
  }
};

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
