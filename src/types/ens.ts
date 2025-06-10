import { FarcasterUser } from './user';

/**
 * ENS User interface that extends FarcasterUser for compatibility
 * with existing app components
 */
// Define the linked identity interface
export interface LinkedIdentity {
  type: 'farcaster' | 'ens';
  fid: number;
  username: string;
  display_name: string;
}

export interface ENSUser extends FarcasterUser {
  // ENS-specific fields
  ensName: string;
  address: string;
  isENS: true; // Flag to identify ENS users
  
  // Required fields from FarcasterUser with default values
  fid: number; // We'll use a negative number to indicate ENS user
  username: string; // Will be set to ENS name without .eth
  display_name: string; // Will be set to full ENS name
  follower_count: number; // Default to 0
  following_count: number; // Default to 0
  
  // Optional fields
  description?: string;
  url?: string;
  twitter?: string;
  discord?: string;
  
  // Linked identity information (when a wallet has both ENS and Farcaster)
  linkedIdentity?: LinkedIdentity;
}

/**
 * Function to convert ENS profile data to an ENSUser object
 * that's compatible with the app's existing FarcasterUser interface
 */
export function createENSUser(ensProfile: any): ENSUser {
  // Handle different field names between old and new implementations
  const ensName = ensProfile.ensName || ensProfile.name || '';
  
  // Extract username from ENS name (remove .eth)
  const username = ensName.replace('.eth', '') || '';
  
  // Generate a negative FID to ensure it doesn't conflict with Farcaster FIDs
  // Use a hash of the address to create a consistent negative number
  const addressHash = ensProfile.address ? 
    parseInt(ensProfile.address.slice(2, 10), 16) : 0;
  const fid = -Math.abs(addressHash);
  
  return {
    // ENS-specific fields
    ensName: ensName,
    address: ensProfile.address || '',
    isENS: true,
    
    // FarcasterUser compatibility fields
    fid,
    username,
    display_name: ensName || username,
    pfp_url: ensProfile.avatar || `https://avatar.vercel.sh/${username}`,
    follower_count: 0,
    following_count: 0,
    
    // Optional profile fields
    profile: {
      bio: ensProfile.description || '',
    },
    custody_address: ensProfile.address,
    verified_addresses: {
      eth_addresses: [ensProfile.address],
    },
    
    // Additional ENS profile data
    description: ensProfile.description,
    url: ensProfile.url,
    twitter: ensProfile.twitter,
    discord: ensProfile.discord,
  };
}
