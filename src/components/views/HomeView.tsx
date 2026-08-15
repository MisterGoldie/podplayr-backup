'use client';

import React, { useContext, useEffect } from 'react';
import { NFTCard } from '../nft/NFTCard';
import type { NFT } from '~/types/nft';
import FeaturedSection from '../sections/FeaturedSection';
import RecentlyPlayed from '../RecentlyPlayed';
import { getMediaKey } from '../../utils/media';
import NotificationHeader from '../NotificationHeader';
import NFTNotification from '../NFTNotification';
import { logger } from '~/utils/logger';
import { UserFidContext } from '~/app/providers';

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
  onReset: () => void;
  onLikeToggle: (nft: NFT) => Promise<void>;
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
  onReset,
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
        const { ensureFeaturedNFTsExist } = await import('../../lib/firebase');
        const { FEATURED_NFTS } = await import('../sections/FeaturedSection');
        await ensureFeaturedNFTsExist(FEATURED_NFTS);
        featuredNFTsInitialized = true;
      } catch (error) {
        homeLogger.error('Error initializing featured NFTs:', error);
      }
    };

    void initializeFeaturedNFTs();
  }, []);

  const checkDirectlyLiked = (nftToCheck: NFT): boolean => {
    if (!nftToCheck) return false;
    const mediaKey = nftToCheck.mediaKey || getMediaKey(nftToCheck);

    if (mediaKey) {
      const mediaKeyMatch = likedNFTs.some((likedNFT) => {
        const likedMediaKey = likedNFT.mediaKey || getMediaKey(likedNFT);
        return likedMediaKey === mediaKey;
      });
      if (mediaKeyMatch) return true;
    }

    if (nftToCheck.contract && nftToCheck.tokenId) {
      const nftKey = `${nftToCheck.contract}-${nftToCheck.tokenId}`.toLowerCase();
      return likedNFTs.some((likedNFT) =>
        likedNFT.contract && likedNFT.tokenId &&
        `${likedNFT.contract}-${likedNFT.tokenId}`.toLowerCase() === nftKey
      );
    }

    return false;
  };

  if (isLoading) {
    return (
      <>
        <NotificationHeader show={false} message="" onReset={onReset} />
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
      <NotificationHeader show={false} message="" onReset={onReset} />
      <NFTNotification onReset={onReset} />

      <div className="page-scroll space-y-6 pt-20 pb-40 bg-gradient-to-b from-[#1E1525] via-[#2D1B69] to-[#4B0082]">
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
