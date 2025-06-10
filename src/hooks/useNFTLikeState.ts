import { useState, useEffect, useRef } from 'react';
import { getFirestore, doc, getDoc, setDoc, onSnapshot, DocumentSnapshot } from 'firebase/firestore';
import type { NFT } from '../types/user';
import { getMediaKey, isPlaybackActive } from '../utils/media';
import { usePrivy } from '@privy-io/react-auth';
import { v4 as uuidv4 } from 'uuid';

// Create a logger specifically for like state management with playback awareness
const likeStateLogger = {
  debug: (message: string, ...args: any[]) => {
    if (!isPlaybackActive()) {
      console.debug(`[LikeState] ${message}`, ...args);
    }
  },
  info: (message: string, ...args: any[]) => {
    if (!isPlaybackActive()) {
      console.info(`[LikeState] ${message}`, ...args);
    }
  },
  warn: (message: string, ...args: any[]) => console.warn(`[LikeState] ${message}`, ...args),
  error: (message: string, ...args: any[]) => console.error(`[LikeState] ${message}`, ...args),
};


// Cache to prevent duplicate listeners for the same NFT/user combination
const activeListeners = new Map<string, number>();

// Generate a unique, random media key for each NFT
const generateMediaKey = (nft: NFT): string => {
  return uuidv4();
};

export const useNFTLikeState = (nft: NFT | null, fid: number) => {
  const [isLiked, setIsLiked] = useState<boolean>(false);
  const [likesCount, setLikesCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  
  // Get Privy authentication state
  const { authenticated: privyAuthenticated, user: privyUser } = usePrivy();
  
  // Track the mediaKey to help with debugging
  const mediaKeyRef = useRef<string>('');
  
  // Track subscription status
  const isSubscribedRef = useRef<boolean>(false);
  
  // Create a cache key for this NFT/user combination
  const cacheKeyRef = useRef<string>('');
  
  // Get the wallet address from Privy if available
  const walletAddressRef = useRef<string>('');
  
  // No need for complex migration - we'll just use Firebase directly like with Farcaster FIDs

  // Determine the user ID to use for likes (wallet address for Privy, fid for Farcaster)
  useEffect(() => {
    if (privyAuthenticated && privyUser) {
      try {
        // CRITICAL: Check for linked wallet accounts
        const walletAccounts = privyUser.linkedAccounts?.filter(account => 
          account.type === 'wallet'
        );
        
        if (walletAccounts && walletAccounts.length > 0) {
          // Get the first wallet address
          const address = walletAccounts[0].address;
          if (address) {
            // IMPORTANT: Ensure wallet address is lowercase for consistency
            walletAddressRef.current = address.toLowerCase();
            console.error('🔴 PRIVY AUTH: Using wallet address for likes:', walletAddressRef.current);
            likeStateLogger.info('Using Privy wallet address for likes:', walletAddressRef.current);
            
            // Store the wallet address in localStorage for persistence across sessions
            try {
              localStorage.setItem('podplyr_wallet_address', walletAddressRef.current);
              likeStateLogger.info('Saved wallet address to localStorage for persistence');
            } catch (storageError) {
              likeStateLogger.error('Failed to save wallet address to localStorage:', storageError);
            }
          }
        } else {
          console.error('🔴 PRIVY AUTH: No wallet accounts found in Privy user');
          likeStateLogger.warn('No wallet accounts found in Privy user');
          
          // Try to recover from localStorage if available
          try {
            const savedAddress = localStorage.getItem('podplyr_wallet_address');
            if (savedAddress && savedAddress.startsWith('0x')) {
              walletAddressRef.current = savedAddress.toLowerCase();
              likeStateLogger.info('Recovered wallet address from localStorage:', walletAddressRef.current);
            }
          } catch (storageError) {
            likeStateLogger.error('Failed to recover wallet address from localStorage:', storageError);
          }
        }
      } catch (error) {
        console.error('🔴 PRIVY AUTH: Error getting wallet address from Privy:', error);
        likeStateLogger.error('Error getting wallet address from Privy:', error);
        
        // Try to recover from localStorage as fallback
        try {
          const savedAddress = localStorage.getItem('podplyr_wallet_address');
          if (savedAddress && savedAddress.startsWith('0x')) {
            walletAddressRef.current = savedAddress.toLowerCase();
            likeStateLogger.info('Recovered wallet address from localStorage as fallback:', walletAddressRef.current);
          }
        } catch (storageError) {
          likeStateLogger.error('Failed to recover wallet address from localStorage:', storageError);
        }
      }
    } else {
      // Not authenticated with Privy, but try to recover from localStorage
      try {
        const savedAddress = localStorage.getItem('podplyr_wallet_address');
        if (savedAddress && savedAddress.startsWith('0x')) {
          walletAddressRef.current = savedAddress.toLowerCase();
          likeStateLogger.info('Using saved wallet address from localStorage while not authenticated:', walletAddressRef.current);
        }
      } catch (storageError) {
        // Silently fail - not critical when not authenticated
      }
    }
  }, [privyAuthenticated, privyUser]);

  useEffect(() => {
    if (!nft) {
      setIsLiked(false);
      setLikesCount(0);
      setIsLoading(false);
      isSubscribedRef.current = false;
      return;
    }
    
    const mediaKey = generateMediaKey(nft);
    mediaKeyRef.current = mediaKey;

    // CRITICAL: Determine which user ID to use (wallet address for Privy, fid for Farcaster)
    // This is the EXACT SAME PRINCIPLE as with Farcaster FIDs, just using wallet address instead
    let userId = '';
    
    // For Privy users: Use wallet address
    if (walletAddressRef.current && walletAddressRef.current.startsWith('0x')) {
      userId = walletAddressRef.current.toLowerCase();
      likeStateLogger.info('Using Privy wallet address for Firebase path:', userId);
    }
    // For Farcaster users: Use FID
    else if (fid > 0) {
      userId = fid.toString();
      likeStateLogger.info('Using Farcaster ID for Firebase path:', userId);
    }
    
    // Fallback: Try to recover wallet from localStorage (for Privy users who refreshed)
    if (!userId) {
      try {
        const savedAddress = localStorage.getItem('podplyr_wallet_address');
        if (savedAddress && savedAddress.startsWith('0x')) {
          userId = savedAddress.toLowerCase();
          walletAddressRef.current = userId; // Update the ref for consistency
          likeStateLogger.info('Using recovered wallet address from localStorage:', userId);
        }
      } catch (error) {
        likeStateLogger.error('Error accessing localStorage:', error);
      }
    }
    
    // CRITICAL: If we don't have any valid user ID, we can't track likes
    if (!userId) {
      console.error('🔴 NO VALID USER ID FOR LIKES: Neither wallet address nor FID available');
      likeStateLogger.error('No valid user ID for likes: Neither wallet address nor FID available');
      setIsLiked(false);
      setLikesCount(0);
      setIsLoading(false);
      isSubscribedRef.current = false;
      return;
    }
    
    console.log('🔑 Using user ID for likes:', { 
      userId, 
      isWalletAddress: userId.startsWith('0x'),
      isFid: !userId.startsWith('0x') && userId !== '',
      walletAddress: walletAddressRef.current,
      fid,
      mediaKey
    });
    
    // Create a cache key for this NFT/user combination
    const cacheKey = `${mediaKey}-${userId}`;
    cacheKeyRef.current = cacheKey;
    
    // Check if we already have an active listener for this NFT/user combination
    const listenerCount = activeListeners.get(cacheKey) || 0;
    activeListeners.set(cacheKey, listenerCount + 1);
    
    // Only log for the first instance of this NFT/user combination
    if (listenerCount === 0 && process.env.NODE_ENV === 'development' && !isPlaybackActive()) {
      likeStateLogger.info('Setting up like state listeners for:', { 
        nftName: nft.name, 
        mediaKey,
        userId,
        isPrivyUser: Boolean(walletAddressRef.current),
        isFarcasterUser: Boolean(fid && fid > 0),
        firebasePath: `users/${userId}/likes/${mediaKey}`
      });
    }
    
    // Set loading true while we check
    setIsLoading(true);
    
    // FIRST: Do an immediate check instead of waiting for the listener
    const db = getFirestore();
    
    // Define references once to avoid redeclaration
    const globalLikeRef = doc(db, 'global_likes', mediaKey);
    const userLikeRef = doc(db, 'users', userId, 'likes', mediaKey);
    
    // Log the Firebase path for debugging
    console.error('🔴 FIREBASE PATH FOR LIKES:', userLikeRef.path, {
      userId,
      mediaKey,
      isWalletAddress: userId.startsWith('0x'),
      isFid: !userId.startsWith('0x')
    });
    
    // Get the initial state immediately with getDoc
    getDoc(userLikeRef).then(docSnap => {
      let initialLikedState = docSnap.exists();
      
      // CRITICAL: If Firebase doesn't show this as liked, check localStorage as a fallback
      if (!initialLikedState) {
        try {
          // Check if this mediaKey is in the liked keys in localStorage
          const likedKeysString = localStorage.getItem('podplyr_liked_mediakeys');
          if (likedKeysString) {
            const likedKeys = likedKeysString.split(',');
            if (likedKeys.includes(mediaKey)) {
              // Found in localStorage! Mark as liked and update Firebase
              initialLikedState = true;
              console.error('🔴 RECOVERED LIKE STATE FROM LOCALSTORAGE:', {
                mediaKey,
                userId,
                nftName: nft.name
              });
              likeStateLogger.info('Recovered like state from localStorage for:', mediaKey);
              
              // Update Firebase to match localStorage (fire-and-forget)
              setDoc(userLikeRef, {
                mediaKey,
                contract: nft.contract,
                tokenId: nft.tokenId,
                name: nft.name || 'Untitled',
                timestamp: new Date(),
                isLiked: true
              }).catch(err => {
                likeStateLogger.error('Failed to update Firebase with recovered like state:', err);
              });
            }
          }
        } catch (error) {
          likeStateLogger.error('Error checking localStorage for like state:', error);
        }
      }
      
      setIsLiked(initialLikedState);
      setIsLoading(false);
      
      // Only log during development or when not in playback mode
      if (process.env.NODE_ENV === 'development' && !isPlaybackActive()) {
        likeStateLogger.info('Initial like state loaded:', { 
          isLiked: initialLikedState, 
          mediaKey,
          nftName: nft.name,
          userId,
          isPrivyUser: Boolean(walletAddressRef.current),
          isFarcasterUser: Boolean(fid && fid > 0),
          timestamp: new Date().toISOString(),
          recoveredFromLocalStorage: initialLikedState && !docSnap.exists()
        });
      }
      
      // Update DOM elements for consistency
      try {
        document.querySelectorAll(`[data-media-key="${mediaKey}"]`).forEach(element => {
          element.setAttribute('data-liked', initialLikedState ? 'true' : 'false');
        });
      } catch (err) {
        // Ignore DOM errors
      }
    }).catch(error => {
      likeStateLogger.error('Error getting initial like state:', { error, mediaKey });
      setIsLoading(false);
    });
    
    // Now set up the real-time listeners

    // Set up real-time listeners
    const unsubscribeGlobal = onSnapshot(globalLikeRef,
      (snapshot: DocumentSnapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          const count = data?.likeCount || 0;
          setLikesCount(count);
          // Only log during development or when not in playback mode
          if (process.env.NODE_ENV === 'development' && !isPlaybackActive()) {
            likeStateLogger.debug('Global like count updated:', { 
              count, 
              mediaKey,
              nftName: nft.name,
              timestamp: new Date().toISOString()
            });
          }
        } else {
          setLikesCount(0);
          // Only log during development or when not in playback mode
          if (process.env.NODE_ENV === 'development' && !isPlaybackActive()) {
            likeStateLogger.debug('No global likes found for:', { mediaKey, nftName: nft.name });
          }
        }
      },
      (error: Error) => {
        likeStateLogger.error('Error listening to global likes:', { error, mediaKey, nftName: nft.name });
        setLikesCount(0);
      }
    );

    // Set up user like state listener with enhanced error handling and localStorage backup
    const unsubscribeUser = onSnapshot(userLikeRef,
      (snapshot: DocumentSnapshot) => {
        const newLikedState = snapshot.exists();
        setIsLiked(newLikedState);
        setIsLoading(false);
        setLastUpdated(Date.now());
        isSubscribedRef.current = true;
        
        // CRITICAL: Store the like state in localStorage as a backup
        // This ensures we can recover like state even if Firebase listener fails
        try {
          // Get existing liked mediaKeys from localStorage
          const existingLikedKeys = localStorage.getItem('podplyr_liked_mediakeys') || '';
          const likedKeysArray = existingLikedKeys ? existingLikedKeys.split(',') : [];
          
          if (newLikedState) {
            // Add this mediaKey if it's not already in the list
            if (!likedKeysArray.includes(mediaKey)) {
              likedKeysArray.push(mediaKey);
              localStorage.setItem('podplyr_liked_mediakeys', likedKeysArray.join(','));
              likeStateLogger.info('Added mediaKey to liked keys in localStorage:', mediaKey);
            }
          } else {
            // Remove this mediaKey from the list
            const updatedKeys = likedKeysArray.filter(key => key !== mediaKey);
            localStorage.setItem('podplyr_liked_mediakeys', updatedKeys.join(','));
            likeStateLogger.info('Removed mediaKey from liked keys in localStorage:', mediaKey);
          }
        } catch (storageError) {
          likeStateLogger.error('Failed to update liked mediaKeys in localStorage:', storageError);
        }
        
        // Only log during development or when not in playback mode
        if (process.env.NODE_ENV === 'development' && !isPlaybackActive()) {
          likeStateLogger.info('User like state updated:', { 
            isLiked: newLikedState, 
            mediaKey,
            nftName: nft.name,
            userId,
            timestamp: new Date().toISOString()
          });
        }
        
        // Update DOM elements for consistency
        try {
          document.querySelectorAll(`[data-media-key="${mediaKey}"]`).forEach(element => {
            element.setAttribute('data-liked', newLikedState ? 'true' : 'false');
          });
        } catch (error) {
          // Silently fail DOM updates - not critical
        }
        
        // Log the like state change only when not in playback mode
        if (!isPlaybackActive()) {
          likeStateLogger.info('User like state updated:', { 
            isLiked: newLikedState, 
            mediaKey,
            nftName: nft.name,
            userId: walletAddressRef.current || fid.toString(),
            isPrivyUser: Boolean(walletAddressRef.current),
            isFarcasterUser: Boolean(fid && fid > 0),
            timestamp: new Date().toISOString(),
            docExists: snapshot.exists(),
            docId: snapshot.id
          });
        }
        
        // Update DOM elements with this mediaKey to ensure UI consistency
        try {
          document.querySelectorAll(`[data-media-key="${mediaKey}"]`).forEach(element => {
            element.setAttribute('data-liked', newLikedState ? 'true' : 'false');
            // Only log DOM updates when not in playback mode
            if (!isPlaybackActive()) {
              likeStateLogger.debug('Updated DOM element with new like state:', { 
                element: element.tagName, 
                mediaKey,
                newState: newLikedState
              });
            }
          });
        } catch (error) {
          likeStateLogger.error('Error updating DOM elements:', error);
        }
      },
      (error: Error) => {
        likeStateLogger.error('Error listening to user like status:', { 
          error, 
          mediaKey, 
          nftName: nft.name,
          userId: walletAddressRef.current || fid.toString(),
          isPrivyUser: Boolean(walletAddressRef.current),
          isFarcasterUser: Boolean(fid && fid > 0)
        });
        setIsLiked(false);
        setIsLoading(false);
        isSubscribedRef.current = false;
      }
    );

    // Cleanup listeners when component unmounts or NFT/FID changes
    return () => {
      const cacheKey = cacheKeyRef.current;
      if (cacheKey) {
        const count = activeListeners.get(cacheKey) || 0;
        if (count <= 1) {
          // This is the last instance, actually unsubscribe and remove from cache
          activeListeners.delete(cacheKey);
          
          // Only log cleanup for the last instance when not in playback mode
          if (!isPlaybackActive()) {
            likeStateLogger.debug('Cleaning up like state listeners for:', { 
              mediaKey, 
              nftName: nft?.name,
              userId: walletAddressRef.current || fid.toString(),
              isPrivyUser: Boolean(walletAddressRef.current),
              isFarcasterUser: Boolean(fid && fid > 0)
            });
          }
          
          unsubscribeGlobal();
          unsubscribeUser();
        } else {
          // Decrement the counter but keep the listeners active
          activeListeners.set(cacheKey, count - 1);
        }
      }
      isSubscribedRef.current = false;
    };
  }, [nft, fid, privyAuthenticated, privyUser]);

  // Add listener for custom like state change events
  // This ensures the hook responds to like state changes from other components
  useEffect(() => {
    if (!nft || !mediaKeyRef.current) return;
    
    const mediaKey = mediaKeyRef.current;
    
    const handleLikeStateChange = (event: Event) => {
      const customEvent = event as CustomEvent;
      const detail = customEvent.detail;
      
      // Only process events for this NFT
      if (detail.mediaKey === mediaKey || 
          (detail.contract === nft.contract && detail.tokenId === nft.tokenId)) {
        // Log custom events only when not in playback mode
        if (!isPlaybackActive()) {
          likeStateLogger.debug('Received like state change event:', {
            mediaKey,
            nftName: nft.name,
            detail
          });
        }
        
        // Skip if this event originated from this hook (to avoid loops)
        if (detail.source === 'nft-like-state-hook') return;
        
        // We already log this above when not in playback mode, so this is redundant
        // Remove the duplicate log to reduce console noise during playback
        
        // Update the local state to match the event
        setIsLiked(detail.isLiked);
        setLastUpdated(Date.now());
      }
    };
    
    // Handle global like state refresh events
    const handleGlobalLikeStateRefresh = (event: Event) => {
      const customEvent = event as CustomEvent;
      const detail = customEvent.detail;
      
      if (detail && Array.isArray(detail.likedMediaKeys)) {
        // Check if this NFT's mediaKey is in the list of liked mediaKeys
        const isNFTLiked = detail.likedMediaKeys.includes(mediaKey);
        
        // Log only when not in playback mode
        if (!isPlaybackActive()) {
          likeStateLogger.info('Received global like state refresh event:', { 
            mediaKey,
            nftName: nft.name,
            isLiked: isNFTLiked,
            source: detail.source,
            timestamp: new Date().toISOString()
          });
        }
        
        // Update the local state to match the event
        setIsLiked(isNFTLiked);
        setLastUpdated(Date.now());
        
        // Update DOM elements with this mediaKey to ensure UI consistency
        try {
          document.querySelectorAll(`[data-media-key="${mediaKey}"]`).forEach(element => {
            element.setAttribute('data-liked', isNFTLiked ? 'true' : 'false');
            element.setAttribute('data-is-liked', isNFTLiked ? 'true' : 'false');
          });
        } catch (error) {
          likeStateLogger.error('Error updating DOM elements:', error);
        }
      }
    };
    
    // Add event listeners
    document.addEventListener('nftLikeStateChange', handleLikeStateChange);
    document.addEventListener('globalLikeStateRefresh', handleGlobalLikeStateRefresh);
    
    // Clean up
    return () => {
      document.removeEventListener('nftLikeStateChange', handleLikeStateChange);
      document.removeEventListener('globalLikeStateRefresh', handleGlobalLikeStateRefresh);
    };
  }, [nft]);
  
  // Return enhanced object with more information
  return { 
    isLiked, 
    likesCount, 
    isLoading,
    lastUpdated,
    mediaKey: mediaKeyRef.current,
    isSubscribed: isSubscribedRef.current
  };
};
