'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { useNFTPlayCount } from '../../hooks/useNFTPlayCount';
import { useNFTLikeState } from '../../hooks/useNFTLikeState';
import { useNFTTopPlayed } from '../../hooks/useNFTTopPlayed';
import type { NFT } from '../../types/user';
import { getMediaKey } from '../../utils/media';
import {
  getNftExplorerLinks,
  normalizeContractAddress,
  normalizeNftChain,
  toDecimalTokenId,
} from '../../utils/nftExplorerLinks';
import { getMusicVideoArtist } from '../../data/musicVideoArtists';
import { getArtistProfilePreview } from '../../lib/artistProfile';
import { NFTImage } from '../media/NFTImage';
import { useNftLikers, type NftLiker } from '../../hooks/useNftLikers';
import ProfileAvatar from '../user/ProfileAvatar';

interface InfoPanelProps {
  nft: NFT;
  onClose: () => void;
  /** Current user's like state from the player (same source as the heart button). */
  isLiked?: boolean;
  /** Open the mapped artist's Farcaster profile. */
  onOpenArtistProfile?: (fid: number) => void;
}

const SKIPPED_PROPERTY_KEYS = new Set([
  'files',
  'soundContent',
  'visual',
  'audio',
  'audio_url',
  'audio_file',
  'image',
  'animation_url',
  'video',
  'mimeType',
]);

const DESCRIPTION_CLAMP_CHARS = 160;

function truncateAddress(address: string): string {
  if (!address) return '';
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function isSimpleValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function likerLabel(liker: NftLiker): string {
  if (liker.isCurrentUser) return 'you';
  if (liker.username) return `@${liker.username}`;
  if (liker.displayName) return liker.displayName;
  return `fid ${liker.fid}`;
}

function LikedByRow({
  likers,
  likesCount,
  onOpen,
}: {
  likers: NftLiker[];
  likesCount: number;
  onOpen?: (fid: number) => void;
}) {
  if (likers.length === 0) return null;

  const showAllNames = likesCount > 0 && likesCount <= 3 && likers.length >= Math.min(likesCount, 3);
  const named = showAllNames ? likers.slice(0, Math.min(3, likesCount || likers.length)) : likers.slice(0, 2);
  const others = showAllNames ? 0 : Math.max(0, likesCount - named.length);

  return (
    <div className="mt-3 flex items-center gap-2.5 rounded-2xl bg-black/40 border border-purple-400/15 px-3 py-2.5">
      <div className="flex -space-x-2 flex-shrink-0">
        {likers.slice(0, 3).map((liker, index) => (
          <button
            key={liker.fid}
            type="button"
            onClick={() => onOpen?.(liker.fid)}
            disabled={!onOpen}
            className="relative rounded-full ring-2 ring-gray-900 disabled:opacity-80"
            style={{ zIndex: 10 - index }}
            aria-label={likerLabel(liker)}
          >
            <ProfileAvatar src={liker.pfpUrl} alt={likerLabel(liker)} size={22} />
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-300 leading-snug min-w-0">
        <span className="text-purple-300/80">Liked by </span>
        {named.map((liker, index) => (
          <span key={liker.fid}>
            {index > 0 && (index === named.length - 1 && others === 0 ? ' and ' : ', ')}
            <button
              type="button"
              className="font-medium text-white hover:text-purple-200 disabled:hover:text-white"
              onClick={() => onOpen?.(liker.fid)}
              disabled={!onOpen}
            >
              {likerLabel(liker)}
            </button>
          </span>
        ))}
        {others > 0 && (
          <>
            {named.length > 0 ? ' and ' : ''}
            {others.toLocaleString()} other{others === 1 ? '' : 's'}
          </>
        )}
      </p>
    </div>
  );
}

const InfoPanel: React.FC<InfoPanelProps> = ({ nft, onClose, isLiked = false, onOpenArtistProfile }) => {
  const { playCount, loading, realCountIncrease } = useNFTPlayCount(nft);
  const { likesCount, isLoading: likesLoading } = useNFTLikeState(nft, null, {
    watchIsLiked: false,
    liveCount: true,
  });
  const { likers } = useNftLikers(nft, isLiked, likesCount);
  const { hasBeenInTopPlayed, loading: topPlayedLoading } = useNFTTopPlayed(nft);
  const [isClosing, setIsClosing] = useState(false);
  const [isPlayCountAnimating, setIsPlayCountAnimating] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [artistPfpUrl, setArtistPfpUrl] = useState('');
  const [artistPfpFailed, setArtistPfpFailed] = useState(false);

  const mappedArtist = useMemo(() => getMusicVideoArtist(nft), [nft]);
  const artistName = mappedArtist?.name || '';

  const imageSrc = nft.image || nft.metadata?.image || nft.collection?.image || '';
  const description = nft.description || nft.metadata?.description || '';
  const descriptionIsLong = description.length > DESCRIPTION_CLAMP_CHARS;
  const collectionName = nft.collection?.name;
  const mediaKey = getMediaKey(nft);

  const chain = normalizeNftChain(nft.network);
  const chainLabel = chain === 'ethereum' ? 'Ethereum' : chain === 'base' ? 'Base' : null;

  const explorer = useMemo(() => getNftExplorerLinks(nft), [nft]);
  const contract = normalizeContractAddress(nft.contract) || nft.contract || '';
  const tokenDisplay = toDecimalTokenId(nft.tokenId) || nft.tokenId || '';

  const attributes = useMemo(() => {
    const attrs = nft.metadata?.attributes;
    if (!Array.isArray(attrs)) return [];
    return attrs.filter(
      (attr) => attr?.trait_type && isSimpleValue(attr.value) && String(attr.value).trim() !== ''
    );
  }, [nft.metadata?.attributes]);

  const simpleProperties = useMemo(() => {
    if (attributes.length > 0) return [];
    const properties = nft.metadata?.properties;
    if (!properties || typeof properties !== 'object') return [];
    return Object.entries(properties).filter(
      ([key, value]) => !SKIPPED_PROPERTY_KEYS.has(key) && isSimpleValue(value)
    );
  }, [attributes.length, nft.metadata?.properties]);

  const showTopPlayed = !topPlayedLoading && hasBeenInTopPlayed;

  useEffect(() => {
    if (realCountIncrease) {
      setIsPlayCountAnimating(true);
      const timer = setTimeout(() => {
        setIsPlayCountAnimating(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [realCountIncrease]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  useEffect(() => {
    setIsClosing(false);
    setDescriptionExpanded(false);
    setCopied(false);
  }, [nft.contract, nft.tokenId]);

  useEffect(() => {
    setArtistPfpUrl('');
    setArtistPfpFailed(false);
    if (!mappedArtist?.fid) return;
    let cancelled = false;
    void getArtistProfilePreview(mappedArtist.fid).then((preview) => {
      if (!cancelled && preview.pfpUrl) setArtistPfpUrl(preview.pfpUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [mappedArtist?.fid]);

  const handleArtistClick = () => {
    if (!mappedArtist || !onOpenArtistProfile) return;
    onOpenArtistProfile(mappedArtist.fid);
    handleClose();
  };

  const handleCopyContract = async () => {
    if (!contract) return;
    try {
      await navigator.clipboard.writeText(contract);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-4 py-4 pointer-events-none" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <div
        className={`absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto ${
          isClosing ? 'animate-fade-out' : 'animate-fade-in'
        }`}
        onClick={handleClose}
      />

      <div
        className={`relative bg-gray-900/95 backdrop-blur-lg rounded-3xl overflow-hidden shadow-2xl shadow-purple-900/40 border border-purple-400/30 w-full max-w-sm max-h-full flex flex-col pointer-events-auto ${
          isClosing ? 'animate-slide-down' : 'animate-slide-up'
        }`}
      >
        <div className="relative h-40 bg-gray-800 flex-shrink-0">
          <NFTImage
            nft={nft}
            src={imageSrc}
            alt={nft.name}
            className="w-full h-full object-cover"
            width={400}
            height={160}
            sizes="(max-width: 420px) 100vw, 384px"
            priority
            loading="eager"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/55 to-black/10" />
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 z-10 text-white/80 hover:text-white active:scale-95 transition-all p-2 touch-manipulation rounded-full bg-black/50 backdrop-blur-sm border border-white/10"
            style={{ touchAction: 'manipulation' }}
            aria-label="Close info panel"
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
              <path d="M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11 11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z"/>
            </svg>
          </button>
        </div>

        <div
          className="px-5 pt-3 pb-5 min-h-0 flex-1 overflow-y-auto overscroll-contain"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(168, 85, 247, 0.4) rgba(0, 0, 0, 0.2)',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <h2 className="text-white text-lg font-semibold leading-snug tracking-tight line-clamp-2">
            {nft.name}
          </h2>
          <div className="mt-1.5 flex items-center gap-2 min-w-0">
            {collectionName && (
              <p className="text-purple-200/80 text-sm truncate">{collectionName}</p>
            )}
            {collectionName && chainLabel && (
              <span className="text-purple-400/50 flex-shrink-0">·</span>
            )}
            {chainLabel && (
              <span className="flex-shrink-0 text-[11px] font-medium uppercase tracking-wider text-purple-200 bg-purple-500/20 border border-purple-400/20 rounded-full px-2 py-0.5">
                {chainLabel}
              </span>
            )}
          </div>

          {mappedArtist && artistName && (
            <button
              type="button"
              onClick={handleArtistClick}
              disabled={!onOpenArtistProfile}
              className="mt-3 w-full flex items-center gap-3 rounded-2xl bg-black/40 border border-purple-400/15 px-3 py-2.5 text-left active:scale-[0.99] transition-transform disabled:active:scale-100"
              aria-label={`Open ${artistName} profile`}
            >
              <div className="relative w-10 h-10 rounded-full overflow-hidden flex-shrink-0 ring-2 ring-purple-400/30 bg-purple-900/40">
                {artistPfpUrl && !artistPfpFailed ? (
                  <Image
                    src={artistPfpUrl}
                    alt={artistName}
                    fill
                    sizes="40px"
                    className="object-cover"
                    unoptimized
                    onError={() => setArtistPfpFailed(true)}
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-sm font-medium text-purple-200">
                    {artistName.charAt(0)}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-purple-300/80">Artist</p>
                <p className="text-white text-sm font-medium truncate">{artistName}</p>
              </div>
              {onOpenArtistProfile && (
                <svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentColor" className="flex-shrink-0 text-purple-300/80">
                  <path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z" />
                </svg>
              )}
            </button>
          )}

          <div className={`mt-4 grid gap-2 ${showTopPlayed ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <div
              className={`rounded-2xl border px-3 py-2.5 text-center transition-all duration-300 ${
                isPlayCountAnimating
                  ? 'animate-count-updated border-purple-400/40'
                  : 'bg-black/40 border-purple-400/15'
              }`}
              data-media-key={mediaKey}
            >
              <p className={`text-white text-lg font-semibold tabular-nums leading-none ${isPlayCountAnimating ? 'animate-text-count-updated' : ''}`}>
                {loading ? '—' : playCount.toLocaleString()}
              </p>
              <p className="mt-1.5 text-[10px] uppercase tracking-wider text-purple-300/80">Plays</p>
            </div>
            <div
              className={`rounded-2xl border px-3 py-2.5 text-center ${
                isLiked ? 'bg-purple-500/15 border-purple-400/25' : 'bg-black/40 border-purple-400/15'
              }`}
            >
              <p className="text-white text-lg font-semibold tabular-nums leading-none flex items-center justify-center gap-1">
                {isLiked ? (
                  <svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 -960 960 960" width="16" fill="red" className="text-red-500" data-media-key={mediaKey} data-liked="true">
                    <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Z"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 -960 960 960" width="16" fill="currentColor" className="text-purple-400" data-media-key={mediaKey} data-liked="false">
                    <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Zm0-108q96-86 158-147.5t98-107q36-45.5 50-81t14-70.5q0-60-40-100t-100-40q-47 0-87 26.5T518-680h-76q-15-41-55-67.5T300-774q-60 0-100 40t-40 100q0 35 14 70.5t50 81q36 45.5 98 107T480-228Zm0-273Z"/>
                  </svg>
                )}
                <span>{likesLoading ? '—' : likesCount.toLocaleString()}</span>
              </p>
              <p className="mt-1.5 text-[10px] uppercase tracking-wider text-purple-300/80">Likes</p>
            </div>
            {showTopPlayed && (
              <div className="rounded-2xl bg-amber-500/10 border border-amber-400/25 px-3 py-2.5 text-center">
                <p className="flex justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="#FFD700" className="text-yellow-400">
                    <path d="m233-80 65-281L80-550l288-25 112-265 112 265 288 25-218 189 65 281-247-149L233-80Z"/>
                  </svg>
                </p>
                <p className="mt-1.5 text-[10px] uppercase tracking-wider text-amber-200/90">Top Played</p>
              </div>
            )}
          </div>

          <LikedByRow
            likers={likers}
            likesCount={likesCount}
            onOpen={
              onOpenArtistProfile
                ? (fid) => {
                    onOpenArtistProfile(fid);
                    handleClose();
                  }
                : undefined
            }
          />

          <div className="mt-4 space-y-4">
            {description && (
              <div>
                <p
                  className={`text-gray-300 text-sm leading-relaxed break-words ${
                    !descriptionExpanded && descriptionIsLong ? 'line-clamp-4' : ''
                  }`}
                >
                  {description}
                </p>
                {descriptionIsLong && (
                  <button
                    type="button"
                    onClick={() => setDescriptionExpanded((open) => !open)}
                    className="mt-1.5 text-purple-300 hover:text-purple-200 text-xs font-medium"
                  >
                    {descriptionExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            )}

            {attributes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attributes.map((attr) => (
                  <span
                    key={`${attr.trait_type}-${attr.value}`}
                    className="inline-flex flex-col rounded-xl bg-black/40 border border-purple-400/15 px-2.5 py-1.5 min-w-0"
                  >
                    <span className="text-[10px] uppercase tracking-wider text-purple-400/80 truncate">
                      {attr.trait_type}
                    </span>
                    <span className="text-xs text-gray-200 truncate">{String(attr.value)}</span>
                  </span>
                ))}
              </div>
            )}

            {simpleProperties.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {simpleProperties.map(([key, value]) => (
                  <span
                    key={key}
                    className="inline-flex flex-col rounded-xl bg-black/40 border border-purple-400/15 px-2.5 py-1.5 min-w-0"
                  >
                    <span className="text-[10px] uppercase tracking-wider text-purple-400/80 truncate capitalize">
                      {key}
                    </span>
                    <span className="text-xs text-gray-200 truncate">{String(value)}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="rounded-2xl bg-black/40 border border-purple-400/15 px-3 py-3 space-y-3">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <p className="text-gray-300 text-xs truncate">
                  <span className="text-gray-200">{truncateAddress(contract)}</span>
                  {tokenDisplay && (
                    <>
                      <span className="text-purple-400/50 mx-1.5">·</span>
                      <span>#{tokenDisplay}</span>
                    </>
                  )}
                </p>
                <button
                  type="button"
                  onClick={handleCopyContract}
                  className="flex-shrink-0 text-xs font-medium text-purple-300 hover:text-purple-200 transition-colors px-2 py-1 rounded-lg hover:bg-purple-500/10"
                  title="Copy contract address"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              {explorer.explorerUrl && (
                <a
                  href={explorer.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 w-full bg-purple-600/80 hover:bg-purple-500 text-white text-sm font-medium py-2 rounded-xl transition-colors"
                >
                  View on {explorer.explorerName}
                  <svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 -960 960 960" width="16" fill="currentColor">
                    <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z"/>
                  </svg>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InfoPanel;
