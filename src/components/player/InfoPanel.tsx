import React, { useState, useEffect } from 'react';
import { useNFTPlayCount } from '../../hooks/useNFTPlayCount';
import { useNFTLikes } from '../../hooks/useNFTLikes';
import { useNFTTopPlayed } from '../../hooks/useNFTTopPlayed';
import type { NFT } from '../../types/user';
import { getMediaKey } from '../../utils/media';
import { getNftExplorerLinks } from '../../utils/nftExplorerLinks';
import sdk from '@farcaster/miniapp-sdk';

interface InfoPanelProps {
  nft: NFT;
  onClose: () => void;
  /** Current user's like state from the player (same source as the heart button). */
  isLiked?: boolean;
}

const InfoPanel: React.FC<InfoPanelProps> = ({ nft, onClose, isLiked = false }) => {
  const { playCount, loading, realCountIncrease } = useNFTPlayCount(nft);
  const { likesCount, isLoading: likesLoading } = useNFTLikes(nft);
  const { hasBeenInTopPlayed, loading: topPlayedLoading } = useNFTTopPlayed(nft);
  const explorerLinks = getNftExplorerLinks(nft);
  const [isClosing, setIsClosing] = useState(false);

  // State to track animation of play count
  const [isPlayCountAnimating, setIsPlayCountAnimating] = useState(false);
  
  // Trigger animation only when a real Firebase count increase happens (25% threshold)
  useEffect(() => {
    if (realCountIncrease) {
      // Real play count increase from Firebase - trigger animation
      setIsPlayCountAnimating(true);
      
      // Reset animation after it completes
      const timer = setTimeout(() => {
        setIsPlayCountAnimating(false);
      }, 1500); // Animation duration (slightly longer than the CSS animation)
      
      return () => clearTimeout(timer);
    }
  }, [realCountIncrease]);

  // Handle closing animation
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 300); // Match this to the animation duration
  };

  // Reset closing state when component mounts
  useEffect(() => {
    setIsClosing(false);
  }, [nft]);

  return (
    <div className="fixed inset-0 z-[101] flex items-center justify-center px-4 pointer-events-none">
      {/* Backdrop overlay with fade animation */}
      <div 
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto ${
          isClosing ? 'animate-fade-out' : 'animate-fade-in'
        }`}
        onClick={handleClose}
      ></div>
      
      {/* Info panel with slide-up animation */}
      <div 
        className={`relative bg-gray-900/95 backdrop-blur-lg rounded-xl p-5 shadow-2xl border border-purple-400/30 w-full max-w-sm pointer-events-auto ${
          isClosing ? 'animate-slide-down' : 'animate-slide-up'
        }`}
      >
        {/* Enhanced Header */}
        <div className="flex items-start gap-3 mb-4">
          <div className="w-12 h-12 rounded-lg overflow-hidden border border-purple-400/30 flex-shrink-0">
            <img 
              src={nft.image || nft.metadata?.image || '/default-nft.png'} 
              alt={nft.name}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-purple-300 font-mono text-base font-semibold truncate">{nft.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <div 
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-all duration-300 ${isPlayCountAnimating ? 'animate-count-updated' : 'bg-purple-500/10'}`}
                data-media-key={nft.mediaKey || getMediaKey(nft)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="14" viewBox="0 -960 960 960" width="14" fill="#4ADE80" className="text-green-400">
                  <path d="M320-200v-560l440 280-440 280Z"/>
                </svg>
                <span className={`text-purple-300 text-xs font-mono ${isPlayCountAnimating ? 'animate-text-count-updated' : ''}`}>
                  {loading ? '...' : `${playCount} plays`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 ${isLiked ? 'bg-purple-500/20' : 'bg-purple-500/10'} px-2 py-0.5 rounded-full`}>
                  {isLiked ? (
                    <svg xmlns="http://www.w3.org/2000/svg" height="14" viewBox="0 -960 960 960" width="14" fill="red" className="text-red-500" data-media-key={nft.mediaKey || getMediaKey(nft)} data-liked="true">
                      <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Z"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" height="14" viewBox="0 -960 960 960" width="14" fill="currentColor" className="text-purple-400" data-media-key={nft.mediaKey || getMediaKey(nft)} data-liked="false">
                      <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Zm0-108q96-86 158-147.5t98-107q36-45.5 50-81t14-70.5q0-60-40-100t-100-40q-47 0-87 26.5T518-680h-76q-15-41-55-67.5T300-774q-60 0-100 40t-40 100q0 35 14 70.5t50 81q36 45.5 98 107T480-228Zm0-273Z"/>
                    </svg>
                  )}
                  <span className="text-purple-300 text-xs font-mono">
                    {likesLoading ? '...' : `${likesCount} likes`}
                  </span>
                </div>
                {!topPlayedLoading && hasBeenInTopPlayed && (
                  <div className="flex items-center gap-1.5 bg-purple-500/10 px-2 py-0.5 rounded-full">
                    <svg xmlns="http://www.w3.org/2000/svg" height="14" viewBox="0 -960 960 960" width="14" fill="#FFD700" className="text-yellow-400">
                      <path d="m233-80 65-281L80-550l288-25 112-265 112 265 288 25-218 189 65 281-247-149L233-80Z"/>
                    </svg>
                    <span className="text-purple-300 text-xs font-mono">Top Played</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <button 
            onClick={handleClose}
            className="text-gray-400 hover:text-purple-300 active:scale-95 transition-all p-3 -mr-3 touch-manipulation rounded-full bg-black/20 backdrop-blur-sm"
            style={{ touchAction: 'manipulation' }}
            aria-label="Close info panel"
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
              <path d="M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z"/>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div 
          className="space-y-4 max-h-[50vh] overflow-y-auto overscroll-contain will-change-scroll pr-2"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(168, 85, 247, 0.4) rgba(0, 0, 0, 0.2)',
            WebkitOverflowScrolling: 'touch',
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden'
          }}
        >
          {/* Description */}
          {(nft.description || nft.metadata?.description) && (
            <div className="bg-black/30 rounded-lg p-3 border border-purple-400/10">
              <h3 className="text-purple-300 font-mono text-xs uppercase tracking-wider mb-2">Description</h3>
              <p className="text-gray-300 text-sm leading-relaxed break-words">{nft.description || nft.metadata?.description}</p>
            </div>
          )}

          {/* Properties */}
          {nft.metadata?.properties && Object.keys(nft.metadata.properties).length > 0 && (
            <div className="bg-black/30 rounded-lg p-3 border border-purple-400/10">
              <h3 className="text-purple-300 font-mono text-xs uppercase tracking-wider mb-3">Properties</h3>
              <div className="space-y-2">
                {Object.entries(nft.metadata.properties).map(([key, value]) => (
                  <div key={key} className="flex justify-between items-center">
                    <span className="text-purple-400 text-xs font-mono capitalize">{key}</span>
                    <span className="text-gray-300 text-xs">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className="bg-black/30 rounded-lg p-3 border border-purple-400/10">
            <h3 className="text-purple-300 font-mono text-xs uppercase tracking-wider mb-3">Quick Actions</h3>
            {!explorerLinks.valid ? (
              <p className="text-gray-500 text-xs font-mono">Contract or token ID missing for this NFT.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {explorerLinks.explorerUrl && (
                  <button
                    onClick={() => handleOpenUrl(explorerLinks.explorerUrl!)}
                    className="flex-1 min-w-[7.5rem] bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-xs font-mono py-2 px-3 rounded-md transition-colors border border-purple-400/20"
                  >
                    View on {explorerLinks.explorerName}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Contract and Token ID */}
          <div className="bg-black/30 rounded-lg p-3 border border-purple-400/10 overflow-hidden space-y-3">
            {/* Contract */}
            <div>
              <h3 className="text-purple-300 font-mono text-xs uppercase tracking-wider mb-2">Contract</h3>
              <div className="flex items-center gap-2">
                <p className="text-gray-300 text-sm font-mono break-all">{nft.contract}</p>
                <button 
                  className="text-purple-400 hover:text-purple-300 transition-colors"
                  onClick={() => navigator.clipboard.writeText(nft.contract)}
                  title="Copy to clipboard"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 -960 960 960" width="16" fill="currentColor">
                    <path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/>
                  </svg>
                </button>
              </div>
            </div>
            {/* Token ID */}
            <div>
              <h3 className="text-purple-300 font-mono text-xs uppercase tracking-wider mb-2">Token ID</h3>
              <div className="flex items-center gap-2">
                <p className="text-gray-300 text-sm font-mono break-all">{nft.tokenId}</p>
                <button 
                  className="text-purple-400 hover:text-purple-300 transition-colors"
                  onClick={() => navigator.clipboard.writeText(nft.tokenId || '')}
                  title="Copy to clipboard"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 -960 960 960" width="16" fill="currentColor">
                    <path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InfoPanel;

const handleOpenUrl = async (url: string) => {
  try {
    // Check if we're in a Farcaster mini-app environment
    const isInMiniApp = await sdk.isInMiniApp();
    
    if (isInMiniApp) {
      // Use Farcaster SDK to open URL
      await sdk.actions.openUrl(url);
    } else {
      // Fallback to regular window.open for web environment
      window.open(url, '_blank');
    }
  } catch (error) {
    console.error('Error opening URL:', error);
    // Fallback to window.open if SDK fails
    window.open(url, '_blank');
  }
};