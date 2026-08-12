'use client';

import React, { useState, useEffect } from 'react';
// Change from:
// import { useFarcasterContext } from '~/contexts/FarcasterContext';
// To:
import { useFarcasterContext } from '~/app/providers';
import type { NFT } from '~/types/nft';
import { preloadAudio } from '~/utils/audioPreloader';
import { NFTCard } from '../nft/NFTCard';
import { formatPlayCount } from '~/utils/format';

// Hardcoded featured NFTs
export const FEATURED_NFTS: NFT[] = [
  {
    name: 'Seasoning with Sazón - COD Zombies Terminus EP1',
    image: 'https://arweave.net/HvZ4oE2mDf6G1o1rX9Y_lkqegYA_0ZsRyY1JxQpL2v0',
    contract: '0x27430c3ef4b04f7d223df7f280ae8fc0b3a407b7',
    tokenId: '50dc9fb449e0', // Already in correct format
    audio: 'https://arweave.net/noYvGupxQyo2P7C2GMNNUseml29HEN6HLyvXOBD7jYQ',
    metadata: {
      animation_url: 'https://arweave.net/noYvGupxQyo2P7C2GMNNUseml29HEN6HLyvXOBD7jYQ',
      description: 'Seasoning with Sazón, Call of Duty Black Ops 6 - Zombies - Terminus Episode 1 of 5 | @themrsazon',
      attributes: [
        {"trait_type":"Game","value":"Call of Duty Black Ops 6"},
        {"trait_type":"Map","value":"Terminus"}
      ]
    }
  },
  {
    name: 'I Found It',
    image: 'https://arweave.net/Wvad7CgtidFMH3mOBjRHOeV5_bKvvAR9zZH2BhQSl7M',
    contract: '0x27430c3ef4b04f7d223df7f280ae8fc0b3a407b7',
    tokenId: '50dc9fb449e1',
    audio: 'https://arweave.net/qsVEbTD0FUZ8VebK4yxOrKWDQtW8BpNWj7o46HzKsV8',
    metadata: {
      animation_url: 'https://arweave.net/qsVEbTD0FUZ8VebK4yxOrKWDQtW8BpNWj7o46HzKsV8',
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
    audio: 'https://arweave.net/YV3PQYn-NAX3cC6t6yhlmMtSzZ_SxIcAb3Np6SKBCuQ',
    metadata: {
      animation_url: 'https://arweave.net/YV3PQYn-NAX3cC6t6yhlmMtSzZ_SxIcAb3Np6SKBCuQ',
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
    audio: 'https://arweave.net/FXMkBkgV79p3QIL8589uh68-sKuXbmuBzQwvWH10v74',
    metadata: {
      animation_url: 'https://arweave.net/FXMkBkgV79p3QIL8589uh68-sKuXbmuBzQwvWH10v74',
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
    audio: 'https://arweave.net/GujXDFCEk4FmJl9b_TlofLEmx_YnY_LRSB2aSY8AcRg',
    metadata: {
      animation_url: 'https://arweave.net/GujXDFCEk4FmJl9b_TlofLEmx_YnY_LRSB2aSY8AcRg',
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
    audio: 'https://arweave.net/Df6hOV1--hsJBtTL1cEbhBkRZuggxSpR9eM0DXsdcv0',
    metadata: {
      animation_url: 'https://arweave.net/Df6hOV1--hsJBtTL1cEbhBkRZuggxSpR9eM0DXsdcv0',
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
    audio: 'https://arweave.net/KPKrKgdACqggYesQqRCR4MeLWDlpR6i16xL-Q_e35q4',
    metadata: {
      animation_url: 'https://arweave.net/KPKrKgdACqggYesQqRCR4MeLWDlpR6i16xL-Q_e35q4',
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
  // Remove the useFarcasterContext hook since we're using userFid prop
  // const { isFarcaster, fid } = useFarcasterContext();
  const [preloaded, setPreloaded] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const preloadFeaturedContent = async () => {
      if (!isMounted) return;
      console.log('🎵 Starting to preload featured NFTs...');
      
      try {
        for (const nft of nfts) {
          if (!isMounted) return;
          try {
            const audioUrl = nft.audio || nft.metadata?.animation_url;
            if (audioUrl) {
              await preloadAudio(audioUrl);
            }
          } catch (error) {
            console.warn(`Failed to preload NFT ${nft.name || nft.tokenId}:`, error);
          }
        }
        if (isMounted) {
          console.log('✨ All featured NFTs preloaded!');
          setPreloaded(true);
        }
      } catch (error) {
        console.warn('Failed to preload some featured NFTs:', error);
        if (isMounted) {
          setPreloaded(true);
        }
      }
    };

    if (!preloaded) {
      preloadFeaturedContent();
    }

    return () => {
      isMounted = false;
    };
  }, [nfts]); // Only depend on nfts array, not preloaded state

  return (
    <section className="w-full py-4">
      <div className="container mx-auto px-4">
        <div className="mb-6">
          <h2 className="text-xl font-mono text-green-400 mb-4">Featured NFTs</h2>
        </div>
        
        <div className="relative">
          <div className="overflow-x-auto pb-4 hide-scrollbar">
            <div className="flex gap-6">
              {nfts.map((nft, index) => (
                <div key={nft.contract + '-' + nft.tokenId} className="flex-shrink-0 w-[200px]">
                  <NFTCard
                    nft={nft}
                    onPlay={async (nft) => {
                      // Fix: Pass queue context when playing from Featured section
                      await onPlayNFT(nft, {
                        queue: nfts,
                        queueType: 'featured'
                      });
                    }}
                    isPlaying={isPlaying && currentlyPlaying === nft.contract + '-' + nft.tokenId}
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
      </div>
    </section>
  );
};

export default FeaturedSection;

// Remove these lines (216-224):
// useEffect(() => {
//   // Preload first 2 immediately
//   const priorityNFTs = nfts.slice(0, 2);
//   priorityNFTs.forEach(nft => preloadAudio(nft.audio));
//   
//   // Preload rest after 2 seconds
//   setTimeout(() => {
//     const remainingNFTs = nfts.slice(2);
//     remainingNFTs.forEach(nft => preloadAudio(nft.audio));
//   }, 2000);
// }, [nfts]);