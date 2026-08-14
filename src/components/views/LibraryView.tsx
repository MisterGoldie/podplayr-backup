'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { NFT, UserContext } from '../../types/user';
import { NFTImage } from '../media/NFTImage';
import { NFTCard } from '../nft/NFTCard';
import { getMediaKey } from '~/utils/media';
import NotificationHeader from '../NotificationHeader';
import NFTNotification from '../NFTNotification';
import { PAGE_SIZE, usePagedItems } from '../../hooks/usePagedItems';
import { useNFTLike } from '../../hooks/useNFTLike';

function getNftLikedTime(nft: NFT): number {
  if (typeof nft.likedTimestamp === 'number' && Number.isFinite(nft.likedTimestamp) && nft.likedTimestamp > 0) {
    return nft.likedTimestamp;
  }

  const ts = nft.timestamp as { toMillis?: () => number; seconds?: number } | number | string | undefined;
  if (ts && typeof ts === 'object' && typeof ts.toMillis === 'function') {
    return ts.toMillis();
  }
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    return ts;
  }
  if (ts && typeof ts === 'object' && typeof ts.seconds === 'number') {
    return ts.seconds * 1000;
  }
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof nft.likedAt === 'string') {
    const parsed = Date.parse(nft.likedAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function getUniqueLikedNFTs(likedNFTs: NFT[]) {
  const uniqueNFTs: NFT[] = [];
  const seenMediaKeys = new Set<string>();
  const seenContractTokenIds = new Set<string>();

  for (const nft of likedNFTs) {
    if (!nft) continue;
    const mediaKey = getMediaKey(nft);
    if (!seenMediaKeys.has(mediaKey)) {
      seenMediaKeys.add(mediaKey);
      uniqueNFTs.push(nft);
      continue;
    }
    if (nft.contract && nft.tokenId) {
      const contractTokenKey = `${nft.contract.toLowerCase()}-${nft.tokenId}`;
      if (!seenContractTokenIds.has(contractTokenKey)) {
        seenContractTokenIds.add(contractTokenKey);
        uniqueNFTs.push(nft);
      }
    }
  }

  return uniqueNFTs;
}

interface LibraryViewProps {
  likedNFTs: NFT[];
  isPlaying: boolean;
  currentlyPlaying: string | null;
  currentPlayingNFT: NFT | null;
  handlePlayAudio: (nft: NFT, context?: { queue?: NFT[]; queueType?: string }) => Promise<void>;
  handlePlayPause: () => void;
  onReset: () => void;
  userContext: UserContext;
  setIsLiked: (isLiked: boolean) => void;
  setIsPlayerVisible: (visible: boolean) => void;
  setIsPlayerMinimized: (minimized: boolean) => void;
  onLikeToggle: (nft: NFT) => Promise<void>;
  isLoading?: boolean;
}

interface SimpleNFTCardProps {
  nft: NFT;
  onPlay: (nft: NFT) => Promise<void>;
  handlePlayPause: () => void;
  isPlaying: boolean;
  currentlyPlaying: string | null;
  onLikeToggle: (nft: NFT) => Promise<void>;
  animationDelay?: number;
}

const SimpleNFTCard: React.FC<SimpleNFTCardProps> = ({
  nft,
  onPlay,
  handlePlayPause,
  isPlaying,
  currentlyPlaying,
  onLikeToggle,
  animationDelay,
}) => {
  const { handleUnlike } = useNFTLike({ onLikeToggle });
  const [hasEntered, setHasEntered] = useState(false);
  const enterStyle = animationDelay ? { animationDelay: `${animationDelay}s` } : undefined;
  const isCurrentTrack = currentlyPlaying === getMediaKey(nft);

  useEffect(() => {
    const delayMs = (animationDelay || 0) * 1000 + 500;
    const timer = window.setTimeout(() => setHasEntered(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [animationDelay]);

  return (
    <div
      className={`rounded-2xl p-3 flex items-center gap-3 border touch-manipulation ${
        isCurrentTrack
          ? 'bg-purple-500/15 border-purple-400/40'
          : 'bg-black/40 border-purple-400/15'
      }${hasEntered ? '' : ' nft-card-enter'}`}
      style={hasEntered ? undefined : enterStyle}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setHasEntered(true);
      }}
    >
      <button
        type="button"
        onClick={() => (isCurrentTrack ? handlePlayPause() : onPlay(nft))}
        className="flex items-center gap-3 min-w-0 flex-1 text-left active:scale-[0.99]"
      >
        <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0 bg-purple-900/30">
          <NFTImage
            src={nft.metadata?.image || ''}
            alt={nft.name}
            className="w-full h-full object-cover"
            width={48}
            height={48}
            sizes="48px"
            quality={50}
            priority
            nft={nft}
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-white truncate">{nft.name}</h3>
          {isCurrentTrack && (
            <p className="text-[11px] text-purple-300">{isPlaying ? 'Playing' : 'Paused'}</p>
          )}
        </div>
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void handleUnlike(nft);
        }}
        className="text-red-400 p-1.5 active:scale-95 touch-manipulation"
        aria-label="Remove from library"
      >
        <svg xmlns="http://www.w3.org/2000/svg" height="22" viewBox="0 -960 960 960" width="22" fill="currentColor">
          <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Z"/>
        </svg>
      </button>

      <button
        type="button"
        onClick={() => (isCurrentTrack ? handlePlayPause() : onPlay(nft))}
        className="text-purple-300 p-1.5 active:scale-95 touch-manipulation"
        aria-label={isCurrentTrack && isPlaying ? 'Pause' : 'Play'}
      >
        {isCurrentTrack && isPlaying ? (
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
            <path d="M320-640v320h80V-640h-80Zm240 0v320h80V-640h-80Z"/>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
            <path d="M320-200v-560l440 280-440 280Z"/>
          </svg>
        )}
      </button>
    </div>
  );
};

interface LibraryNFTFeedProps {
  nfts: NFT[];
  viewMode: 'grid' | 'list';
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
  resetKey: string;
  isPlaying: boolean;
  currentlyPlaying: string | null;
  handlePlayPause: () => void;
  handlePlayAudio: (nft: NFT, context?: { queue?: NFT[]; queueType?: string }) => Promise<void>;
  onLikeToggle: (nft: NFT) => Promise<void>;
}

const LibraryNFTFeed: React.FC<LibraryNFTFeedProps> = ({
  nfts,
  viewMode,
  scrollRootRef,
  resetKey,
  isPlaying,
  currentlyPlaying,
  handlePlayPause,
  handlePlayAudio,
  onLikeToggle,
}) => {
  const { visibleItems: visibleNFTs, hasMore, sentinelRef } = usePagedItems(nfts, {
    pageSize: PAGE_SIZE,
    resetKey,
    scrollRootRef,
  });

  return (
    <>
      <div
        className={`px-4 pb-16 ${viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4' : 'space-y-3'}`}
      >
        {visibleNFTs.map((nft, index) => {
          const uniqueKey = nft.contract && nft.tokenId
            ? `library-${nft.contract}-${nft.tokenId}-${index}`
            : `library-${getMediaKey(nft)}-${index}`;
          const staggerDelay = 0.05 * (index % 8);
          const playNft = async (played: NFT) => {
            handlePlayAudio(played, { queue: nfts, queueType: 'library' });
          };

          if (viewMode === 'grid') {
            return (
              <NFTCard
                key={uniqueKey}
                nft={nft}
                onPlay={playNft}
                isPlaying={isPlaying}
                currentlyPlaying={currentlyPlaying}
                handlePlayPause={handlePlayPause}
                onLikeToggle={onLikeToggle}
                isNFTLiked={() => true}
                animationDelay={staggerDelay}
              />
            );
          }

          return (
            <SimpleNFTCard
              key={uniqueKey}
              nft={nft}
              onPlay={playNft}
              handlePlayPause={handlePlayPause}
              isPlaying={isPlaying}
              currentlyPlaying={currentlyPlaying}
              onLikeToggle={onLikeToggle}
              animationDelay={staggerDelay}
            />
          );
        })}
      </div>
      {hasMore && <div ref={sentinelRef} className="h-8" aria-hidden="true" />}
    </>
  );
};

const LibraryView: React.FC<LibraryViewProps> = ({
  likedNFTs,
  isPlaying,
  currentlyPlaying,
  currentPlayingNFT,
  handlePlayAudio,
  handlePlayPause,
  onReset,
  userContext,
  setIsLiked,
  onLikeToggle,
  isLoading = false,
}) => {
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchFilter, setSearchFilter] = useState('');
  const [filterSort, setFilterSort] = useState<'recent' | 'name'>('recent');

  const uniqueNFTs = useMemo(() => getUniqueLikedNFTs(likedNFTs), [likedNFTs]);

  const filteredNFTs = useMemo(() => {
    const query = searchFilter.trim().toLowerCase();
    return uniqueNFTs
      .filter((nft) => !query || (nft.name || '').toLowerCase().includes(query))
      .sort((a, b) => {
        if (filterSort === 'name') return (a.name || '').localeCompare(b.name || '');
        return getNftLikedTime(b) - getNftLikedTime(a);
      });
  }, [uniqueNFTs, searchFilter, filterSort]);

  useEffect(() => {
    if (!currentPlayingNFT || !userContext?.user?.fid) return;
    const currentMediaKey = getMediaKey(currentPlayingNFT);
    setIsLiked(uniqueNFTs.some((nft) => getMediaKey(nft) === currentMediaKey));
  }, [currentPlayingNFT, uniqueNFTs, userContext?.user?.fid, setIsLiked]);

  const hasFid = Boolean(userContext?.user?.fid);

  return (
    <>
      <NotificationHeader show={false} message="" onReset={onReset} />
      <NFTNotification onReset={onReset} />

      <div
        ref={scrollRootRef}
        className="space-y-5 pt-20 pb-40 overflow-y-auto overscroll-y-contain min-h-screen bg-gradient-to-b from-[#1E1525] via-[#2D1B69] to-[#4B0082] h-[calc(100vh-130px)] md:h-[calc(100vh-150px)]"
      >
        <div className="px-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Library</h2>
            <p className="text-sm text-white/50 mt-0.5">
              {uniqueNFTs.length} {uniqueNFTs.length === 1 ? 'liked NFT' : 'liked NFTs'}
            </p>
          </div>
          <div className="flex rounded-full bg-black/40 border border-purple-400/20 p-1">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-full touch-manipulation ${
                viewMode === 'grid' ? 'bg-purple-500 text-white' : 'text-white/50'
              }`}
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
                <path d="M120-520v-320h320v320H120Zm0 400v-320h320v320H120Zm400-400v-320h320v320H520Zm0 400v-320h320v320H520ZM200-600h160v-160H200v160Zm400 0h160v-160H600v160Zm0 400h160v-160H600v160Zm-400 0h160v-160H200v160Z"/>
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-full touch-manipulation ${
                viewMode === 'list' ? 'bg-purple-500 text-white' : 'text-white/50'
              }`}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
                <path d="M120-240v-80h720v80H120Zm0-200v-80h720v80H120Zm0-200v-80h720v80H120Z"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="px-4">
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-300/70 pointer-events-none">
              <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor" aria-hidden="true">
                <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z"/>
              </svg>
            </span>
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search liked NFTs"
              className="w-full pl-11 pr-10 py-3 bg-black/40 border border-purple-400/30 rounded-full text-white placeholder-white/40 focus:outline-none focus:border-purple-400 text-base"
              autoComplete="off"
            />
            {searchFilter && (
              <button
                type="button"
                onClick={() => setSearchFilter('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 p-1 touch-manipulation"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex gap-2 mt-3">
            {([
              ['recent', 'Recently liked'],
              ['name', 'Name'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilterSort(id)}
                className={`px-3 py-1.5 rounded-full text-sm touch-manipulation ${
                  filterSort === id
                    ? 'bg-purple-500 text-white'
                    : 'bg-black/40 text-white/60 border border-purple-400/20'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col justify-center items-center py-12 space-y-3">
            <div className="w-10 h-10 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
            <p className="text-sm text-purple-200">Loading your library…</p>
          </div>
        ) : uniqueNFTs.length === 0 ? (
          <div className="text-center py-16 px-6">
            <p className="text-lg text-white mb-2">Your library is empty</p>
            <p className="text-sm text-white/50">
              {!hasFid
                ? 'Sign in on Farcaster or Base to save liked NFTs here.'
                : 'Like a track and it will show up here.'}
            </p>
          </div>
        ) : filteredNFTs.length === 0 ? (
          <div className="text-center py-16 px-6">
            <p className="text-lg text-white mb-2">No matches</p>
            <p className="text-sm text-white/50">Nothing in your library matches “{searchFilter}”.</p>
          </div>
        ) : (
          <LibraryNFTFeed
            nfts={filteredNFTs}
            viewMode={viewMode}
            scrollRootRef={scrollRootRef}
            resetKey={`${searchFilter}|${filterSort}|${viewMode}`}
            isPlaying={isPlaying}
            currentlyPlaying={currentlyPlaying}
            handlePlayPause={handlePlayPause}
            handlePlayAudio={handlePlayAudio}
            onLikeToggle={onLikeToggle}
          />
        )}
      </div>
    </>
  );
};

export default LibraryView;
