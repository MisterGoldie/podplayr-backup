export const IPFS_GATEWAYS = [
  'https://cloudflare-ipfs.com/ipfs/',  // Most reliable
  'https://nftstorage.link/ipfs/',
  'https://w3s.link/ipfs/',
  'https://4everland.io/ipfs/',
  'https://ipfs.io/ipfs/',              // Move to end as fallback
  'https://gateway.ipfs.io/ipfs/'       // Keep as last resort
];

export const SUPPORTED_AUDIO_FORMATS = [
  '.mp3',
  '.wav',
  '.ogg',
  '.m4a',
  '.aac'
];

export const ANIMATION_FORMATS = {
  VIDEO: ['.mp4', '.webm', '.mov'],
  IMAGE: ['.gif', '.webp']
};

export const PLACEHOLDER_IMAGES = {
  NFT: '/placeholder-image.png',
  AVATAR: '/placeholder-avatar.png',
  VIDEO: '/placeholder-video.png'
};