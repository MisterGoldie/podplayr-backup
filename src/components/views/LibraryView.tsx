'use client';

import React, { useState } from 'react';
import type { NFT, UserContext } from '../../types/user';
import { NFTImage } from '../media/NFTImage';
import { getMediaKey } from '~/utils/media';
import Image from 'next/image';
import NotificationHeader from '../NotificationHeader';
import { useNFTNotification } from '../../context/NFTNotificationContext';
import NFTNotification from '../NFTNotification';
import { useNFTLike } from '../../hooks/useNFTLike';

// This component is a wrapper that uses the hook and passes it to the class component
const NotificationHandler = ({ nft, onTrigger }: { nft: NFT | null, onTrigger: () => void }) => {
  const nftNotification = useNFTNotification();
  
  React.useEffect(() => {
    if (nft) {
      console.log('🔔 NotificationHandler: Showing unlike notification for', nft.name);
      nftNotification.showNotification('unlike', nft);
      // Call the callback to reset the nft state immediately
      onTrigger();
    }
  }, [nft, nftNotification, onTrigger]);
  
  // This component doesn't render anything visible, but it's responsible for triggering notifications
  return null;
};

interface LibraryViewProps {
  likedNFTs: NFT[];
  isPlaying: boolean;
  currentlyPlaying: string | null;
  currentPlayingNFT: NFT | null;
  handlePlayAudio: (nft: NFT) => Promise<void>;
  handlePlayPause: () => void;
  onReset: () => void;
  userContext: UserContext;
  setIsLiked: (isLiked: boolean) => void;
  setIsPlayerVisible: (visible: boolean) => void;
  setIsPlayerMinimized: (minimized: boolean) => void;
  onLikeToggle: (nft: NFT) => Promise<void>;
}

interface SimpleNFTCardProps {
  nft: NFT;
  onPlay: (nft: NFT) => Promise<void>;
  isPlaying: boolean;
  currentlyPlaying: string | null;
  onLikeToggle: (nft: NFT) => Promise<void>;
  viewMode: 'grid' | 'list';
  animationDelay?: number;
  parent: LibraryView;
}

// This is a simple component that doesn't use hooks
class SimpleNFTCard extends React.Component<SimpleNFTCardProps> {
  render() {
    const { nft, onPlay, isPlaying, currentlyPlaying, onLikeToggle, viewMode, animationDelay = 0 } = this.props;
    const isCurrentTrack = currentlyPlaying === getMediaKey(nft);

    // Add animation styles
    const animationStyle = {
      opacity: 0,
      transform: 'translateY(20px)',
      animation: `fadeInUp 0.5s ease-out ${animationDelay}s forwards`
    };

    if (viewMode === 'grid') {
      return (
        <div 
          className="group relative bg-gradient-to-br from-gray-800/30 to-gray-800/10 rounded-lg overflow-hidden hover:bg-gray-800/40 active:bg-gray-800/60 transition-all duration-500 ease-in-out touch-manipulation shadow-xl shadow-purple-900/30 border border-purple-400/10 cursor-pointer"
          onClick={() => onPlay(nft)}
          style={animationStyle}
        >
          <div className="aspect-square relative">
            <NFTImage
              nft={nft}
              src={nft.image || nft.metadata?.image || ''}
              alt={nft.name || 'NFT'}
              className="w-full h-full object-cover"
              width={300}
              height={300}
            />
            
            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
            
            <button 
              onClick={(e) => {
                e.stopPropagation(); // Prevent triggering the parent onClick
                // Call the parent's handleUnlike method
                this.props.parent.handleUnlike(nft);
              }}
              className="absolute top-2 right-2 text-red-500 transition-all duration-300 hover:scale-125 z-10"
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
                <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Z"/>
              </svg>
            </button>
            
            <div className="absolute bottom-0 left-0 right-0 bg-black/50 p-2">
              <h3 className="text-white font-mono text-sm text-center truncate">{nft.name}</h3>
            </div>
          </div>
        </div>
      );
    } else {
      return (
        <div 
          className="bg-gray-800/30 rounded-lg p-3 flex items-center gap-4 group hover:bg-gray-800/50 transition-colors"
          style={animationStyle}
        >
          {/* Thumbnail */}
          <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0">
            <NFTImage 
              src={nft.metadata?.image || ''}
              alt={nft.name}
              className="w-full h-full object-cover"
              width={48}
              height={48}
              priority={true}
              nft={nft}
            />
          </div>

          {/* Track Info */}
          <div className="flex-grow min-w-0">
            <h3 className="font-mono text-purple-400 truncate">{nft.name}</h3>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {/* Like Button */}
            <button 
              onClick={(e) => {
                e.stopPropagation(); // Prevent triggering the parent onClick
                // Call the parent's handleUnlike method
                this.props.parent.handleUnlike(nft);
              }}
              className="text-red-500 hover:scale-110 transition-transform"
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
                <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Z"/>
              </svg>
            </button>

            {/* Play Button */}
            <button 
              onClick={() => onPlay(nft)}
              className="text-purple-400 hover:scale-110 transition-transform"
            >
            {isCurrentTrack && isPlaying ? (
              <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                <path d="M320-640v320h80V-640h-80Zm240 0v320h80V-640h-80Z"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                <path d="M320-200v-560l440 280-440 280Z"/>
              </svg>
            )}
          </button>
          </div>
        </div>
      );
    }
  }
}

// Main LibraryView component as a class component
class LibraryView extends React.Component<LibraryViewProps> {
  // State for the component including notification handling
  state = {
    viewMode: 'grid' as 'grid' | 'list',
    searchFilter: '',
    filterSort: 'recent' as 'recent' | 'name',
    isLoading: true, // Add loading state, initially true
    nftToNotify: null as NFT | null // Track the NFT that needs a notification
  };

  componentDidMount() {
    console.log('🔄 LibraryView mounting - NFT count:', this.props.likedNFTs.length);
    
    // Immediately check if we already have liked NFTs and render them
    if (this.props.likedNFTs.length > 0) {
      console.log('✅ LibraryView has liked NFTs on mount, immediately rendering');
      this.setState({ isLoading: false });
      // Force a refresh of the component
      this.forceUpdate();
    } else {
      console.log('⏳ No liked NFTs available yet, showing loading state');
      // Set a short timeout to finish loading
      setTimeout(() => {
        console.log('⌛ Loading timeout complete - NFT count now:', this.props.likedNFTs.length);
        this.setState({ isLoading: false });
        // Force a refresh to ensure NFTs are displayed
        this.forceUpdate();
      }, 1000);
    }
  }

  componentDidUpdate(prevProps: LibraryViewProps) {
    // If likedNFTs changes, force a complete refresh
    if (prevProps.likedNFTs !== this.props.likedNFTs) {
      console.log('🔄 LibraryView detected likedNFTs change - refreshing view');
      // Force a refresh of the component
      this.forceUpdate();
    }

    // Update liked status for currently playing NFT
    if (this.props.currentPlayingNFT !== prevProps.currentPlayingNFT && 
        this.props.currentPlayingNFT && 
        this.props.userContext?.user?.fid) {
      const currentMediaKey = getMediaKey(this.props.currentPlayingNFT);
      const isNFTLiked = this.props.likedNFTs.some(nft => getMediaKey(nft) === currentMediaKey);
      this.props.setIsLiked(isNFTLiked);
    }
  }

  // Deduplicate NFTs based on mediaKey as the primary identifier
  // with fallback to contract-tokenId
  getUniqueNFTs() {
    // Log the number of liked NFTs for debugging
    console.log(`📊 Processing ${this.props.likedNFTs.length} liked NFTs in getUniqueNFTs`); 
    
    const uniqueNFTs: NFT[] = [];
    const seenMediaKeys = new Set<string>();
    const seenContractTokenIds = new Set<string>();
    
    for (const nft of this.props.likedNFTs) {
      // Skip invalid NFTs
      if (!nft) continue;
      
      // Get the mediaKey for this NFT
      const mediaKey = getMediaKey(nft);
      
      // First try to deduplicate by mediaKey (primary identifier)
      if (!seenMediaKeys.has(mediaKey)) {
        seenMediaKeys.add(mediaKey);
        uniqueNFTs.push(nft);
      }
      // Fallback to contract-tokenId if available
      else if (nft.contract && nft.tokenId) {
        const contractTokenKey = `${nft.contract.toLowerCase()}-${nft.tokenId}`;
        if (!seenContractTokenIds.has(contractTokenKey)) {
          seenContractTokenIds.add(contractTokenKey);
          uniqueNFTs.push(nft);
        }
      }
    }
    
    console.log(`✅ Returning ${uniqueNFTs.length} unique NFTs after deduplication`);
    return uniqueNFTs;
  }

  getFilteredNFTs() {
    const uniqueNFTs = this.getUniqueNFTs();
    const { searchFilter, filterSort } = this.state;

    return uniqueNFTs
      .filter(nft => 
        nft.name.toLowerCase().includes(searchFilter.toLowerCase())
      )
      .sort((a, b) => {
        switch (filterSort) {
          case 'name':
            return a.name.localeCompare(b.name);
          case 'recent':
            return -1; // Keep most recent first
          default:
            return 0;
        }
      });
  }

  handleUnlike = async (nft: NFT) => {
    try {
      // Set the NFT that needs a notification
      // The NotificationHandler component will pick this up and show the notification
      this.setState({ nftToNotify: nft });
      
      // Call the original onLikeToggle function
      await this.props.onLikeToggle(nft);
      
      // Force a re-render after the unlike operation
      this.forceUpdate();
    } catch (error) {
      console.error('Error unliking NFT:', error);
    }
  };
  
  // Reset the NFT to notify after the notification has been triggered
  resetNftToNotify = () => {
    this.setState({ nftToNotify: null });
  };

  render() {
    const { 
      handlePlayAudio, 
      currentlyPlaying, 
      isPlaying, 
      onReset, 
      userContext, 
      onLikeToggle 
    } = this.props;
    
    const { viewMode, searchFilter, filterSort, isLoading } = this.state;
    const uniqueNFTs = this.getUniqueNFTs();
    const filteredNFTs = this.getFilteredNFTs();

    // Add the keyframes style to the component
    const animationKeyframes = `
      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `;

    // Use the useNFTLike hook through a wrapper component
    const LikeHandler = () => {
      const { handleUnlike } = useNFTLike({
        onLikeToggle: this.props.onLikeToggle,
        setIsLiked: this.props.setIsLiked
      });

      // Store the handleUnlike function in the instance
      (this as any).handleUnlike = handleUnlike;

      return null;
    };

    return (
      <>
        <style>{animationKeyframes}</style>

        {/* Add NFTNotification component to ensure notifications work in LibraryView */}
        <NFTNotification onReset={onReset} />
        
        {/* Add the NotificationHandler component to handle unlike notifications */}
        <NotificationHandler 
          nft={this.state.nftToNotify} 
          onTrigger={this.resetNftToNotify} 
        />
        
        {/* Add NFTNotification component for consistent notification behavior */}
        <NFTNotification onReset={this.props.onReset} />

        <div 
          className="space-y-8 pt-20 pb-12 min-h-screen overflow-y-auto"
          style={{
            WebkitOverflowScrolling: 'touch',
            height: 'calc(100vh - 4rem)', // Subtract header height
            overscrollBehavior: 'contain',
            position: 'fixed',
            top: '0',
            left: '0',
            right: '0',
            bottom: '0'
          }}
        >
          {/* Header and Filters */}
          <div className="flex justify-between items-center px-4">
            <div>
              <h2 className="text-base font-semibold text-purple-400">Your Library</h2>
              <p className="text-xs text-gray-400 mt-0.5 font-mono">{uniqueNFTs.length} NFTs</p>
            </div>
            <div className="flex items-center gap-4">
              {/* View Toggle */}
              <div className="flex gap-2">
                <button
                  onClick={() => this.setState({ viewMode: 'grid' })}
                  className={`p-2 rounded ${
                    viewMode === 'grid' ? 'bg-purple-400 text-black' : 'text-gray-400'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
                    <path d="M120-520v-320h320v320H120Zm0 400v-320h320v320H120Zm400-400v-320h320v320H520Zm0 400v-320h320v320H520ZM200-600h160v-160H200v160Zm400 0h160v-160H600v160Zm0 400h160v-160H600v160Zm-400 0h160v-160H200v160Z"/>
                  </svg>
                </button>
                <button
                  onClick={() => this.setState({ viewMode: 'list' })}
                  className={`p-2 rounded ${
                    viewMode === 'list' ? 'bg-purple-400 text-black' : 'text-gray-400'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
                    <path d="M120-240v-80h720v80H120Zm0-200v-80h720v80H120Zm0-200v-80h720v80H120Z"/>
                  </svg>
                </button>
              </div>

              {/* Sort Options */}
              <select
                value={filterSort}
                onChange={(e) => this.setState({ filterSort: e.target.value as 'recent' | 'name' })}
                className="bg-gray-800/50 text-purple-400 rounded-lg px-3 py-2 font-mono text-sm border border-purple-400/20 focus:outline-none focus:border-purple-400"
              >
                <option value="recent">Recently Added</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>

          {/* Search Filter */}
          <div className="relative px-4">
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => this.setState({ searchFilter: e.target.value })}
              placeholder="Search NFTs..."
              className="w-full px-4 py-3 bg-gray-800/50 border border-purple-400/20 rounded-lg text-purple-400 placeholder-purple-400/50 focus:outline-none focus:border-purple-400 font-mono text-sm"
            />
            <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor" 
              className="absolute right-8 top-1/2 transform -translate-y-1/2 text-purple-400/50">
              <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z"/>
            </svg>
          </div>

          {/* Content */}
          {isLoading ? (
            <div className="flex flex-col justify-center items-center py-12 space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-400 border-t-transparent"></div>
              <p className="text-purple-400 font-mono text-sm">Loading your library...</p>
            </div>
          ) : uniqueNFTs.length === 0 ? (
            <div className="text-center py-12">
              <h3 className="text-xl text-purple-400 mb-2">Your Library is Empty</h3>
              <p className="text-gray-400">
                {!userContext?.user?.fid
                  ? 'Must be logged in to view your library'
                  : 'Like some media NFTs to add them to your library.'
                }
              </p>
            </div>
          ) : (
            <div 
              className={`px-4 pb-32 ${viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4' : 'space-y-4'}`}
            >
              {filteredNFTs.map((nft, index) => {
                const uniqueKey = nft.contract && nft.tokenId 
                  ? `library-${nft.contract}-${nft.tokenId}-${index}` 
                  : `library-${index}-${Math.random().toString(36).substr(2, 9)}`;
                
                // Calculate a staggered delay based on index
                // This creates a wave-like appearance as cards animate in
                const staggerDelay = 0.05 * (index % 8); // Reset every 8 items to keep delays reasonable
                
                return (
                  <SimpleNFTCard
                    key={uniqueKey}
                    nft={nft}
                    onPlay={handlePlayAudio}
                    isPlaying={isPlaying}
                    currentlyPlaying={currentlyPlaying}
                    onLikeToggle={onLikeToggle}
                    viewMode={viewMode}
                    animationDelay={staggerDelay}
                    parent={this}
                  />
                );
              })}
            </div>
          )}
        </div>
      </>
    );
  }
}

export default LibraryView;