import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  doc,
  increment,
  onSnapshot,
  getDoc,
  addDoc,
  serverTimestamp,
  writeBatch,
  Timestamp,
  startAfter,
} from 'firebase/firestore';
import type { NFT } from '../../types/nft';
import { auth, db, firebaseLogger } from './config';
import { getMediaKey, getNftIdentityKey } from '../../utils/media';
import { getNftPlaybackPlan, applyConfirmedPlayback } from '../../utils/isMediaNFT';
import { mergeLegacyPlayCounts } from '../consolidateGlobalPlays';
import { emitPlayCountUpdate, emitUserPlayRecorded } from '../playCountEvents';
import {
  playbackFieldsForStore,
  nftFromPlayRecord,
  buildPlayRecord,
  playTimestampMillis,
} from './helpers';

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

    // InfoPanel listens on global_plays. Commit that increment first.
    // playHistory is owner-checked when signed in; a denied users/1 write
    // used to run before this commit and silently drop the count.
    await batch.commit();
    emitPlayCountUpdate(mediaKey, newPlayCount);

    try {
      await addDoc(collection(db, 'nft_plays'), nftPlayData);
    } catch (error) {
      firebaseLogger.warn('nft_plays append failed after count commit:', error);
    }

    try {
      const historyFid = auth.currentUser?.uid || String(fid);
      const playHistoryRef = collection(db, 'users', historyFid, 'playHistory');
      await addDoc(playHistoryRef, {
        ...nftPlayData,
        fid: Number(historyFid) || fid,
        mediaKey,
        timestamp: Timestamp.now(),
        timestampMs: Date.now(),
      });
      emitUserPlayRecorded(historyFid);
    } catch (error) {
      firebaseLogger.warn('playHistory append failed after count commit:', error);
    }
    
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
        network: data.network,
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
        network: data.network,
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

