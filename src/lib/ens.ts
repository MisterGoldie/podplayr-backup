import { createPublicClient, http, namehash } from 'viem';
import { mainnet } from 'viem/chains';
import { logger } from '../utils/logger';

// Create module-specific logger
const ensLogger = logger.getModuleLogger('ens');

// Create multiple public clients with reliable, CORS-friendly RPC providers
const client = createPublicClient({
  chain: mainnet,
  transport: http('https://rpc.ankr.com/eth'), // Ankr public endpoint
  batch: {
    multicall: true,
  },
});

// First fallback client
const fallbackClient = createPublicClient({
  chain: mainnet,
  transport: http('https://ethereum.publicnode.com'),
});

// Second fallback client - cloudflare's endpoint is often reliable
const secondFallbackClient = createPublicClient({
  chain: mainnet,
  transport: http('https://cloudflare-eth.com'),
});

// Third fallback - use the infura endpoint as last resort
const thirdFallbackClient = createPublicClient({
  chain: mainnet,
  transport: http('https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161'), // Public key
});

/**
 * Get the address associated with an ENS name
 * @param ensName The ENS name to resolve
 * @returns The Ethereum address or null if not found
 */
export const resolveEnsAddress = async (ensName: string): Promise<string | null> => {
  try {
    ensLogger.info('Resolving ENS name to address:', ensName);
    
    // Check if the input is already an address
    if (ensName.startsWith('0x') && ensName.length === 42) {
      ensLogger.info('Input is already an address, returning as is:', ensName);
      return ensName;
    }
    
    // Check if the input is an ENS name (ends with .eth)
    if (!ensName.endsWith('.eth')) {
      ensLogger.info('Input is not an ENS name, appending .eth:', `${ensName}.eth`);
      ensName = `${ensName}.eth`;
    }
    
    // Try all providers in sequence until one succeeds
    try {
      const address = await client.getEnsAddress({
        name: ensName,
      });
      
      ensLogger.info('ENS resolution successful with primary provider');
      return address;
    } catch (primaryError) {
      ensLogger.warn('Primary provider failed, trying first fallback');
      
      try {
        const address = await fallbackClient.getEnsAddress({
          name: ensName,
        });
        
        ensLogger.info('ENS resolution successful with first fallback provider');
        return address;
      } catch (firstFallbackError) {
        ensLogger.warn('First fallback failed, trying second fallback');
        
        try {
          const address = await secondFallbackClient.getEnsAddress({
            name: ensName,
          });
          
          ensLogger.info('ENS resolution successful with second fallback provider');
          return address;
        } catch (secondFallbackError) {
          ensLogger.warn('Second fallback failed, trying third fallback');
          
          try {
            const address = await thirdFallbackClient.getEnsAddress({
              name: ensName,
            });
            
            ensLogger.info('ENS resolution successful with third fallback provider');
            return address;
          } catch (thirdFallbackError) {
            // All providers failed
            ensLogger.error('All providers failed to resolve ENS name', { 
              ensName, 
              error: thirdFallbackError 
            });
            return null;
          }
        }
      }
    }
  } catch (error) {
    ensLogger.error('Critical error resolving ENS name:', error);
    return null;
  }
};

/**
 * Get the ENS name associated with an Ethereum address
 * @param address The Ethereum address to lookup
 * @returns The ENS name or null if not found
 */
export const resolveEnsName = async (address: string): Promise<string | null> => {
  try {
    ensLogger.info('Resolving address to ENS name:', address);
    
    // Validate address format
    if (!address.startsWith('0x') || address.length !== 42) {
      ensLogger.error('Invalid Ethereum address format:', address);
      return null;
    }
    
    // Try all providers in sequence until one succeeds
    try {
      const name = await client.getEnsName({
        address: address as `0x${string}`,
      });
      
      ensLogger.info('Address to ENS resolution successful with primary provider');
      return name;
    } catch (primaryError) {
      ensLogger.warn('Primary provider failed, trying first fallback');
      
      try {
        const name = await fallbackClient.getEnsName({
          address: address as `0x${string}`,
        });
        
        ensLogger.info('Address to ENS resolution successful with first fallback provider');
        return name;
      } catch (firstFallbackError) {
        ensLogger.warn('First fallback failed, trying second fallback');
        
        try {
          const name = await secondFallbackClient.getEnsName({
            address: address as `0x${string}`,
          });
          
          ensLogger.info('Address to ENS resolution successful with second fallback provider');
          return name;
        } catch (secondFallbackError) {
          ensLogger.warn('Second fallback failed, trying third fallback');
          
          try {
            const name = await thirdFallbackClient.getEnsName({
              address: address as `0x${string}`,
            });
            
            ensLogger.info('Address to ENS resolution successful with third fallback provider');
            return name;
          } catch (thirdFallbackError) {
            // All providers failed
            ensLogger.error('All providers failed to resolve address to ENS name', { 
              address, 
              error: thirdFallbackError 
            });
            return null;
          }
        }
      }
    }
  } catch (error) {
    ensLogger.error('Critical error resolving address to ENS name:', error);
    return null;
  }
};

/**
 * Get the avatar associated with an ENS name
 * @param ensNameOrAddress The ENS name or Ethereum address
 * @returns The avatar URL or null if not found
 */
export const resolveEnsAvatar = async (ensNameOrAddress: string): Promise<string | null> => {
  try {
    ensLogger.info('Fetching ENS avatar for:', ensNameOrAddress);
    
    // Determine if input is an address or ENS name
    const isAddress = ensNameOrAddress.startsWith('0x') && ensNameOrAddress.length === 42;
    
    let ensName;
    if (isAddress) {
      // For addresses, we need to find the ENS name first, then get the avatar
      const name = await resolveEnsName(ensNameOrAddress);
      
      if (!name) {
        ensLogger.warn('No ENS name found for address:', ensNameOrAddress);
        return null;
      }
      
      ensName = name;
    } else {
      // Ensure .eth suffix for ENS names
      ensName = ensNameOrAddress.endsWith('.eth') 
        ? ensNameOrAddress 
        : `${ensNameOrAddress}.eth`;
    }
    
    // Try all providers in sequence until one succeeds
    try {
      const avatar = await client.getEnsAvatar({
        name: ensName,
      });
      
      ensLogger.info('Avatar resolution successful with primary provider');
      return avatar;
    } catch (primaryError) {
      ensLogger.warn('Primary provider failed for avatar, trying first fallback');
      
      try {
        const avatar = await fallbackClient.getEnsAvatar({
          name: ensName,
        });
        
        ensLogger.info('Avatar resolution successful with first fallback provider');
        return avatar;
      } catch (firstFallbackError) {
        ensLogger.warn('First fallback failed for avatar, trying second fallback');
        
        try {
          const avatar = await secondFallbackClient.getEnsAvatar({
            name: ensName,
          });
          
          ensLogger.info('Avatar resolution successful with second fallback provider');
          return avatar;
        } catch (secondFallbackError) {
          ensLogger.warn('Second fallback failed for avatar, trying third fallback');
          
          try {
            const avatar = await thirdFallbackClient.getEnsAvatar({
              name: ensName,
            });
            
            ensLogger.info('Avatar resolution successful with third fallback provider');
            return avatar;
          } catch (thirdFallbackError) {
            // All providers failed - use placeholder avatar service instead
            ensLogger.error('All providers failed to resolve avatar', { ensName });
            
            // Generate a placeholder avatar using an external service
            if (ensName) {
              // Use jazzicon/blockies-based services as fallback (works with no ENS)
              return `https://effigy.im/a/${ensNameOrAddress.startsWith('0x') ? ensNameOrAddress : '0x0'}.svg`;
            }
            return null;
          }
        }
      }
    }
  } catch (error) {
    ensLogger.error('Error fetching ENS avatar:', error);
    return null;
  }
};

/**
 * Get a text record for an ENS name
 * @param ensName The ENS name
 * @param key The text record key
 * @returns The text record value or null if not found
 */
export const resolveEnsText = async (ensName: string, key: string): Promise<string | null> => {
  try {
    // Ensure .eth suffix for ENS names
    if (!ensName.endsWith('.eth')) {
      ensName = `${ensName}.eth`;
    }
    
    // Try all providers in sequence until one succeeds
    try {
      const text = await client.getEnsText({
        name: ensName,
        key,
      });
      
      ensLogger.info(`Text record (${key}) resolution successful with primary provider`);
      return text;
    } catch (primaryError) {
      ensLogger.warn(`Primary provider failed for text record (${key}), trying first fallback`);
      
      try {
        const text = await fallbackClient.getEnsText({
          name: ensName,
          key,
        });
        
        ensLogger.info(`Text record (${key}) resolution successful with first fallback provider`);
        return text;
      } catch (firstFallbackError) {
        ensLogger.warn(`First fallback failed for text record (${key}), trying second fallback`);
        
        try {
          const text = await secondFallbackClient.getEnsText({
            name: ensName,
            key,
          });
          
          ensLogger.info(`Text record (${key}) resolution successful with second fallback provider`);
          return text;
        } catch (secondFallbackError) {
          ensLogger.warn(`Second fallback failed for text record (${key}), trying third fallback`);
          
          try {
            const text = await thirdFallbackClient.getEnsText({
              name: ensName,
              key,
            });
            
            ensLogger.info(`Text record (${key}) resolution successful with third fallback provider`);
            return text;
          } catch (thirdFallbackError) {
            // All providers failed
            ensLogger.error(`All providers failed to resolve text record (${key})`, { ensName });
            return null;
          }
        }
      }
    }
  } catch (error) {
    ensLogger.error(`Critical error fetching ENS text record (${key}):`, error);
    return null;
  }
};

/**
 * Get profile information for an ENS name
 * @param ensNameOrAddress The ENS name or Ethereum address
 * @returns Object containing profile information
 */
// Add after existing imports
// Remove multicall import since it's not used and not available

// New optimized function
// Optimized ENS profile function using Promise.allSettled instead of multicall
export const getEnsProfileOptimized = async (ensNameOrAddress: string): Promise<any | null> => {
  try {
    ensLogger.info('Fetching optimized ENS profile for:', ensNameOrAddress);
    
    const isAddress = ensNameOrAddress.startsWith('0x') && ensNameOrAddress.length === 42;
    
    let name, address;
    if (isAddress) {
      address = ensNameOrAddress;
      name = await resolveEnsName(address);
    } else {
      name = ensNameOrAddress.endsWith('.eth') 
        ? ensNameOrAddress 
        : `${ensNameOrAddress}.eth`;
      address = await resolveEnsAddress(name);
    }
    
    if (!address || !name) {
      ensLogger.warn('No address or name found for:', ensNameOrAddress);
      return null;
    }
    
    // Fetch all ENS data in parallel instead of sequential calls
    const [avatarResult, descriptionResult, urlResult, twitterResult, discordResult] = await Promise.allSettled([
      resolveEnsAvatar(address),
      resolveEnsText(name, 'description'),
      resolveEnsText(name, 'url'),
      resolveEnsText(name, 'com.twitter'),
      resolveEnsText(name, 'com.discord')
    ]);
    
    const profile = {
      name,
      address,
      avatar: avatarResult.status === 'fulfilled' ? avatarResult.value : null,
      description: descriptionResult.status === 'fulfilled' ? descriptionResult.value || 'ENS User' : 'ENS User',
      url: urlResult.status === 'fulfilled' ? urlResult.value : null,
      twitter: twitterResult.status === 'fulfilled' ? twitterResult.value : null,
      discord: discordResult.status === 'fulfilled' ? discordResult.value : null,
      isEns: true,
      ensName: name,
    };
    
    ensLogger.info('Optimized ENS profile result:', profile);
    return profile;
  } catch (error) {
    ensLogger.error('Error in optimized ENS profile fetch:', error);
    return null;
  }
};

// Cache implementation with TTL
interface CacheEntry {
  data: any;
  timestamp: number;
}

const ensProfileCache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<any>>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Helper functions for caching
const getCachedEnsProfile = (key: string): any | null => {
  const entry = ensProfileCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  if (entry) {
    ensProfileCache.delete(key); // Remove expired entry
  }
  return null;
};

const setCachedEnsProfile = (key: string, data: any): void => {
  ensProfileCache.set(key, {
    data,
    timestamp: Date.now()
  });
};

export const getEnsProfile = async (ensNameOrAddress: string): Promise<any | null> => {
  const cacheKey = ensNameOrAddress.toLowerCase();
  
  // Check cache first
  const cached = getCachedEnsProfile(cacheKey);
  if (cached) {
    ensLogger.info('Returning cached ENS profile for:', ensNameOrAddress);
    return cached;
  }
  
  // Check if request is already pending
  if (pendingRequests.has(cacheKey)) {
    ensLogger.info('Request already pending for:', ensNameOrAddress);
    return pendingRequests.get(cacheKey);
  }
  
  // Create new request
  const request = getEnsProfileOptimized(ensNameOrAddress);
  pendingRequests.set(cacheKey, request);
  
  try {
    const result = await request;
    if (result) {
      setCachedEnsProfile(cacheKey, result);
    }
    return result;
  } finally {
    pendingRequests.delete(cacheKey);
  }
};

// Simplified fallback logic for better performance
const resolveWithFallback = async <T>(operation: (client: any) => Promise<T>): Promise<T> => {
  try {
    return await operation(client);
  } catch (error) {
    ensLogger.warn('Primary provider failed, trying fallback');
    try {
      return await operation(fallbackClient);
    } catch (fallbackError) {
      ensLogger.error('Both providers failed');
      throw fallbackError;
    }
  }
};