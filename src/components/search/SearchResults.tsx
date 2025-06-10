import React from 'react';
import { FarcasterUser } from '../../types/user';
import { NFT } from '../../types/user';
import { NFTCard } from '../nft/NFTCard';

interface SearchResultsProps {
  nfts: NFT[];
  handlePlayAudio: (nft: NFT, context?: string) => Promise<void>;
  isPlaying: boolean;
  currentlyPlaying: string | null;
  handlePlayPause: () => void;
}

export const SearchResults: React.FC<SearchResultsProps> = ({
  nfts,
  handlePlayAudio,
  isPlaying,
  currentlyPlaying,
  handlePlayPause,
}) => {
  if (nfts.length === 0) {
    return <div className="text-center text-gray-500 mt-4">No results found</div>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
      {nfts.map((nft) => (
        <NFTCard
          key={nft.contract}
          nft={nft}
          onPlay={() => handlePlayAudio(nft)}
          isPlaying={isPlaying}
          currentlyPlaying={currentlyPlaying}
          handlePlayPause={handlePlayPause}
        />
      ))}
    </div>
  );
};