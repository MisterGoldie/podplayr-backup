'use client';

import React from 'react';
import type { NFT } from '../../types/user';
import { VirtualizedNFTGrid } from '../nft/VirtualizedNFTGrid';

interface NFTGridViewProps {
  nfts: NFT[];
  displayedNFTs: NFT[];
  totalNFTs: number;
  currentlyPlaying: string | null;
  isPlaying: boolean;
  handlePlayPause: () => void;
  onPlayNFT: (nft: NFT) => Promise<void>;
  publicCollections: any[];
  onLikeToggle: (nft: NFT) => Promise<void>;
  isNFTLiked: (nft: NFT, ignoreCurrentPage?: boolean) => boolean;
  userFid?: number;
}

const NFTGridView: React.FC<NFTGridViewProps> = ({
  nfts,
  displayedNFTs,
  totalNFTs,
  currentlyPlaying,
  isPlaying,
  handlePlayPause,
  onPlayNFT,
  publicCollections,
  onLikeToggle,
  isNFTLiked,
  userFid
}) => {
  return (
    <div className="nft-grid-container">
      <div className="nft-count">
        Showing {displayedNFTs.length} of {totalNFTs} NFTs
      </div>
      <div className="nft-grid">
        <VirtualizedNFTGrid 
          nfts={displayedNFTs}
          currentlyPlaying={currentlyPlaying}
          isPlaying={isPlaying}
          handlePlayPause={handlePlayPause}
          onPlayNFT={onPlayNFT}
          publicCollections={publicCollections}
          onLikeToggle={onLikeToggle}
          isNFTLiked={isNFTLiked}
          userFid={userFid}
        />
      </div>
    </div>
  );
};

export default NFTGridView;