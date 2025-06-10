import React from 'react';
import { useFarcasterContext } from '~/contexts/FarcasterContext';
import { NFT } from '~/types/nft';
import { useNFTLikeState } from '~/hooks/useNFTLikeState';
import { useNFTPlayCount } from '~/hooks/useNFTPlayCount';
import { useNFTPreloader } from '~/hooks/useNFTPreloader';
import { formatPlayCount } from '~/utils/format';

interface NFTCardProps {
  nft: NFT;
  onPlay?: (nft: NFT) => Promise<void>;
  isPlaying?: boolean;
  currentlyPlaying?: string | null;
  handlePlayPause?: () => void;
  onLikeToggle?: () => Promise<void>;
  userFid?: string;
  isNFTLiked?: () => boolean;
  playCountBadge?: string;
  animationDelay?: number;
}

export const NFTCard: React.FC<NFTCardProps> = ({ 
  nft,
  onPlay,
  isPlaying,
  currentlyPlaying,
  handlePlayPause,
  onLikeToggle,
  userFid,
  isNFTLiked,
  playCountBadge,
  animationDelay
}) => {
  const { isFarcaster, fid } = useFarcasterContext();
  const { isLiked, likesCount, toggleLike } = useNFTLikeState(nft, fid);
  const { playCount, loading: playCountLoading } = useNFTPlayCount(nft);
  const { getPreloadedImage } = useNFTPreloader([nft]);

  const handleLike = async () => {
    if (!fid) return;
    if (onLikeToggle) {
      await onLikeToggle();
    } else {
      await toggleLike();
    }
  };

  const handlePlay = () => {
    if (onPlay) {
      onPlay(nft);
    } else {
      console.log('Playing NFT:', nft.contract + '-' + nft.tokenId);
    }
  };

  const imageUrl = nft.image || nft.metadata?.image || '/default-nft.png';

  return (
    <div className="relative group">
      <div className="aspect-square rounded-lg overflow-hidden bg-gray-800/20 shadow-lg">
        <img
          src={imageUrl}
          alt={nft.name}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
        
        <button 
          onClick={handlePlay}
          className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-purple-500 text-black flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:scale-105 transform"
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
            <path d="M320-200v-560l440 280-440 280Z"/>
          </svg>
        </button>

        {fid && (
          <button 
            onClick={handleLike}
            className="absolute top-2 right-2 w-10 h-10 flex items-center justify-center text-red-500 transition-all duration-300 hover:scale-125 z-10"
          >
            {isLiked ? (
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
      
      <div className="mt-2">
        <h3 className="font-medium text-white text-sm truncate">{nft.name}</h3>
        <div className="flex items-center gap-2 text-gray-400 text-xs">
          <span>{formatPlayCount(playCount)} plays</span>
          {likesCount > 0 && <span>• {likesCount} likes</span>}
        </div>
      </div>
    </div>
  );
};