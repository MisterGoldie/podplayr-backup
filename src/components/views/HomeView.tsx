'use client';

import React, { useContext, useEffect } from 'react';
import { NFTCard } from '../nft/NFTCard';
import type { NFT } from '~/types/nft';
import FeaturedSection, { FEATURED_NFTS } from '../sections/FeaturedSection';
import RecentlyPlayed from '../RecentlyPlayed';
import { getMediaKey } from '../../utils/media';
import { sameLikedTrack } from '../../utils/likeDedupe';
import { logger } from '~/utils/logger';
import { UserFidContext } from '~/app/providers';
import { LiveStreamFrame } from '../live/LiveStreamFrame';

const homeLogger = logger.getModuleLogger('homeView');

let featuredNFTsInitialized = false;

interface HomeViewProps {
  recentlyPlayedNFTs?: NFT[];
  topPlayedNFTs: { nft: NFT; count: number }[];
  topPlayedLoading?: boolean;
  onPlayNFT: (nft: NFT, context?: { queue?: NFT[], queueType?: string }) => Promise<void>;
  currentlyPlaying: string | null;
  isPlaying: boolean;
  handlePlayPause: () => void;
  isLoading?: boolean;
  onLikeToggle: (nft: NFT) => Promise<boolean | void>;
  likedNFTs: NFT[];
  currentPlayingNFT?: NFT | null;
  recentlyAddedNFT?: React.MutableRefObject<string | null>;
}

const HomeView: React.FC<HomeViewProps> = ({
  topPlayedNFTs,
  topPlayedLoading = false,
  onPlayNFT,
  currentlyPlaying,
  isPlaying,
  handlePlayPause,
  isLoading = false,
  onLikeToggle,
  likedNFTs,
  currentPlayingNFT,
  recentlyAddedNFT,
}) => {
  const { fid, isFidReady } = useContext(UserFidContext);

  useEffect(() => {
    const initializeFeaturedNFTs = async () => {
      if (featuredNFTsInitialized) return;

      try {
        const { ensureFeaturedNFTsExist } = await import('../../lib/firebase/nfts');
        await ensureFeaturedNFTsExist(FEATURED_NFTS);
        featuredNFTsInitialized = true;
      } catch (error) {
        homeLogger.error('Error initializing featured NFTs:', error);
      }
    };

    let idleId: number | undefined;
    let timer: number | undefined;
    if (typeof requestIdleCallback === 'function') {
      idleId = requestIdleCallback(() => {
        void initializeFeaturedNFTs();
      }, { timeout: 4000 });
    } else {
      timer = window.setTimeout(() => {
        void initializeFeaturedNFTs();
      }, 2000);
    }
    return () => {
      if (idleId !== undefined) cancelIdleCallback(idleId);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const checkDirectlyLiked = (nftToCheck: NFT): boolean => {
    if (!nftToCheck) return false;
    return likedNFTs.some((likedNFT) => sameLikedTrack(likedNFT, nftToCheck));
  };

  if (isLoading) {
    return (
      <>
        <div className="page-scroll space-y-8 animate-pulse pt-20 px-4 bg-gradient-to-b from-[#1E1525] via-[#2D1B69] to-[#4B0082]">
          <div className="h-6 w-40 bg-purple-900/40 rounded" />
          <div className="flex gap-4 overflow-hidden">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="w-[160px] aspect-square bg-purple-900/30 rounded-2xl flex-shrink-0" />
            ))}
          </div>
          <div className="h-6 w-32 bg-purple-900/40 rounded" />
          <div className="flex gap-4 overflow-hidden">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="w-[160px] aspect-square bg-purple-900/30 rounded-2xl flex-shrink-0" />
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-scroll space-y-6 pt-20 pb-40 bg-gradient-to-b from-[#1E1525] via-[#2D1B69] to-[#4B0082]">
        <div className="px-4">
          <LiveStreamFrame />
        </div>
        {!isFidReady ? (
          <section className="w-full">
            <div className="container mx-auto px-4">
              <h2 className="text-lg font-semibold text-white/90 mb-3">Recently played</h2>
              <div className="flex gap-4 overflow-hidden">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="w-[180px] aspect-square bg-purple-900/30 rounded-2xl flex-shrink-0 animate-pulse" />
                ))}
              </div>
            </div>
          </section>
        ) : (
          <RecentlyPlayed
            userFid={fid}
            onPlayNFT={onPlayNFT}
            currentlyPlaying={currentlyPlaying}
            isPlaying={isPlaying}
            handlePlayPause={handlePlayPause}
            onLikeToggle={onLikeToggle}
            isNFTLiked={checkDirectlyLiked}
            currentPlayingNFT={currentPlayingNFT}
            recentlyAddedNFT={recentlyAddedNFT}
          />
        )}

        {topPlayedLoading ? (
          <section className="w-full">
            <div className="container mx-auto px-4">
              <h2 className="text-lg font-semibold text-white/90 mb-3">Top played</h2>
              <div className="flex gap-4 overflow-hidden">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="w-[180px] aspect-square bg-purple-900/30 rounded-2xl flex-shrink-0 animate-pulse" />
                ))}
              </div>
            </div>
          </section>
        ) : topPlayedNFTs.length > 0 ? (
          <section className="w-full">
            <div className="container mx-auto px-4">
              <h2 className="text-lg font-semibold text-white/90 mb-3">Top played</h2>
              <div className="overflow-x-auto pb-2 hide-scrollbar">
                <div className="flex gap-4">
                  {topPlayedNFTs.map(({ nft }, index) => {
                    const uniqueKey = nft.contract && nft.tokenId
                      ? `top-${nft.contract}-${nft.tokenId}-${index}`
                      : `top-${getMediaKey(nft)}-${index}`;

                    return (
                      <div key={uniqueKey} className="flex-shrink-0 w-[180px]">
                        <NFTCard
                          nft={nft}
                          onPlay={async (played) => {
                            try {
                              await onPlayNFT(played, {
                                queue: topPlayedNFTs.map((item) => item.nft),
                                queueType: 'topPlayed',
                              });
                            } catch (error) {
                              homeLogger.error('Error playing NFT from Top Played:', error);
                            }
                          }}
                          isPlaying={currentlyPlaying === `${nft.contract}-${nft.tokenId}` || currentlyPlaying === getMediaKey(nft)}
                          currentlyPlaying={currentlyPlaying}
                          handlePlayPause={handlePlayPause}
                          onLikeToggle={onLikeToggle}
                          userFid={(fid ?? 0).toString()}
                          isNFTLiked={() => checkDirectlyLiked(nft)}
                          animationDelay={index * 0.1}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <FeaturedSection
          onPlayNFT={onPlayNFT}
          handlePlayPause={handlePlayPause}
          currentlyPlaying={currentlyPlaying}
          isPlaying={isPlaying}
          onLikeToggle={onLikeToggle}
          isNFTLiked={checkDirectlyLiked}
          userFid={(fid ?? 0).toString()}
        />
      </div>
    </>
  );
};

export default HomeView;
