import React from 'react';
import { NFTImage } from './media/NFTImage';
import { processMediaUrl } from '../utils/media';

// Import the NFT type
import { NFT } from '../types/user';

interface NFTCardProps {
  nft: NFT;
  onClick?: (nft: NFT) => void;
  isCompact?: boolean;
  isPreview?: boolean;
  isPlaying?: boolean; // Add this missing property
  currentlyPlayingId?: string;
  isPriority?: boolean;
}

// Fix the syntax error and make sure isPlaying is part of props
export const NFTCard: React.FC<NFTCardProps> = ({
  nft,
  onClick,
  isCompact = false,
  isPreview = false,
  isPlaying = false, // Add default value
  currentlyPlayingId,
  isPriority = false,
}) => {
  const handleClick = () => {
    if (onClick) {
      onClick(nft);
    }
  };

  return (
    <div 
      className={`relative rounded-lg overflow-hidden cursor-pointer transition-transform duration-200 ${isPlaying ? 'scale-105 shadow-lg' : 'hover:scale-102'}`}
      onClick={handleClick}
    >
      <div className="aspect-w-1 aspect-h-1 w-full">
        <NFTImage
          nft={nft}
          src={processMediaUrl(typeof nft.image === 'string' ? nft.image : (nft.metadata?.image || ''))}
          alt={nft.name || 'NFT'}
          width={500}
          height={500}
          className="object-cover w-full h-full rounded-lg"
          priority={isPriority}
        />
      </div>
      
      {/* Play/Pause indicator */}
      {isPlaying && (
        <div className="absolute bottom-2 right-2 bg-black/70 rounded-full p-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="w-4 h-4">
            <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clipRule="evenodd" />
          </svg>
        </div>
      )}
      
      {/* NFT name/title */}
      {!isCompact && (
        <div className="p-3 bg-gray-900">
          <h3 className="text-sm font-medium text-white truncate">{nft.name || nft.metadata?.name || 'Unnamed NFT'}</h3>
        </div>
      )}
    </div>
  );
}; 