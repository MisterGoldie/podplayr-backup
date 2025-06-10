export interface NFTMetadata {
  name?: string;
  description?: string;
  image?: string;
  animation_url?: string;
  properties?: {
    files?: NFTFile[];
    category?: string;
  };
}

export interface NFTFile {
  uri?: string;
  url?: string;
  type?: string;
  mimeType?: string;
  name?: string;
}

export interface NFT {
  contract: string;
  tokenId: string;
  name: string;
  description?: string;
  image?: string;
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
} 