import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import type { NFT } from '../../types/nft';
import { db, firebaseLogger } from './config';
import { isPlayableMediaNFT } from '../../utils/isMediaNFT';
import { getMediaKey } from '../../utils/media';
import { cacheUserWallet, getCachedWallet } from './user';
import { fetchWithRetry } from './helpers';

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
        const { fetchUserNFTsFromAlchemy } = await import('../nft');
        firebaseLogger.info('Successfully imported nft module for ENS user');
        
        // Fetch NFTs for the ENS address with explicit logging
        firebaseLogger.info(`Calling Alchemy API to fetch NFTs for ENS ${ensName} at address: ${address}`);
        const nfts = await fetchUserNFTsFromAlchemy(address);
        
        // Process mediaKeys for all NFTs to ensure consistent tracking
        const processedNFTs = nfts.map((nft: NFT) => {
          // If NFT doesn't have a mediaKey yet (from alchemy fetching)
          if (!nft.mediaKey) {
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
    const { fetchUserNFTsFromAlchemy } = await import('../nft');
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

// Store featured NFTs in Firebase if they don't exist
export const ensureFeaturedNFTsExist = async (nfts: NFT[]): Promise<void> => {
  try {
    const refs = nfts.map((nft) => doc(db, 'nfts', `${nft.contract}-${nft.tokenId}`));
    const snaps = await Promise.all(refs.map((nftRef) => getDoc(nftRef)));
    const batch = writeBatch(db);
    let writes = 0;

    snaps.forEach((nftDoc, index) => {
      if (nftDoc.exists()) return;
      const nft = nfts[index];
      batch.set(refs[index], {
        ...nft,
        likes: 0,
        plays: 0,
        timestamp: serverTimestamp()
      });
      writes += 1;
    });

    if (writes === 0) return;
    await batch.commit();
    firebaseLogger.info('Featured NFTs stored in Firebase');
  } catch (error) {
    firebaseLogger.error('Error storing featured NFTs:', error);
  }
};
