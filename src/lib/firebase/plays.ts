import { 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDocs,
  updateDoc,
  doc,
  increment,
  onSnapshot,
  setDoc,
  getDoc,
  addDoc,
  serverTimestamp,
  documentId,
  writeBatch,
  Timestamp
} from 'firebase/firestore';
import type { NFT } from '../../types/user';
import { db, firebaseLogger } from './config';
import { v4 as uuidv4 } from 'uuid';

// Generate a unique, random media key for each NFT
const getMediaKey = (nft: NFT): string => {
  return uuidv4();
};

// Track NFT play and update play count globally
export const trackNFTPlay = async (nft: NFT, fid: number) => {
  firebaseLogger.info(`TRACKING PLAY FOR NFT BY FARCASTER USER ${fid} - USING ORIGINAL METHOD`);
  try {
    if (!nft || !fid) {
      firebaseLogger.error('Invalid NFT or FID');
      return { success: false, error: 'Invalid NFT or FID' };
    }

    const mediaKey = getMediaKey(nft);
    if (!mediaKey) {
      firebaseLogger.error('Failed to get mediaKey');
      return { success: false, error: 'Failed to get mediaKey' };
    }
    
    firebaseLogger.info(`Generated mediaKey: ${mediaKey}`);

    // STEP 1: Update global play count (this part always works)
    // Create timestamps for consistency across collections
    const now = Date.now(); // Current time in milliseconds
    const nowISO = new Date(now).toISOString();
    
    const globalPlayRef = doc(db, 'global_plays', mediaKey);
    const globalPlayDoc = await getDoc(globalPlayRef);
    
    if (globalPlayDoc.exists()) {
      await updateDoc(globalPlayRef, {
        playCount: increment(1),
        lastPlayed: serverTimestamp(),
        lastPlayedTimestamp: now,
        lastPlayedISO: nowISO
      });
      firebaseLogger.info(`Updated existing global play record`);
    } else {
      await setDoc(globalPlayRef, {
        playCount: 1,
        firstPlayed: serverTimestamp(),
        firstPlayedTimestamp: now,
        firstPlayedISO: nowISO,
        lastPlayed: serverTimestamp(),
        lastPlayedTimestamp: now,
        lastPlayedISO: nowISO,
        nftContract: nft.contract,
        tokenId: nft.tokenId,
        name: nft.name || 'Untitled',
        audioUrl: nft.audio || nft.metadata?.animation_url || '',
        imageUrl: nft.image || nft.metadata?.image || '',
        description: nft.description || nft.metadata?.description || '',
        mediaKey
      });
      firebaseLogger.info(`Created new global play record`);
      
      // Randomly sync top_played collection (10% chance)
      // This reduces database writes while still keeping top_played relatively fresh
      if (Math.random() < 0.1) {
        // Don't await this to avoid blocking the play tracking
        syncTopPlayedCollection().catch(err => {
          firebaseLogger.error('Failed to sync top_played collection during play:', err);
        });
      }
    }
    
    // STEP 2: Create user document if needed
    const userRef = doc(db, 'users', fid.toString());
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      // Create new user document with both root-level and structured fields
      await setDoc(userRef, {
        fid: fid,
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp(),
        hasPlayHistory: true,
        // These fields will be directly visible in the Firebase console
        lastPlayedTimestamp: now,
        lastPlayedISO: nowISO,
        totalPlays: 1,
        lastPlayedMediaKey: mediaKey,
        lastPlayedName: nft.name || 'Untitled',
        // Still keep the structured data for code that might expect it
        playHistorySummary: {
          lastPlayed: serverTimestamp(),
          totalPlays: 1,
          lastPlayedNft: {
            mediaKey,
            contract: nft.contract,
            tokenId: nft.tokenId,
            name: nft.name || 'Untitled'
          }
        }
      });
      firebaseLogger.info(`Created new user document for FID ${fid}`);
    } else {
      // Update existing user
      // Update the user document with play history summary at root level
      await updateDoc(userRef, {
        lastActive: serverTimestamp(),
        hasPlayHistory: true,
        // These fields will be directly visible in the Firebase console
        'lastPlayedTimestamp': now,
        'lastPlayedISO': nowISO,
        'totalPlays': increment(1),
        'lastPlayedMediaKey': mediaKey,
        'lastPlayedName': nft.name || 'Untitled',
        // Still keep the structured data for code that might expect it
        'playHistorySummary': {
          lastPlayed: serverTimestamp(),
          totalPlays: increment(1),
          lastPlayedNft: {
            mediaKey,
            contract: nft.contract,
            tokenId: nft.tokenId,
            name: nft.name || 'Untitled'
          }
        }
      });
      firebaseLogger.info(`Updated existing user document for FID ${fid}`);
    }
    
    // STEP 3: Create play history entry - THIS IS THE PART THAT WAS BROKEN
    // THE CRITICAL DIFFERENCE: Use collection() and addDoc() instead of doc() and setDoc()
    try {
      // Get a reference to the playHistory collection (NOT a specific document)
      const playHistoryRef = collection(db, 'users', fid.toString(), 'playHistory');
      
      firebaseLogger.info(`CREATING a new document in playHistory collection for user ${fid} with generated ID`);
      
      const playHistoryData = {
        playCount: 1,
        // Use both timestamps - one for server consistency, one for immediate display
        serverTimestamp: serverTimestamp(), // Will be resolved on server
        timestamp: now, // Actual numerical value for immediate display
        timestampISO: nowISO, // Human-readable format
        mediaKey: mediaKey,
        nftContract: nft.contract,
        tokenId: nft.tokenId,
        name: nft.name || 'Untitled',
        description: nft.description || nft.metadata?.description || '',
        audioUrl: nft.audio || nft.metadata?.animation_url || '',
        image: nft.image || nft.metadata?.image || '',
        collection: nft.collection?.name || 'Unknown Collection',
        network: nft.network || 'ethereum',
        fid: fid
      };
      
      // Add a NEW document with an auto-generated ID
      const newDoc = await addDoc(playHistoryRef, playHistoryData);
      
      // Log the exact path for debugging in the Firebase console
      const exactPath = `users/${fid}/playHistory/${newDoc.id}`;
      firebaseLogger.info(`SUCCESS! Created playHistory document with ID: ${newDoc.id}`);
      firebaseLogger.info(`EXACT PATH TO ACCESS IN FIREBASE CONSOLE: ${exactPath}`);
      
      // Also add a reference to this play in the main user document for easier access
      await updateDoc(userRef, {
        'recentPlayHistoryPath': exactPath,
        'recentPlayHistoryId': newDoc.id
      });
      
      // STEP 4: Update recent plays collection
      try {
        // Get a reference to the recentPlays collection
        const recentPlaysRef = collection(db, 'users', fid.toString(), 'recentPlays');
        
        firebaseLogger.info(`Creating recentPlays document for user ${fid}`);
        
        // Create recent plays data with the same timestamp approach
        const recentPlaysData = {
          timestamp: now,
          timestampISO: nowISO,
          serverTimestamp: serverTimestamp(),
          mediaKey: mediaKey,
          nftContract: nft.contract,
          tokenId: nft.tokenId,
          name: nft.name || 'Untitled',
          description: nft.description || nft.metadata?.description || '',
          audioUrl: nft.audio || nft.metadata?.animation_url || '',
          image: nft.image || nft.metadata?.image || '',
          collection: nft.collection?.name || 'Unknown Collection',
          network: nft.network || 'ethereum',
          fid: fid
        };
        
        // Add a NEW document with an auto-generated ID
        const recentDoc = await addDoc(recentPlaysRef, recentPlaysData);
        
        firebaseLogger.info(`SUCCESS! Created recentPlays document with ID: ${recentDoc.id}`);
      } catch (recentPlaysError) {
        firebaseLogger.error(`Error creating recentPlays document: ${recentPlaysError}`);
        // Continue since this isn't critical
      }
    } catch (playHistoryError) {
      firebaseLogger.error(`CRITICAL: Play history creation failed: ${playHistoryError}`);
    }
    
    return { success: true, mediaKey };
  } catch (error) {
    firebaseLogger.error(`CRITICAL ERROR: ${error}`);
    return { success: false, error };
  }
};

/**
 * Maintains the top_played collection to contain ONLY the top 3 most-played NFTs
 * This ensures we have a clean collection with just what we need for UI
 */
export const syncTopPlayedCollection = async (): Promise<{ success: boolean; error?: any }> => {
  firebaseLogger.info('Syncing top_played collection to contain only top 3 NFTs');
  
  try {
    // 1. Get the actual top 3 NFTs from global_plays collection
    const globalPlaysRef = collection(db, 'global_plays');
    const topNFTsQuery = query(
      globalPlaysRef,
      orderBy('playCount', 'desc'),
      limit(3) // Only get top 3
    );
    
    const topNFTsSnapshot = await getDocs(topNFTsQuery);
    firebaseLogger.info(`Found ${topNFTsSnapshot.size} NFTs to include in top_played`);
    
    // 2. Get current contents of top_played collection
    const topPlayedRef = collection(db, 'top_played');
    const currentTopPlayedSnapshot = await getDocs(topPlayedRef);
    firebaseLogger.info(`Current top_played collection has ${currentTopPlayedSnapshot.size} documents`);
    
    // 3. Use a batch for efficient updates
    const batch = writeBatch(db);
    
    // Track which NFTs to keep
    const keepMediaKeys = new Set<string>();
    
    // 4. Add or update the top 3 NFTs in top_played collection
    topNFTsSnapshot.docs.forEach((docSnapshot, index) => {
      const mediaKey = docSnapshot.id;
      keepMediaKeys.add(mediaKey);
      
      const data = docSnapshot.data();
      const now = Date.now();
      
      // Create a document reference correctly
      const topPlayedDocRef = doc(db, 'top_played', mediaKey);
      batch.set(topPlayedDocRef, {
        ...data,
        rank: index + 1,
        lastUpdated: serverTimestamp(),
        lastUpdatedTimestamp: now,
        lastUpdatedISO: new Date(now).toISOString()
      });
      
      firebaseLogger.info(`Adding/updating top played NFT: ${data.name || 'Untitled'} with rank ${index + 1}`);
    });
    
    // 5. Remove any documents in top_played that aren't in our top 3
    let removedCount = 0;
    currentTopPlayedSnapshot.docs.forEach(docSnapshot => {
      if (!keepMediaKeys.has(docSnapshot.id)) {
        batch.delete(docSnapshot.ref);
        removedCount++;
        firebaseLogger.info(`Removing NFT from top_played: ${docSnapshot.data().name || 'Untitled'}`);
      }
    });
    
    // 6. Commit all changes in one batch
    await batch.commit();
    
    firebaseLogger.info(`Successfully maintained top_played collection: kept ${keepMediaKeys.size} NFTs, removed ${removedCount} NFTs`);
    return { success: true };
  } catch (error) {
    firebaseLogger.error('Error updating top_played collection:', error);
    return { success: false, error };
  }
};

// Get top played NFTs from global plays collection
export const getTopPlayedNFTs = async (): Promise<{ nft: NFT; count: number }[]> => {
  try {
    // Get from top_played collection which is pre-ranked
    const topPlayedRef = collection(db, 'top_played');
    const topPlayedQuery = query(
      topPlayedRef,
      orderBy('playCount', 'desc'),
      limit(10)
    );
    
    const snapshot = await getDocs(topPlayedQuery);
    
    if (snapshot.empty) {
      firebaseLogger.info('No top played NFTs found');
      return [];
    }
    
    const topPlayed = snapshot.docs.map((doc, index) => {
      const data = doc.data();
      
      // Construct NFT object from the data
      const nft: NFT = {
        contract: data.nftContract,
        tokenId: data.tokenId,
        name: data.name || 'Untitled',
        description: data.description || '',
        image: data.imageUrl || '',
        audio: data.audioUrl || '',
        metadata: data.metadata || {},
        network: 'ethereum', // Default
        isVideo: data.metadata?.animation_url && !data.audioUrl
      };
      
      // If the metadata contains collection info, add it
      if (data.metadata?.collection?.name) {
        nft.collection = {
          name: data.metadata.collection.name,
          image: data.metadata.collection.image
        };
      }
      
      return {
        nft,
        count: data.playCount,
        rank: index + 1
      };
    });
    
    // Also update the rank in Firebase if needed
    for (let i = 0; i < snapshot.docs.length; i++) {
      const docRef = doc(db, 'top_played', snapshot.docs[i].id);
      const currentRank = snapshot.docs[i].data().rank;
      
      // Only update if rank changed
      if (currentRank !== i + 1) {
        updateDoc(docRef, {
          rank: i + 1
        }).catch(err => firebaseLogger.error(`Error updating rank for ${snapshot.docs[i].id}:`, err));
      }
    }
    
    return topPlayed;
  } catch (error) {
    firebaseLogger.error('Error getting top played NFTs:', error);
    return [];
  }
};

// Check if an NFT is currently in the top played section
export const hasBeenTopPlayed = async (nft: NFT | null): Promise<boolean> => {
  if (!nft || !nft.contract || !nft.tokenId) {
    return false;
  }
  
  try {
    const mediaKey = getMediaKey(nft);
    if (!mediaKey) {
      return false;
    }
    
    const topPlayedRef = doc(db, 'top_played', mediaKey);
    const topPlayedDoc = await getDoc(topPlayedRef);
    
    return topPlayedDoc.exists();
  } catch (error) {
    firebaseLogger.error('Error checking if NFT has been top played:', error);
    return false;
  }
};

// Subscribe to recent plays
export const subscribeToRecentPlays = (fid: number, callback: (nfts: NFT[]) => void) => {
  const recentPlaysRef = collection(db, 'users', fid.toString(), 'recent_plays');
  const q = query(
    recentPlaysRef,
    orderBy('timestamp', 'desc'),
    limit(10)
  );
  
  firebaseLogger.info('=== SUBSCRIBING TO RECENT PLAYS ===');
  firebaseLogger.info('FID:', fid);
  
  firebaseLogger.info('Setting up snapshot listener with query:', {
    fid,
    orderBy: 'timestamp',
    direction: 'desc',
    limit: 10
  });
  
  return onSnapshot(q, (snapshot) => {
    firebaseLogger.info('=== RECEIVED RECENT PLAYS UPDATE ===');
    firebaseLogger.info('Number of docs:', snapshot.docs.length);
    
    if (snapshot.empty) {
      firebaseLogger.info('No documents found');
      callback([]);
      return;
    }
    
    const nfts = snapshot.docs.map(doc => {
      const data = doc.data();
      return data.nft;
    });
    
    firebaseLogger.info(`Returning ${nfts.length} recent plays`);
    callback(nfts);
  });
};

// Get a user's play history from their playHistory subcollection
export const getUserPlayHistory = async (fid: number, maxResults = 50): Promise<NFT[]> => {
  try {
    if (!fid) {
      firebaseLogger.error('Invalid FID provided to getUserPlayHistory');
      return [];
    }

    firebaseLogger.info(`Getting play history for FID ${fid} from users/${fid}/playHistory subcollection`);
    
    // Query the user's playHistory subcollection
    const playHistoryRef = collection(db, 'users', fid.toString(), 'playHistory');
    const q = query(
      playHistoryRef,
      orderBy('timestamp', 'desc'),
      limit(maxResults)
    );
    
    const querySnapshot = await getDocs(q);
    const playHistory: NFT[] = [];
    const seenMediaKeys = new Set<string>();
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      
      // Create an NFT object from the play data
      const nft: NFT = {
        contract: data.nftContract,
        tokenId: data.tokenId,
        name: data.name || 'Untitled',
        description: data.description || '',
        image: data.image || '',
        audio: data.audioUrl,
        network: data.network || 'ethereum',
        mediaKey: data.mediaKey, // This is critical for consistent tracking
        playCount: data.playCount || 1,
        timestamp: data.timestamp
      };
      
      // Only add if we haven't seen this mediaKey before (deduplicate)
      if (nft.mediaKey && !seenMediaKeys.has(nft.mediaKey)) {
        seenMediaKeys.add(nft.mediaKey);
        playHistory.push(nft);
      }
    });
    
    firebaseLogger.info(`Found ${playHistory.length} unique NFTs in play history for FID ${fid}`);
    return playHistory;
  } catch (error) {
    firebaseLogger.error('Error getting user play history:', error instanceof Error ? error.message : 'Unknown error');
    return [];
  }
};

// Subscribe to a user's play history in real-time from their playHistory subcollection
export const subscribeToUserPlayHistory = (fid: number, maxResults = 50, callback: (nfts: NFT[]) => void) => {
  if (!fid) {
    firebaseLogger.error('Invalid FID provided to subscribeToUserPlayHistory');
    return () => {};
  }

  firebaseLogger.info(`Subscribing to play history for FID ${fid} from users/${fid}/playHistory subcollection`);
  
  // Query the user's playHistory subcollection
  const playHistoryRef = collection(db, 'users', fid.toString(), 'playHistory');
  const q = query(
    playHistoryRef,
    orderBy('timestamp', 'desc'),
    limit(maxResults)
  );
  
  // Set up real-time listener
  return onSnapshot(q, (snapshot) => {
    const playHistory: NFT[] = [];
    const seenMediaKeys = new Set<string>();
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      
      // Create an NFT object from the play data
      const nft: NFT = {
        contract: data.nftContract,
        tokenId: data.tokenId,
        name: data.name || 'Untitled',
        description: data.description || '',
        image: data.image || '',
        audio: data.audioUrl,
        network: data.network || 'ethereum',
        mediaKey: data.mediaKey, // This is critical for consistent tracking
        playCount: data.playCount || 1,
        timestamp: data.timestamp
      };
      
      // Only add if we haven't seen this mediaKey before (deduplicate)
      if (nft.mediaKey && !seenMediaKeys.has(nft.mediaKey)) {
        seenMediaKeys.add(nft.mediaKey);
        playHistory.push(nft);
      }
    });
    
    firebaseLogger.info(`Real-time update: ${playHistory.length} unique NFTs in play history for FID ${fid}`);
    callback(playHistory);
  }, (error) => {
    firebaseLogger.error('Error in play history subscription:', error);
  });
};
