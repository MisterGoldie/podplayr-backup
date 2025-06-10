import { 
  collection,
  collectionGroup,
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
  DocumentData,
  Unsubscribe,
  QuerySnapshot
} from 'firebase/firestore';
import type { NFT } from '../../types/user';
import { db, firebaseLogger } from './config';
import { v4 as uuidv4 } from 'uuid';

// Generate a unique, random media key for each NFT
const getMediaKey = (nft: NFT): string => {
  return uuidv4();
};

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
  if (!fid || fid <= 0) {
    firebaseLogger.error('Invalid fid provided to subscribeToLikedNFTs:', fid);
    callback([]);
    return () => {};
  }

  // Get real-time updates from user's likes subcollection with mediaKey as document ID
  const likesRef = collection(db, 'users', fid.toString(), 'likes');
  const q = query(likesRef, orderBy('timestamp', 'desc')); // Newest first
  
  firebaseLogger.info(`Subscribing to liked NFTs for user ${fid} using mediaKey-based approach`);
  
  // Set up the real-time listener
  const unsubscribe = onSnapshot(q, async (snapshot) => {
    try {
      if (snapshot.empty) {
        firebaseLogger.info(`No liked NFTs found in mediaKey collection for user ${fid}`);
        // Try to migrate old likes if none found in new format
        await cleanupLikes(fid).then(result => {
          const migratedCount = result?.migratedCount || 0;
          if (migratedCount > 0) {
            firebaseLogger.info(`Migrated ${migratedCount} likes, should see an update soon`);
          } else {
            // If nothing to migrate, return empty array
            callback([]);
          }
        });
        return;
      }
      
      // Transform the documents into NFT objects
      const likedNFTs: NFT[] = snapshot.docs.map(doc => {
        const data = doc.data();
        const mediaKey = doc.id; // The document ID is the mediaKey
        
        // Construct a complete NFT object
        const nft: NFT = {
          mediaKey,
          contract: data.contract,
          tokenId: data.tokenId,
          name: data.name || 'Untitled',
          description: data.description || '',
          image: data.image || '',
          audio: data.audioUrl || '',
          // Include metadata
          metadata: data.metadata || {}
        };
        
        // Include any other fields from data
        return {
          ...data,
          ...nft
        } as NFT;
      });
      
      // We no longer need to check for permanently removed NFTs
      // Simply return all NFTs in the user's likes collection
      firebaseLogger.info(`Found ${likedNFTs.length} liked NFTs for user ${fid} using mediaKey-based approach`);
      callback(likedNFTs);
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

// Get liked NFTs for a user using mediaKey-based approach
// Updated to support both wallet addresses (string) and FIDs (number)
export const getLikedNFTs = async (userIdOrWallet: number | string): Promise<NFT[]> => {
  try {
    // Validate the user ID
    if (typeof userIdOrWallet === 'number' && (!userIdOrWallet || userIdOrWallet <= 0)) {
      firebaseLogger.error('Invalid FID provided to getLikedNFTs:', userIdOrWallet);
      return [];
    }
    
    if (typeof userIdOrWallet === 'string' && (!userIdOrWallet || !userIdOrWallet.startsWith('0x'))) {
      firebaseLogger.error('Invalid wallet address provided to getLikedNFTs:', userIdOrWallet);
      return [];
    }
    
    // Convert to string for Firestore path
    const userId = userIdOrWallet.toString();
    
    // Run cleanup to ensure all likes are in mediaKey format (only for FIDs)
    if (typeof userIdOrWallet === 'number') {
      await cleanupLikes(userIdOrWallet);
    }
    
    // Get likes from user's subcollection using mediaKey as document ID
    const likesRef = collection(db, 'users', userId, 'likes');
    const q = query(likesRef, orderBy('timestamp', 'desc')); // Newest first
    
    firebaseLogger.info(`Getting liked NFTs for user ${userId} using mediaKey-based approach`);
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      firebaseLogger.info(`No liked NFTs found for user ${userId}`);
      return [];
    }
    
    // Transform the documents into NFT objects with mediaKey as primary identifier
    let likedNFTs: NFT[] = snapshot.docs.map(doc => {
      const data = doc.data();
      const mediaKey = doc.id; // The document ID is the mediaKey in our content-first architecture
      
      // Construct the NFT object with mediaKey as primary identifier
      const nft: NFT = {
        mediaKey, // Set mediaKey from document ID (essential for content-first approach)
        contract: data.contract || data.nftContract,
        tokenId: data.tokenId,
        name: data.name || 'Untitled',
        description: data.description || '',
        image: data.image || '',
        audio: data.audioUrl || '',
        collection: data.collection ? { name: data.collection } : undefined,
        network: data.network || 'ethereum',
        metadata: data.metadata || {} // Include all metadata
      };
      
      // If we have a nested nft object, prioritize those values
      if (data.nft) {
        Object.assign(nft, {
          contract: data.nft.contract || nft.contract,
          tokenId: data.nft.tokenId || nft.tokenId,
          name: data.nft.name || nft.name,
          description: data.nft.description || nft.description,
          image: data.nft.image || nft.image,
          audio: data.nft.audio || nft.audio,
          metadata: data.nft.metadata || nft.metadata
        });
        
        if (data.nft.collection) {
          nft.collection = {
            name: data.nft.collection.name || (typeof data.nft.collection === 'string' ? data.nft.collection : 'Unknown Collection'),
            image: data.nft.collection.image
          };
        }
      }
      
      // Fill in collection if available from metadata
      if (!nft.collection && data.metadata?.collection) {
        nft.collection = {
          name: data.metadata.collection.name || 'Unknown Collection',
          image: data.metadata.collection.image
        };
      }
      
      // Determine if this is a video NFT
      if (nft.metadata?.animation_url && typeof nft.metadata.animation_url === 'string') {
        const animUrl = nft.metadata.animation_url.toLowerCase();
        
        // First check file extensions - safe and doesn't need URL parsing
        if (animUrl.endsWith('.mp4') || 
            animUrl.endsWith('.webm') || 
            animUrl.endsWith('.mov')) {
          nft.isVideo = true;
        } else {
          // For IPFS detection, properly parse the URL
          try {
            const url = new URL(animUrl);
            
            // Check if this is an IPFS URL (either hostname or path indicates IPFS content)
            const isIpfsUrl = 
              url.hostname === 'ipfs.io' || 
              url.hostname.endsWith('.ipfs.io') ||
              url.hostname === 'cloudflare-ipfs.com' ||
              url.hostname === 'ipfs.infura.io' ||
              url.pathname.startsWith('/ipfs/');
              
            // Check if this might be an audio file by extension
            const isPossiblyAudio = 
              url.pathname.endsWith('.mp3') || 
              url.pathname.endsWith('.wav') || 
              url.pathname.endsWith('.ogg') || 
              url.pathname.endsWith('.flac');
              
            // Mark as video if it's IPFS but not audio
            if (isIpfsUrl && !isPossiblyAudio) {
              nft.isVideo = true;
            }
          } catch (error) {
            // If URL parsing fails, try again with a more careful approach
            try {
              // SECURITY: Proper URL parsing with validation
              const urlWithProtocol = animUrl.startsWith('http') ? animUrl : `https://${animUrl}`;
              const parsedUrl = new URL(urlWithProtocol);
              
              // Define allowed IPFS hostnames
              const allowedIpfsHosts = [
                'ipfs.io',
                'cloudflare-ipfs.com',
                'ipfs.infura.io',
                'dweb.link',
                'gateway.pinata.cloud'
              ];
              
              // Check if the hostname exactly matches or is a subdomain of an allowed host
              const isIpfsHost = allowedIpfsHosts.some(host => 
                parsedUrl.hostname === host || parsedUrl.hostname.endsWith(`.${host}`));
              
              // If it's a valid IPFS host
              if (isIpfsHost) {
                // Check file extension from the pathname
                const path = parsedUrl.pathname.toLowerCase();
                const isAudioFile = path.endsWith('.mp3') || path.endsWith('.wav') || 
                                  path.endsWith('.ogg') || path.endsWith('.flac');
                
                // Mark as video if it's not an audio file
                if (!isAudioFile) {
                  nft.isVideo = true;
                }
              }
            } catch (secondError) {
              // If both parsing attempts fail, log and continue
              console.error('Error parsing animation URL after fallback:', secondError);
            }
          }
        }
      }
      
      // Special case for YouTube links
      // Check for YouTube links in metadata properties
      const externalUrl = nft.metadata?.properties?.['external_url'] || '';
      if (typeof externalUrl === 'string' && externalUrl) {
        try {
          // Parse the URL properly to extract the hostname
          const url = new URL(externalUrl);
          const hostname = url.hostname.toLowerCase();
          
          // Check if hostname is youtube.com or a subdomain, or youtu.be
          if (hostname === 'youtube.com' || 
              hostname.endsWith('.youtube.com') || 
              hostname === 'youtu.be') {
            nft.isVideo = true;
          }
        } catch (error) {
          // If URL parsing fails, try again with a more careful approach
          try {
            // SECURITY: Proper URL parsing with validation - ensure URL has protocol
            const urlWithProtocol = externalUrl.startsWith('http') ? externalUrl : `https://${externalUrl}`;
            const parsedUrl = new URL(urlWithProtocol);
            
            // Define allowed YouTube hostnames
            const youtubeHosts = [
              'youtube.com',
              'www.youtube.com',
              'youtu.be'
            ];
            
            // Check if the hostname exactly matches or is a subdomain of YouTube
            const isYoutubeHost = youtubeHosts.some(host => 
              parsedUrl.hostname === host || 
              // This handles m.youtube.com, music.youtube.com, etc.
              (host === 'youtube.com' && parsedUrl.hostname.endsWith('.youtube.com')));
            
            if (isYoutubeHost) {
              nft.isVideo = true;
            }
          } catch (secondError) {
            // If both parsing attempts fail, log the error and continue
            console.error('Error parsing YouTube URL after fallback:', secondError);
          }
        }
      }
      
      return nft;
    });
    
    // Initialize userLikesSnapshot outside the conditional blocks
    let userLikesSnapshot: QuerySnapshot<DocumentData> | null = null;
    
    // Check if we also need to get old format likes - only for numeric user IDs (FIDs)
    if (typeof userIdOrWallet === 'number') {
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (userData.liked_nfts && Array.isArray(userData.liked_nfts) && userData.liked_nfts.length > 0) {
          // Add these to our results
          likedNFTs = [...likedNFTs, ...userData.liked_nfts];
          
          // Schedule a cleanup
          setTimeout(() => {
            cleanupLikes(userIdOrWallet as number).catch(err => 
              firebaseLogger.error(`Background cleanup failed for user ${userId}:`, err)
            );
          }, 2000);
        }
      }
      
      // Also check user_likes global collection (newer format) - only for FIDs
      const userLikesQuery = query(
        collection(db, 'user_likes'),
        where(documentId(), '>=', `${userId}-`),
        where(documentId(), '<', `${userId}z`)
      );
      
      // Execute the query for FID users
      userLikesSnapshot = await getDocs(userLikesQuery);
      
      if (!userLikesSnapshot.empty) {
        firebaseLogger.info(`Found ${userLikesSnapshot.docs.length} NFTs in user_likes collection for user ${userId}`);
        
        const globalLikedNFTs = userLikesSnapshot.docs.map((doc: any) => {
          const docData = doc.data();
          
          return {
            contract: docData.contract,
            tokenId: docData.tokenId,
            name: docData.name || 'Untitled',
            description: docData.description || '',
            image: docData.image || '',
            audio: docData.audioUrl || '',
            collection: { name: docData.collection || 'Unknown Collection' },
            network: docData.network || 'ethereum'
          } as NFT;
        });
        
        // Add these to our results
        likedNFTs = [...likedNFTs, ...globalLikedNFTs];
      }
    }
    
    // Deduplicate NFTs by contract-tokenId
    const uniqueNFTs = new Map<string, NFT>();
    
    for (const nft of likedNFTs) {
      if (nft && nft.contract && nft.tokenId) {
        const key = `${nft.contract}-${nft.tokenId}`;
        
        // Only add if not already in the map or if this one has more complete data
        if (!uniqueNFTs.has(key) || 
            (!uniqueNFTs.get(key)?.name && nft.name) || 
            (!uniqueNFTs.get(key)?.image && nft.image)) {
          uniqueNFTs.set(key, nft);
        }
      }
    }
    
    likedNFTs = Array.from(uniqueNFTs.values());
    
    // We no longer need to check for permanently removed NFTs
    // Simply return all NFTs in the user's likes collection
    
    firebaseLogger.info(`Processed ${likedNFTs.length} liked NFTs after deduplication`);
    return likedNFTs;
  } catch (error) {
    firebaseLogger.error('Error getting liked NFTs:', error);
    return [];
  }
};

// Toggle NFT like status globally - SIMPLIFIED TO MATCH PLAY COUNTING SYSTEM
// Create a debug function with a CUSTOM FILTER TAG that can be isolated in DevTools
const debugLike = (message: string, data: any = {}) => {
  // Create a custom filter tag "PODPLAYR-DEBUG" that can be isolated in the DevTools console
  // By typing "PODPLAYR-DEBUG" in the filter box, you'll only see these messages
  console.log('PODPLAYR-DEBUG', `LIKE: ${message}`, data);
  
  // Also log as error to make it appear in the error tab
  console.error('PODPLAYR-DEBUG', `LIKE: ${message}`, data);
};

// Modified to support both Farcaster IDs and wallet addresses for Privy users
export const toggleLikeNFT = async (nft: NFT, fidOrWalletAddress: number | string, forceUnlike: boolean = false): Promise<boolean> => {
  // Force debugger to pause at the start of toggleLikeNFT
  debugger; // This will pause execution in Chrome DevTools
  
  // EXTREME UNMISSABLE CONSOLE LOGS
  console.error('🔴🔴🔴 FIREBASE LIKES.TS: toggleLikeNFT FUNCTION STARTED 🔴🔴🔴');
  console.error('📌 NFT:', {
    name: nft.name,
    contract: nft.contract,
    tokenId: nft.tokenId,
    mediaKey: nft.mediaKey || getMediaKey(nft),
    fidOrWalletAddress,
    isWalletAddress: typeof fidOrWalletAddress === 'string',
    isFid: typeof fidOrWalletAddress === 'number',
    timestamp: new Date().toISOString()
  });
  
  // Use window.console to bypass any possible filtering
  window.console.warn('DIRECT WINDOW CONSOLE: toggleLikeNFT STARTED', {
    nft_name: nft?.name,
    contract: nft?.contract,
    tokenId: nft?.tokenId,
    fidOrWalletAddress,
    isWalletAddress: typeof fidOrWalletAddress === 'string',
    isFid: typeof fidOrWalletAddress === 'number',
    timestamp: new Date().toISOString()
  });
  
  // Record the start time for performance tracking
  const startTime = performance.now();
  
  firebaseLogger.info('Starting toggleLikeNFT with NFT:', nft.name, 'and user ID:', fidOrWalletAddress, 
    typeof fidOrWalletAddress === 'string' ? '(wallet address)' : '(fid)');
  
  // Validate the user identifier (either fid or wallet address)
  if (typeof fidOrWalletAddress === 'number' && (!fidOrWalletAddress || fidOrWalletAddress <= 0)) {
    debugLike('ERROR: Invalid FID', { fid: fidOrWalletAddress });
    firebaseLogger.error('Invalid fid provided to toggleLikeNFT:', fidOrWalletAddress);
    
    // Try to recover from localStorage as a fallback for Privy users
    try {
      const savedAddress = localStorage.getItem('podplyr_wallet_address');
      if (savedAddress && savedAddress.startsWith('0x')) {
        fidOrWalletAddress = savedAddress.toLowerCase();
        firebaseLogger.info('Recovered wallet address from localStorage as fallback:', fidOrWalletAddress);
        debugLike('RECOVERED WALLET ADDRESS', { walletAddress: fidOrWalletAddress });
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
      debugLike('ERROR: Invalid wallet address', { walletAddress: fidOrWalletAddress });
      firebaseLogger.error('Invalid wallet address provided to toggleLikeNFT:', fidOrWalletAddress);
      return false;
    }
    // CRITICAL: Ensure wallet addresses are always lowercase for consistency
    fidOrWalletAddress = fidOrWalletAddress.toLowerCase();
    console.error('🔴 NORMALIZING WALLET ADDRESS:', fidOrWalletAddress);
    
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
    debugLike('ERROR: Invalid NFT data', { nft });
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
    debugLike('ERROR: Invalid user ID after normalization', { userId });
    firebaseLogger.error('Invalid user ID after normalization:', userId);
    return false;
  }
    
  console.error('🔴 USING USER ID FOR FIREBASE:', {
    userId,
    originalValue: fidOrWalletAddress,
    isWalletAddress: userId.startsWith('0x'),
    isFid: !userId.startsWith('0x'),
    timestamp: new Date().toISOString()
  });
  
  try {
    // Get mediaKey - critical for content-based likes
    const mediaKey = nft.mediaKey || getMediaKey(nft);
    debugLike('MEDIA KEY', { 
      mediaKey, 
      nftMediaKey: nft.mediaKey, 
      calculatedMediaKey: getMediaKey(nft) 
    });
    
    if (!mediaKey) {
      debugLike('ERROR: No mediaKey', { id: `${nft.contract}-${nft.tokenId}` });
      firebaseLogger.error('Invalid mediaKey for NFT:', nft);
      return false;
    }
    
    // CRITICAL: This is the path where likes are stored in Firebase
    // Format: users/{userId}/likes/{mediaKey}
    // For Farcaster users, userId is the FID as a string
    // For Privy users, userId is the wallet address (lowercase)
    const userLikeRef = doc(db, 'users', userId, 'likes', mediaKey);
    firebaseLogger.info('Using mediaKey for like operation:', mediaKey);
    debugLike('USER LIKE REF', { path: userLikeRef.path });
    console.log('%c📄 FIREBASE PATH:', 'font-size:14px;color:purple;font-weight:bold', userLikeRef.path);
    console.error('🔴 FIREBASE LIKE PATH:', userLikeRef.path, {
      userId,
      mediaKey,
      isWalletAddress: userId.startsWith('0x'),
      isFid: !userId.startsWith('0x')
    });
    
    // Check if user already liked this NFT
    console.log('%c🔎 CHECKING CURRENT LIKE STATUS', 'font-size:14px;color:blue;font-weight:bold');
    const userLikeDoc = await getDoc(userLikeRef);
    const isLiked = userLikeDoc.exists();
    
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
    
    // CRITICAL: Log the current like status for debugging
    console.error('🔴 CURRENT LIKE STATUS:', {
      isLiked,
      docExists: userLikeDoc.exists(),
      userId,
      mediaKey,
      path: userLikeRef.path,
      data: userLikeDoc.exists() ? userLikeDoc.data() : null
    });
    
    // If forceUnlike is true, we always want to unlike, regardless of current state
    // This ensures Library view unlike operations always work correctly
    const shouldUnlike = forceUnlike || isLiked;
    console.log('%c👍 CURRENT STATUS:', 'font-size:14px;color:orange;font-weight:bold', { 
      liked: isLiked, 
      exists: userLikeDoc.exists(),
      mediaKey
    });
    
    // Create a batch for all operations
    const batch = writeBatch(db);
    console.log('%c💾 CREATED BATCH OPERATION', 'font-size:14px;color:blue;font-weight:bold');
    
    // CRITICAL: Update all DOM elements with this mediaKey before Firebase operations
    // This ensures immediate UI feedback regardless of Firebase operation timing
    try {
      console.log('%c🔄 UPDATING DOM ELEMENTS', 'font-size:14px;color:blue;font-weight:bold');
      const newLikeState = !isLiked;
      
      // Use a direct DOM update to ensure all instances are updated immediately
      const elementsToUpdate = document.querySelectorAll(`[data-media-key="${mediaKey}"]`);
      console.log(`Found ${elementsToUpdate.length} elements with mediaKey ${mediaKey}`);
      
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
        console.log(`Updated element: ${element.tagName} with data-liked=${newLikeState}`);
      });
      
      // Also force update any NFT cards that might be using this NFT
      // This is a backup mechanism to ensure UI consistency
      if (nft.contract && nft.tokenId) {
        const nftSelector = `[data-nft-id="${nft.contract}-${nft.tokenId}"]`;
        document.querySelectorAll(nftSelector).forEach(element => {
          element.setAttribute('data-liked', newLikeState ? 'true' : 'false');
          console.log(`Updated NFT element by contract-tokenId: ${element.tagName}`);
        });
      }
      
      console.log(`Updated ${updatedElements.length} of ${elementsToUpdate.length} elements with mediaKey ${mediaKey}`);
    } catch (domError) {
      console.error('Error updating DOM elements:', domError);
      // Continue with Firebase operations even if DOM update fails
    }
    
    if (shouldUnlike) {
      // UNLIKE: Simple deletion from user's likes collection using mediaKey
      console.log('%c💔 UNLIKE OPERATION', 'font-size:16px;color:red;font-weight:bold;background:lightgray;padding:3px;border-radius:3px', { 
        key: mediaKey, 
        name: nft.name,
        contract: nft.contract,
        tokenId: nft.tokenId
      });
      firebaseLogger.info(`Unliking NFT: ${nft.name} (mediaKey: ${mediaKey})`);
      batch.delete(userLikeRef);
      
      // Also delete from global_likes if this is the only user who liked it
      const globalLikeRef = doc(db, 'global_likes', mediaKey);
      const globalLikeDoc = await getDoc(globalLikeRef);
      
      if (globalLikeDoc.exists()) {
        const globalData = globalLikeDoc.data();
        const currentCount = globalData?.likeCount || 1;
        console.log('🌐 Global:', { count: currentCount });
        
        if (currentCount <= 1) {
          console.log('🗑️ Del global:', mediaKey.slice(0, 8));
          batch.delete(globalLikeRef);
        } else {
          console.log('⬇️ Count--:', { key: mediaKey.slice(0, 8), new: currentCount - 1 });
          batch.update(globalLikeRef, {
            likeCount: currentCount - 1,
            lastUnliked: serverTimestamp()
          });
        }
      }
    } else {
      // LIKE: Add to user's likes collection using mediaKey as document ID
      debugLike('LIKE OPERATION', { 
        key: mediaKey, 
        name: nft.name,
        contract: nft.contract,
        tokenId: nft.tokenId
      });
      firebaseLogger.info(`Liking NFT: ${nft.name} (mediaKey: ${mediaKey})`);
      
      // Store essential NFT data
      debugLike('CREATING USER LIKE DATA', { nftName: nft.name });
      const userLikeData = {
        mediaKey,
        contract: nft.contract,
        tokenId: nft.tokenId,
        name: nft.name || 'Untitled',
        description: nft.description || '',
        image: nft.image || '',
        audioUrl: nft.audio || '',
        metadata: nft.metadata || {},
        timestamp: serverTimestamp(),
        // CRITICAL: Add explicit isLiked flag to ensure consistent state
        isLiked: true,
        // CRITICAL: Add user identifier information to help with debugging
        userId: userId,
        isWalletAddress: userId.startsWith('0x'),
        isFid: !userId.startsWith('0x'),
        likedAt: new Date().toISOString()
      };
      debugLike('USER LIKE DATA CREATED', userLikeData);
      
      console.log('%c📝 SETTING USER LIKE DOCUMENT', 'font-size:14px;color:blue;font-weight:bold', { 
        key: mediaKey, 
        path: userLikeRef.path,
        userId: userId
      });
      batch.set(userLikeRef, userLikeData);
      
      // We no longer need to track permanently removed NFTs
      // Simply adding to the likes collection is sufficient
      console.log('%c✅ ADDING TO LIKES COLLECTION', 'font-size:14px;color:green;font-weight:bold', { 
        mediaKey, 
        nftName: nft.name 
      });
      firebaseLogger.info(`Adding ${mediaKey} to likes collection`);
      
      // Update or create global like entry
      console.log('%c🌎 CHECKING GLOBAL LIKES ENTRY', 'font-size:14px;color:purple;font-weight:bold');
      const globalLikeRef = doc(db, 'global_likes', mediaKey);
      const globalLikeDoc = await getDoc(globalLikeRef);
      
      if (globalLikeDoc.exists()) {
        console.log('%c⬆️ INCREMENTING GLOBAL LIKE COUNT', 'font-size:14px;color:orange;font-weight:bold', { 
          mediaKey, 
          currentCount: globalLikeDoc.data()?.likeCount || 0,
          nftName: nft.name
        });
        batch.update(globalLikeRef, {
          likeCount: increment(1),
          lastLiked: serverTimestamp()
        });
      } else {
        console.log('%c🆕 CREATING NEW GLOBAL LIKE ENTRY', 'font-size:14px;color:green;font-weight:bold', { 
          mediaKey, 
          nftName: nft.name,
          contract: nft.contract,
          tokenId: nft.tokenId
        });
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
    console.log('%c💾 COMMITTING BATCH TO FIREBASE', 'font-size:16px;color:blue;font-weight:bold;background:lightblue;padding:3px;border-radius:3px');
    await batch.commit();
    console.log('%c✅ BATCH COMMITTED SUCCESSFULLY', 'font-size:14px;color:green;font-weight:bold');
    
    // Double-check the like status after the operation AND verify synchronization
    console.log('%c🔎 VERIFYING FINAL LIKE STATUS AND COLLECTION SYNC', 'font-size:14px;color:blue;font-weight:bold');
    const verifyUserDoc = await getDoc(userLikeRef);
    const verifyGlobalDoc = await getDoc(doc(db, 'global_likes', mediaKey));
    const finalLikeStatus = verifyUserDoc.exists();
    
    // Check if the user document and global document are in sync
    const globalExists = verifyGlobalDoc.exists();
    const globalLikeCount = globalExists ? verifyGlobalDoc.data()?.likeCount || 0 : 0;
    
    // Log synchronization status
    console.log('%c🔐 SYNC STATUS', 'font-size:14px;color:purple;font-weight:bold', {
      userDocExists: finalLikeStatus,
      globalDocExists: globalExists,
      globalLikeCount,
      expectedLiked: !isLiked,
      mediaKey,
      nftName: nft.name
    });
    
    // AUTO-RECOVERY: If collections are out of sync, fix it with another batch
    if (finalLikeStatus && (!globalExists || globalLikeCount <= 0)) {
      // User has it liked but global is missing or count is 0 - fix global
      console.log('%c🔧 SYNC ERROR DETECTED - FIXING GLOBAL RECORD', 'font-size:14px;color:red;font-weight:bold');
      
      const recoveryBatch = writeBatch(db);
      const globalLikeRef = doc(db, 'global_likes', mediaKey);
      
      // Recreate or fix the global record
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
      console.log('%c🔧 SYNC FIXED - RECREATED GLOBAL RECORD', 'font-size:14px;color:green;font-weight:bold');
    } else if (!finalLikeStatus && globalExists && globalLikeCount > 0) {
      // User unliked but global still shows likes - check if other users have it liked
      console.log('%c🔎 CHECKING IF OTHER USERS HAVE THIS LIKED', 'font-size:14px;color:blue;font-weight:bold');
      
      const otherUsersQuery = query(
        collectionGroup(db, 'likes'),
        where('mediaKey', '==', mediaKey),
        limit(5)
      );
      
      const otherLikesSnapshot = await getDocs(otherUsersQuery);
      const otherLikesCount = otherLikesSnapshot.size;
      
      console.log('%c🔎 OTHER USERS WITH THIS LIKED:', 'font-size:14px;color:blue;font-weight:bold', {
        count: otherLikesCount,
        users: otherLikesSnapshot.docs.map(d => d.ref.parent.parent?.id)
      });
      
      // If no other users have it liked, but global count is > 0, fix global
      if (otherLikesCount === 0 && globalLikeCount > 0) {
        console.log('%c🔧 SYNC ERROR DETECTED - FIXING GLOBAL COUNT', 'font-size:14px;color:red;font-weight:bold');
        
        const recoveryBatch = writeBatch(db);
        const globalLikeRef = doc(db, 'global_likes', mediaKey);
        
        // Delete the global record since no users have it liked
        recoveryBatch.delete(globalLikeRef);
        
        await recoveryBatch.commit();
        console.log('%c🔧 SYNC FIXED - DELETED GLOBAL RECORD', 'font-size:14px;color:green;font-weight:bold');
      }
    }
    
    // Final verification after potential fixes
    const finalVerifyUserDoc = await getDoc(userLikeRef);
    const finalVerifyGlobalDoc = await getDoc(doc(db, 'global_likes', mediaKey));
    const finalFinalLikeStatus = finalVerifyUserDoc.exists();
    const finalGlobalExists = finalVerifyGlobalDoc.exists();
    
    console.log('%c✅ OPERATION COMPLETE', 'font-size:16px;color:green;font-weight:bold;background:lightgreen;padding:3px;border-radius:3px', { 
      expected: !isLiked, 
      actual: finalFinalLikeStatus, 
      match: finalFinalLikeStatus === !isLiked,
      globalInSync: finalFinalLikeStatus === finalGlobalExists || (!finalFinalLikeStatus && finalGlobalExists && finalVerifyGlobalDoc.data()?.likeCount > 0),
      mediaKey,
      nftName: nft.name
    });
    
    // CRITICAL: Update all DOM elements again after Firebase operation completes
    // This ensures UI state is consistent with Firebase state
    try {
      console.log('%c🔄 FINAL DOM UPDATE', 'font-size:14px;color:blue;font-weight:bold');
      // Force update ALL elements with this mediaKey
      const elementsToUpdate = document.querySelectorAll(`[data-media-key="${mediaKey}"]`);
      console.log(`Final update: Found ${elementsToUpdate.length} elements with mediaKey ${mediaKey}`);
      
      elementsToUpdate.forEach(element => {
        // Update the data-liked attribute
        element.setAttribute('data-liked', finalLikeStatus ? 'true' : 'false');
        // Also update any isLiked data attribute if it exists
        if (element.hasAttribute('data-is-liked')) {
          element.setAttribute('data-is-liked', finalLikeStatus ? 'true' : 'false');
        }
        console.log(`Final update for element: ${element.tagName} with data-liked=${finalLikeStatus}`);
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
    
    // Calculate performance metrics
    const endTime = performance.now();
    const operationTime = endTime - startTime;
    
    console.log('%c⏱️ OPERATION COMPLETED IN', 'font-size:14px;color:purple;font-weight:bold', {
      time: `${operationTime.toFixed(2)}ms`,
      nftName: nft.name,
      mediaKey,
      userIdentifier: userId,
      finalState: finalLikeStatus
    });
    
    // Return the new like state
    return finalLikeStatus;
  } catch (error) {
    // Calculate performance metrics even for errors
    const endTime = performance.now();
    const operationTime = endTime - startTime;
    
    console.error('%c❌ ERROR IN TOGGLE LIKE', 'font-size:16px;color:white;font-weight:bold;background:red;padding:5px;border-radius:5px', {
      error,
      time: `${operationTime.toFixed(2)}ms`,
      nftName: nft.name,
      mediaKey: nft.mediaKey || getMediaKey(nft),
      userIdentifier: userId,
      isWalletAddress: typeof fidOrWalletAddress === 'string',
      source: 'firebase-toggle'
    });
    firebaseLogger.error('Error in toggleLikeNFT:', error);
    
    // CRITICAL: On error, revert any DOM changes to maintain consistency
    try {
      const mediaKey = nft.mediaKey || getMediaKey(nft);
      if (mediaKey) {
        console.log('%c🔄 REVERTING DOM CHANGES DUE TO ERROR', 'font-size:14px;color:red;font-weight:bold');
        // Check current state in Firebase to revert correctly
        // Even in error handling, use the proper user identifier
        const errorUserRef = doc(db, 'users', userId, 'likes', mediaKey);
        const errorUserDoc = await getDoc(errorUserRef);
        const currentLikeState = errorUserDoc.exists();
        
        const elementsToRevert = document.querySelectorAll(`[data-media-key="${mediaKey}"]`);
        console.log(`Reverting ${elementsToRevert.length} elements with mediaKey ${mediaKey} to ${currentLikeState ? 'liked' : 'not liked'}`);
        
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
  console.log('🔍 ADD:', { id: `${nft.contract}-${nft.tokenId}`, fid });
  try {
    // Validate inputs
    if (!fid || fid <= 0) {
      console.error('❌ Invalid fid:', fid);
      firebaseLogger.error('Invalid fid provided to addLikedNFT:', fid);
      throw new Error('Invalid user ID');
    }
    
    if (!nft || !nft.contract || !nft.tokenId) {
      console.error('❌ Invalid NFT:', { id: nft?.contract ? `${nft.contract}-${nft.tokenId}` : 'missing' });
      firebaseLogger.error('Invalid NFT data provided to addLikedNFT:', nft);
      throw new Error('Invalid NFT data');
    }
    
    // Get mediaKey - critical for content-based likes
    const mediaKey = nft.mediaKey || getMediaKey(nft);
    console.log('🔑 Key:', mediaKey?.slice(0, 8));
    
    if (!mediaKey) {
      console.error('❌ No mediaKey:', { id: `${nft.contract}-${nft.tokenId}` });
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
      metadata: nft.metadata || {},
      timestamp: serverTimestamp()
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
  console.log('🔍 DEBUG - removeLikedNFT STARTED', { nft, fid });
  try {
    // Validate inputs
    if (!fid || fid <= 0) {
      console.error('❌ DEBUG - removeLikedNFT ERROR: Invalid fid', { fid });
      firebaseLogger.error('Invalid fid provided to removeLikedNFT:', fid);
      throw new Error('Invalid user ID');
    }
    
    if (!nft || !nft.contract || !nft.tokenId) {
      console.error('❌ DEBUG - removeLikedNFT ERROR: Invalid NFT data', { nft });
      firebaseLogger.error('Invalid NFT data provided to removeLikedNFT:', nft);
      throw new Error('Invalid NFT data');
    }
    
    // Get mediaKey - critical for content-based likes
    const mediaKey = nft.mediaKey || getMediaKey(nft);
    console.log('🔑 DEBUG - removeLikedNFT mediaKey', { mediaKey, nftMediaKey: nft.mediaKey, calculatedMediaKey: getMediaKey(nft) });
    
    if (!mediaKey) {
      console.error('❌ DEBUG - removeLikedNFT ERROR: Could not get mediaKey', { nft });
      firebaseLogger.error('Could not generate mediaKey for NFT:', nft);
      throw new Error('Could not generate mediaKey');
    }
    
    // Reference to user's likes subcollection document using mediaKey
    const userLikeRef = doc(db, 'users', fid.toString(), 'likes', mediaKey);
    console.log('📄 DEBUG - removeLikedNFT userLikeRef path', userLikeRef.path);
    
    // Check if the like exists before removing
    const likeDoc = await getDoc(userLikeRef);
    console.log('🔎 DEBUG - removeLikedNFT checking if like exists', { exists: likeDoc.exists(), data: likeDoc.data() });
    
    // Create a batch for all operations
    const batch = writeBatch(db);
    
    // Remove from user's likes collection
    console.log('💔 DEBUG - removeLikedNFT deleting user like', { mediaKey });
    batch.delete(userLikeRef);
    
    // Also update global like entry
    const globalLikeRef = doc(db, 'global_likes', mediaKey);
    const globalLikeDoc = await getDoc(globalLikeRef);
    
    if (globalLikeDoc.exists()) {
      const globalData = globalLikeDoc.data();
      const currentCount = globalData?.likeCount || 1;
      console.log('🌐 DEBUG - removeLikedNFT global like data', { globalData, currentCount });
      
      if (currentCount <= 1) {
        console.log('🗑️ DEBUG - removeLikedNFT deleting global like', { mediaKey });
        batch.delete(globalLikeRef);
      } else {
        console.log('⬇️ DEBUG - removeLikedNFT decrementing global like count', { mediaKey, newCount: currentCount - 1 });
        batch.update(globalLikeRef, {
          likeCount: currentCount - 1,
          lastUnliked: serverTimestamp()
        });
      }
    } else {
      console.log('⚠️ DEBUG - removeLikedNFT global like not found', { mediaKey });
    }
    
    // Commit all changes
    console.log('💾 DEBUG - removeLikedNFT committing batch');
    await batch.commit();
    
    // Verify the like was removed
    const verifyDoc = await getDoc(userLikeRef);
    console.log('✅ DEBUG - removeLikedNFT verification', { exists: verifyDoc.exists(), shouldBeRemoved: true });
    
    console.log('✅ DEBUG - removeLikedNFT COMPLETED', { nft: nft.name, mediaKey });
    firebaseLogger.info(`Removed NFT from likes: ${nft.name} (mediaKey: ${mediaKey})`);
  } catch (error) {
    console.error('❌ DEBUG - removeLikedNFT ERROR', error);
    firebaseLogger.error('Error removing liked NFT:', error);
    throw error;
  }
};
