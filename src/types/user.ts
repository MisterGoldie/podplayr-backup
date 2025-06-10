// Import the LinkedIdentity interface
import { LinkedIdentity } from './ens';

export interface FarcasterUser {
  fid: number;
  username: string;
  display_name?: string;
  pfp_url?: string;
  follower_count: number;
  following_count: number;
  profile?: {
    bio?: string;
    location?: string;
  };
  custody_address?: string;
  warpcast_address?: string;
  verified_addresses?: {
    eth_addresses?: string[];
  };
  verifiedAddresses?: string[];
  isENS?: boolean; // Indicates if this is an ENS user (synthetic FID)
  linkedIdentity?: LinkedIdentity; // Link to another identity (ENS or Farcaster) with the same wallet
}

export interface SearchedUser {
  fid: number;
  username: string;
  display_name?: string;
  pfp_url?: string;
  follower_count: number;
  following_count: number;
  custody_address?: string;
  warpcast_address?: string;
  verifiedAddresses?: string[];
  searchCount: number;
  lastSearched?: any; // FirebaseTimestamp
  timestamp?: any; // FirebaseTimestamp
  isENS?: boolean; // Indicates if this user was found via ENS name resolution
}

export interface FollowedUser {
  fid: number;
  username: string;
  display_name?: string;
  pfp_url?: string;
  timestamp: Date; // When the user was followed
}

export interface NFTMetadata {
  name?: string;
  description?: string;
  image?: string;
  image_url?: string;
  animation_url?: string;
  animation_url_alternative?: string;
  audio?: string;
  audio_url?: string;
  uri?: string;
  mimeType?: string;
  mime_type?: string;
  attributes?: Array<{
    trait_type: string;
    value: string | number;
  }>;
  properties?: {
    files?: NFTFile[];
    category?: string;
    audio?: string;
    audio_url?: string;
    audio_file?: string;
    image?: string;
    animation_url?: string;
    video?: string;
    mimeType?: string;
    soundContent?: {
      url?: string;
    };
    visual?: {
      url?: string;
    };
    [key: string]: any;
  };
  content?: {
    mime?: string;
  };
  animation_details?: {
    format?: string;
  };
}

export interface NFTFile {
  uri?: string;
  url?: string;
  type?: string;
  mimeType?: string;
  name?: string;
}

export interface NFTMedia {
  gateway?: string;
  raw?: string;
  format?: string;
  bytes?: number;
}

export interface NFTPlayData {
  nftContract: string;
  tokenId: string;
  name: string;
  description?: string;
  image: string;
  audioUrl: string;
  collection: string;
  network?: string;
  timestamp?: number;
}

export interface NFT {
  [x: string]: any;
  contract: string;
  tokenId: string;
  name: string;
  description?: string;
  image: string;
  audio?: string;
  metadata?: NFTMetadata;
  collection?: {
    name: string;
    image?: string;
  };
  network?: 'ethereum' | 'base';
  hasValidAudio?: boolean;
  isVideo?: boolean;
  isAnimation?: boolean;
  playTracked?: boolean;
  quantity?: number;
  lastPlayed?: any; // Firestore Timestamp
  mediaKey?: string; // Added: Composite key based on media URLs for deduplication
  
  // Local state properties (not persisted to Firebase)
  addedToRecentlyPlayed?: boolean; // Whether this NFT was added to locally tracked recently played
  addedToRecentlyPlayedAt?: number; // Timestamp when the NFT was added to locally tracked recently played
}

export interface GroupedNFT extends Omit<NFT, 'quantity'> {
  quantity: number;
}

export interface ExtendedFrameContext {
  user?: {
    fid: number;
    username?: string;
    displayName?: string;
    pfpUrl?: string;
    custody_address?: string;
    warpcast_address?: string;
    verified_addresses?: {
      eth_addresses?: string[];
    };
  };
}

export interface PublicCollection {
  id: string;
  name: string;
  description?: string;
  nfts: NFT[];
  createdAt: any;
  updatedAt: any;
}

export interface LibraryViewProps {
  likedNFTs: NFT[];
  handlePlayAudio: (nft: NFT) => Promise<void>;
  currentlyPlaying: string | null;
  isPlaying: boolean;
  handlePlayPause: () => void;
}

export interface ProfileViewProps {
  userContext: UserContext;
  nfts: NFT[];
  handlePlayAudio: (nft: NFT) => Promise<void>;
  isPlaying: boolean;
  currentlyPlaying: string | null;
  handlePlayPause: () => void;
}

export interface UserContext {
  user?: {
    fid: number;
    username?: string;
    displayName?: string;
    pfpUrl?: string;
    custody_address?: string;
    warpcast_address?: string;
    verified_addresses?: {
      eth_addresses?: string[];
    };
  };
}

export interface PageState {
  isHome: boolean;
  isExplore: boolean;
  isLibrary: boolean;
  isProfile: boolean;
}

export type FrameContext = {
  user: {
    fid: number;
    username?: string;
    displayName?: string;
    pfpUrl?: string;
  };
  location?: {
    type: string;
    embed: string;
    cast?: {
      fid: number;
      hash: string;
    };
  };
  client: {
    clientFid: number;
    added: boolean;
    safeAreaInsets?: {
      top: number;
      left: number;
      right: number;
      bottom: number;
    };
    notificationDetails?: {
      type: string;
      id: string;
    };
  };
};

// Rename unused type with underscore prefix
export type _SearchResults = {
  users: FarcasterUser[];
  next?: {
    cursor?: string;
  };
};