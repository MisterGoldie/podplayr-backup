'use client';

import React, { useState, useEffect, useContext } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { FarcasterContext } from '../../app/providers';
import { NFTImage } from '../media/NFTImage';
import { NFTGifImage } from '../media/NFTGifImage';
import type { NFT } from '../../types/user';
import { getMediaKey, extractIPFSHash, IPFS_GATEWAYS, processMediaUrl } from '../../utils/media';
import { preloadAudio } from '../../utils/audioPreloader';

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
    contract: '0x79428737e60a8a8db494229638eaa5e52874b6fb',
    tokenId: '79428737ea',
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
    image: 'https://bafybeie7mejoxle27ki56vxmzebb67kcrttu54stlin74xowaq5ugu3sdi.ipfs.w3s.link/COMPRESSEDWILL%20RADIO%20-min.gif',
    contract: '0x79428737e60a8a8db494229638eaa5e52874b6fb',
    tokenId: '79428737e6',
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
    image: 'https://bafybeibvxzzzzitvejioqkhfpic5rjixrffgkr4jw46bidxnmdgbfvjynu.ipfs.w3s.link/COMPRESSED.gif',
    contract: '0x79428737e60a8a8db494229638eaa5e52874b6fb',
    tokenId: '79428737e8',
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
    contract: '0x79428737e60a8a8db494229638eaa5e52874b6fb',
    tokenId: '79428737e7',
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
    contract: '0x79428737e60a8a8db494229638eaa5e52874b6fb',
    tokenId: '79428737e9',
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
  onPlayNFT: (nft: NFT, context?: { queue?: NFT[], queueType?: string }) => void;
  handlePlayPause: () => void;
  currentlyPlaying: string | null;
  isPlaying: boolean;
  onLikeToggle: (nft: NFT) => Promise<void>;
  isNFTLiked: (nft: NFT) => boolean;
  userFid?: string;
}

const FeaturedSection: React.FC<FeaturedSectionProps> = ({
  onPlayNFT,
  handlePlayPause,
  currentlyPlaying,
  isPlaying,
  onLikeToggle,
  isNFTLiked,
  userFid
}) => {
  // Get authentication state directly from contexts
  const farcasterContext = useContext(FarcasterContext);
  const { authenticated: privyAuthenticated } = usePrivy();
  
  // User is authenticated if they have a Farcaster FID or are logged in with Privy
  const isUserAuthenticated = Boolean(
    (userFid && parseInt(String(userFid)) > 0) || 
    (farcasterContext?.fid ?? 0) > 0 || 
    privyAuthenticated
  );
  // Preloading state
  const [preloaded, setPreloaded] = useState(false); // Set to false to enable preloading

  // Disable preloading for now to fix the error
  useEffect(() => {
    if (preloaded) return;

    const preloadFeaturedContent = async () => {
      console.log('🎵 Starting to preload featured NFTs...');
      
      try {
        // Load featured NFTs one by one to avoid overwhelming the browser
        // This is more reliable than trying to load them all in parallel
        for (const nft of FEATURED_NFTS) {
          try {
            await preloadAudio(nft, 'high');
          } catch (error) {
            // Log but continue with next NFT
            console.warn(`Failed to preload NFT ${nft.name || nft.tokenId}:`, error);
          }
        }
        console.log('✨ All featured NFTs preloaded!');
        setPreloaded(true);
      } catch (error) {
        console.warn('Failed to preload some featured NFTs:', error);
        // Still mark as preloaded to avoid repeated attempts
        setPreloaded(true);
      }
    };

    preloadFeaturedContent();
  }, [preloaded]); // Only run if not yet preloaded

  return (
    <div className="mb-8">
      <h2 className="text-xl font-mono text-green-400 mb-6">Featured</h2>
      <div className="relative">
        <div className="overflow-x-auto pb-4 hide-scrollbar">
          <div className="flex gap-6">
            {FEATURED_NFTS.map((nft, index) => {
              // Generate a guaranteed unique key that doesn't rely on media content
              const uniqueKey = nft.contract && nft.tokenId 
                ? `featured-${nft.contract}-${nft.tokenId}-${index}` 
                : `featured-${index}-${Math.random().toString(36).substr(2, 9)}`;
              
              return (
                <div key={uniqueKey} className="flex-shrink-0 w-[200px] group">
                  <div className="relative aspect-square rounded-lg overflow-hidden mb-3 bg-gray-800/20 shadow-purple-500/20 shadow-lg transition-all">
                    {/* Special handling for GIF images */}
                    {(nft.name === 'Salem Tries - The Forest EP1' || 
                      nft.name === 'ACYL RADIO - WILL01' || 
                      nft.name === 'ACYL RADIO - Chili Sounds 🌶️') ? (
                      <NFTGifImage
                        nft={nft}
                        className="w-full h-full"
                        width={200}
                        height={200}
                      />
                    ) : (
                      <NFTImage
                        src={nft.image}
                        alt={nft.name}
                        width={200}
                        height={200}
                        className="w-full h-full object-cover"
                        priority={index === 0}
                        loading="eager"
                      />
                    )}
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                    <button 
                      onClick={() => onPlayNFT(nft, { 
                        queue: FEATURED_NFTS,
                        queueType: 'featured'
                      })}
                      className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-purple-500 text-black flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:scale-105 transform"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                        <path d="M320-200v-560l440 280-440 280Z"/>
                      </svg>
                    </button>
                    {/* Show like button for any authenticated user */}
                    {isUserAuthenticated && onLikeToggle && (
                      <button 
                        onClick={() => onLikeToggle(nft)}
                        className="absolute top-2 right-2 w-10 h-10 flex items-center justify-center text-red-500 transition-all duration-300 hover:scale-125 z-10"
                      >
                        {isNFTLiked(nft) ? (
                          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
                            <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Z"/>
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor" className="text-white hover:text-red-500">
                            <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Zm0-108q96-86 158-147.5t98-107q36-45.5 50-81t14-70.5q0-60-40-100t-100-40q-47 0-87 26.5T518-680h-76q-15-41-55-67.5T300-774q-60 0-100 40t-40 100q0 35 14 70.5t50 81q36 45.5 98 107T480-228Zm0-273Z"/>
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
                  <h3 className="font-mono text-white text-sm truncate mb-1">{nft.name}</h3>
                  {/* Completely hide media elements with inline style and aria-hidden for accessibility */}
                  <video
                    id={`video-${nft.contract}-${nft.tokenId}`}
                    src={nft.metadata?.animation_url ? processMediaUrl(nft.metadata.animation_url) : undefined}
                    className="hidden"
                    style={{ display: 'none', width: 0, height: 0, position: 'absolute', visibility: 'hidden' }}
                    preload="none"
                    playsInline
                    muted
                    loop
                    aria-hidden="true"
                  />
                  <audio
                    id={`audio-${nft.contract}-${nft.tokenId}`}
                    src={nft.audio ? processMediaUrl(nft.audio) : undefined}
                    preload="none"
                    style={{ display: 'none', width: 0, height: 0, position: 'absolute', visibility: 'hidden' }}
                    aria-hidden="true"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeaturedSection;