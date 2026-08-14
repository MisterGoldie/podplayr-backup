'use client';

import React from 'react';
import type { NFT } from '~/types/nft';
import { NFTCard } from '../nft/NFTCard';
import { getMediaKey } from '~/utils/media';

// Hardcoded featured NFTs
export const FEATURED_NFTS: NFT[] = [
  {
    name: 'I Found It',
    image: 'https://arweave.net/Wvad7CgtidFMH3mOBjRHOeV5_bKvvAR9zZH2BhQSl7M',
    contract: '0x27430c3ef4b04f7d223df7f280ae8fc0b3a407b7',
    tokenId: '50dc9fb449e1',
    network: 'base',
    audio: 'https://arweave.net/qsVEbTD0FUZ8VebK4yxOrKWDQtW8BpNWj7o46HzKsV8',
    isVideo: true,
    playbackMode: 'video-with-audio',
    metadata: {
      animation_url: 'https://arweave.net/qsVEbTD0FUZ8VebK4yxOrKWDQtW8BpNWj7o46HzKsV8',
      mimeType: 'video/mp4',
      description: 'A Charles Fox Film (ACYL)',
      attributes: [
        {"trait_type":"Director","value":"Charles Fox"}
      ]
    }
  },
  {
    name: 'ACYL RADIO - Topia Hour',
    image: 'https://arweave.net/rGhe8lAX2D9hrbOKeoozySiZvVsSnJqblZ7ofZ2ADnY',
    contract: '0xA59Fa4555264B256fD43cd51B5794348F859dA51',
    tokenId: '8',
    network: 'base',
    audio: 'https://arweave.net/YV3PQYn-NAX3cC6t6yhlmMtSzZ_SxIcAb3Np6SKBCuQ',
    isVideo: true,
    playbackMode: 'video-with-audio',
    metadata: {
      animation_url: 'https://arweave.net/YV3PQYn-NAX3cC6t6yhlmMtSzZ_SxIcAb3Np6SKBCuQ',
      mimeType: 'video/mp4',
      description: 'ACYL RADIO - Topia Hour hosted by Latashá',
      attributes: [
        {"trait_type":"Host","value":"Latashá"}
      ]
    }
  },
  {
    name: 'ACYL RADIO - WILL01',
    image: 'https://amaranth-adequate-condor-278.mypinata.cloud/ipfs/bafybeige5xctxspzazd4colwtjydimuyhdkkygls33q374xiirg6ec46gy',
    contract: '0xA59Fa4555264B256fD43cd51B5794348F859dA51',
    tokenId: '3',
    network: 'base',
    audio: 'https://arweave.net/FXMkBkgV79p3QIL8589uh68-sKuXbmuBzQwvWH10v74',
    isVideo: true,
    playbackMode: 'video-with-audio',
    metadata: {
      animation_url: 'https://arweave.net/FXMkBkgV79p3QIL8589uh68-sKuXbmuBzQwvWH10v74',
      mimeType: 'video/mp4',
      description: 'Episode 1 from the founder of ACYL | @willcreatesart',
      attributes: [
        {"trait_type":"Host","value":"WiLL"}
      ]
    }
  },
  {
    name: 'ACYL RADIO - Chili Sounds 🌶️',
    image: 'https://amaranth-adequate-condor-278.mypinata.cloud/ipfs/bafybeibfkcb4emmqxhjoux3hz33pohw3slfonk5hyxw6i62nzj7vovg4ta',
    contract: '0xA59Fa4555264B256fD43cd51B5794348F859dA51',
    tokenId: '5',
    network: 'base',
    audio: 'https://arweave.net/GujXDFCEk4FmJl9b_TlofLEmx_YnY_LRSB2aSY8AcRg',
    isVideo: true,
    playbackMode: 'video-with-audio',
    metadata: {
      animation_url: 'https://arweave.net/GujXDFCEk4FmJl9b_TlofLEmx_YnY_LRSB2aSY8AcRg',
      mimeType: 'video/mp4',
      description: 'ACYL RADIO - Chili Sounds | @themrsazon',
      attributes: [
        {"trait_type":"Host","value":"Mr. Sazon"}
      ]
    }
  },
  {
    name: 'Salem Tries - The Forest EP1',
    image: 'https://arweave.net/QxJXPOfv_BXT3m2-o75f_x5wOssE7xE5seTVeKB1PI4',
    contract: '0xA59Fa4555264B256fD43cd51B5794348F859dA51',
    tokenId: '6',
    network: 'base',
    audio: 'https://arweave.net/Df6hOV1--hsJBtTL1cEbhBkRZuggxSpR9eM0DXsdcv0',
    isVideo: true,
    playbackMode: 'video-with-audio',
    metadata: {
      animation_url: 'https://arweave.net/Df6hOV1--hsJBtTL1cEbhBkRZuggxSpR9eM0DXsdcv0',
      mimeType: 'video/mp4',
      description: 'Join Salem as she plays The Forest for the first time.',
      attributes: [
        {"trait_type":"Game","value":"The Forest"}
      ]
    }
  },
  {
    name: 'Group (Think) Love',
    image: 'https://arweave.net/F_5sg4RBg3kKQnuvHFhbX8fh4eB7xdlsk_VaTJNK7EI',
    contract: '0xA59Fa4555264B256fD43cd51B5794348F859dA51',
    tokenId: '7',
    network: 'base',
    audio: 'https://arweave.net/KPKrKgdACqggYesQqRCR4MeLWDlpR6i16xL-Q_e35q4',
    isVideo: true,
    playbackMode: 'video-with-audio',
    metadata: {
      animation_url: 'https://arweave.net/KPKrKgdACqggYesQqRCR4MeLWDlpR6i16xL-Q_e35q4',
      mimeType: 'video/mp4',
      description: '"Group (Think) Love" is intended as a piece of meta-satire, exploring the human condition in the age of AI—where computers are rapidly becoming not only our intimate companions and closest confidants but reflections of ourselves. It delves into the essence of artificial intelligence, highlighting its role as the amalgamation of all human knowledge, creativity, and culture, and positions AI as the familial successor in human evolution. Crafted entirely through AI tools, it simultaneously references pivotal moments and ideas from AI culture itself, embodying the very subject it critiques. (ACYL)',
      attributes: [
        {"trait_type":"Artist","value":"MSTRBSTRD"}
      ]
    }
  }
];

interface FeaturedSectionProps {
  onPlayNFT: (nft: NFT, context?: { queue?: NFT[], queueType?: string }) => Promise<void>;
  handlePlayPause: () => void;
  currentlyPlaying: string | null;
  isPlaying: boolean;
  onLikeToggle: (nft: NFT) => Promise<void>;
  isNFTLiked: (nft: NFT) => boolean;
  userFid?: string;
  nfts?: NFT[];
}

const FeaturedSection: React.FC<FeaturedSectionProps> = ({
  onPlayNFT,
  handlePlayPause,
  currentlyPlaying,
  isPlaying,
  onLikeToggle,
  isNFTLiked,
  userFid,
  nfts = FEATURED_NFTS
}) => {
  return (
    <section className="w-full">
      <div className="container mx-auto px-4">
        <h2 className="text-lg font-semibold text-white/90 mb-3">Featured</h2>
        <div className="overflow-x-auto pb-2 hide-scrollbar">
          <div className="flex gap-4">
            {nfts.map((nft, index) => (
              <div key={`${nft.contract}-${nft.tokenId}`} className="flex-shrink-0 w-[180px]">
                <NFTCard
                  nft={nft}
                  onPlay={async (played) => {
                    await onPlayNFT(played, {
                      queue: nfts,
                      queueType: 'featured',
                    });
                  }}
                  isPlaying={Boolean(
                    isPlaying && (
                      currentlyPlaying === `${nft.contract}-${nft.tokenId}` ||
                      currentlyPlaying === getMediaKey(nft)
                    )
                  )}
                  currentlyPlaying={currentlyPlaying}
                  handlePlayPause={handlePlayPause}
                  onLikeToggle={() => onLikeToggle(nft)}
                  userFid={userFid}
                  isNFTLiked={() => isNFTLiked(nft)}
                  animationDelay={0.2 + (index * 0.05)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default FeaturedSection;