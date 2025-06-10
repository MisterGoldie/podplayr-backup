export interface NFTMetadata {
  name?: string;
  description?: string;
  image?: string;
  animation_url?: string;
  properties?: {
    files?: NFTFile[];
    category?: string;
  };
  attributes?: Array<{
    trait_type: string;
    value: string | number;
  }>;
}

export interface NFTFile {
  uri?: string;
  url?: string;
  type?: string;
  mimeType?: string;
  name?: string;
}

export interface NFT {
  [x: string]: any;
  contract: string;
  tokenId: string;
  name: string;
  description?: string;
  image: string;
  animationUrl?: string;
  audio?: string;
  hasValidAudio?: boolean;
  isVideo?: boolean;
  isAnimation?: boolean;
  collection?: {
    name: string;
    image?: string;
  };
  metadata?: NFTMetadata;
  network?: 'ethereum' | 'base';
  playTracked?: boolean;
  quantity?: number;
  lastPlayed?: any; // Firestore Timestamp
  mediaKey?: string; // Added: Composite key based on media URLs for deduplication
  
  // Local state properties (not persisted to Firebase)
  addedToRecentlyPlayed?: boolean; // Whether this NFT was added to locally tracked recently played
  addedToRecentlyPlayedAt?: number; // Timestamp when the NFT was added to locally tracked recently played
} 