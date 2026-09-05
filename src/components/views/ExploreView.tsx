'use client';

import React, { useState, useEffect, useMemo, useContext } from 'react';
import { SearchBar } from '../search/SearchBar';
import Image from 'next/image';
import { FarcasterUser, SearchedUser, FollowedUser } from '../../types/user';
import { trackUserSearch, searchUsers, getPopularSearchedUsers } from '../../lib/firebase/user';
import { toggleFollowUser, getFollowingUsers } from '../../lib/firebase/follows';
import { UserFidContext } from '../../app/providers';
import { PAGE_SIZE, usePagedItems } from '../../hooks/usePagedItems';
import {
  ACYL_FIDS,
  POD_MEMBER_FIDS,
  PODPLAYR_OFFICIAL_FID,
  isAcylMember,
  isOfficialAccount,
  isPodMember,
  officialAccountDisplayName,
} from '../../constants/community';
import { getBioText } from '../../utils/format';
import { SUGGESTED_MUSIC_VIDEOS } from '../../data/suggestedMusicVideos';
import { getMediaKey } from '../../utils/media';
import type { NFT } from '../../types/nft';
import ProfileAvatar from '../user/ProfileAvatar';
import { CommunityPills } from '../user/CommunityPills';

type ExploreFilter = 'all' | 'farcaster' | 'ens';

interface ExploreViewProps {
  onSearch: (query: string) => void;
  isPlaying: boolean;
  searchResults: FarcasterUser[];
  isSearching: boolean;
  recentSearches: SearchedUser[];
  handleDirectUserSelect: (user: FarcasterUser) => void;
  userFid?: number;
  onPlayNFT?: (nft: NFT, context?: { queue?: NFT[]; queueType?: string }) => Promise<void>;
  currentlyPlaying?: string | null;
}

function toFarcasterUser(user: FarcasterUser | SearchedUser | FollowedUser): FarcasterUser {
  return {
    fid: user.fid,
    username: user.username,
    display_name: officialAccountDisplayName(user.fid, user.display_name) || user.username,
    pfp_url: user.pfp_url,
    follower_count: 'follower_count' in user ? user.follower_count || 0 : 0,
    following_count: 'following_count' in user ? user.following_count || 0 : 0,
    isENS: 'isENS' in user ? Boolean(user.isENS) : false,
    profile: 'profile' in user ? user.profile : undefined,
  };
}

function getIsEns(user: FarcasterUser | SearchedUser | FollowedUser) {
  return Boolean((user as { isENS?: boolean }).isENS);
}

function getBio(user: FarcasterUser | SearchedUser) {
  return 'profile' in user ? getBioText(user.profile?.bio) : '';
}

function matchesFilter(user: FarcasterUser | SearchedUser | FollowedUser, filter: ExploreFilter) {
  if (filter === 'ens') return getIsEns(user);
  if (filter === 'farcaster') return !getIsEns(user);
  return true;
}

function formatCount(value?: number) {
  if (!value) return '';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
}

const FEATURED_FIDS = new Set([...POD_MEMBER_FIDS, PODPLAYR_OFFICIAL_FID, ...ACYL_FIDS]);
const EXPLORE_CACHE_MS = 5 * 60 * 1000;
let featuredUsersCache: { users: FarcasterUser[]; at: number } | null = null;
let popularUsersCache: { users: SearchedUser[]; at: number } | null = null;

const ExploreView: React.FC<ExploreViewProps> = (props) => {
  const { fid: contextFid } = useContext(UserFidContext);
  const effectiveUserFid = props.userFid || contextFid || 0;

  const {
    onSearch,
    searchResults,
    isSearching,
    recentSearches,
    handleDirectUserSelect,
    onPlayNFT,
    currentlyPlaying,
    isPlaying,
  } = props;

  const [followedUsers, setFollowedUsers] = useState<Record<number, boolean>>({});
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [filter, setFilter] = useState<ExploreFilter>('all');
  const [featuredUsers, setFeaturedUsers] = useState<FarcasterUser[]>(
    () => featuredUsersCache?.users ?? []
  );
  const [popularUsers, setPopularUsers] = useState<SearchedUser[]>(
    () => popularUsersCache?.users ?? []
  );
  const [following, setFollowing] = useState<FollowedUser[]>([]);

  const { visibleItems: visibleSearchResults, hasMore: hasMoreSearch, sentinelRef: searchSentinelRef } = usePagedItems(searchResults, {
    pageSize: PAGE_SIZE,
    resetKey: searchResults.map((user) => user.fid).join(','),
    scrollRoot,
  });

  useEffect(() => {
    if (featuredUsersCache && Date.now() - featuredUsersCache.at < EXPLORE_CACHE_MS) {
      setFeaturedUsers(featuredUsersCache.users);
      return;
    }
    let cancelled = false;
    const ids = [...FEATURED_FIDS];
    searchUsers(`fid:${ids.join(',')}`)
      .then((users) => {
        const next = users || [];
        featuredUsersCache = { users: next, at: Date.now() };
        if (!cancelled) setFeaturedUsers(next);
      })
      .catch(() => {
        if (!cancelled) setFeaturedUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (popularUsersCache && Date.now() - popularUsersCache.at < EXPLORE_CACHE_MS) {
      setPopularUsers(popularUsersCache.users);
      return;
    }
    let cancelled = false;
    getPopularSearchedUsers(12)
      .then((users) => {
        popularUsersCache = { users, at: Date.now() };
        if (!cancelled) setPopularUsers(users);
      })
      .catch(() => {
        if (!cancelled) setPopularUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!effectiveUserFid) {
      setFollowing([]);
      setFollowedUsers({});
      return;
    }
    let cancelled = false;
    getFollowingUsers(effectiveUserFid)
      .then((users) => {
        if (cancelled) return;
        setFollowing(users);
        const next: Record<number, boolean> = {};
        users.forEach((user) => {
          next[user.fid] = true;
        });
        setFollowedUsers(next);
      })
      .catch(() => {
        if (!cancelled) {
          setFollowing([]);
          setFollowedUsers({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveUserFid]);

  const handleFollowToggle = async (user: FarcasterUser, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!effectiveUserFid || !user.fid || effectiveUserFid === user.fid) return;

    try {
      const isNowFollowed = await toggleFollowUser(effectiveUserFid, user);
      setFollowedUsers((prev) => ({ ...prev, [user.fid]: isNowFollowed }));
      if (isNowFollowed) {
        setFollowing((prev) => (prev.some((item) => item.fid === user.fid) ? prev : [{
          fid: user.fid,
          username: user.username,
          display_name: user.display_name,
          pfp_url: user.pfp_url,
          timestamp: new Date(),
        }, ...prev]));
      } else {
        setFollowing((prev) => prev.filter((item) => item.fid !== user.fid));
      }
    } catch {
      // Follow toggle is best-effort
    }
  };

  const openUser = (user: FarcasterUser | SearchedUser) => {
    if (effectiveUserFid && !user.isENS) {
      void trackUserSearch(user.username, effectiveUserFid).catch(() => {
        // Tracking is best-effort
      });
    }
    handleDirectUserSelect(toFarcasterUser(user));
  };

  const officialUser = useMemo(
    () => featuredUsers.find((user) => isOfficialAccount(user.fid)),
    [featuredUsers]
  );
  const podUsers = useMemo(
    () => featuredUsers.filter((user) => isPodMember(user.fid)),
    [featuredUsers]
  );
  const acylUsers = useMemo(
    () => featuredUsers.filter((user) => isAcylMember(user.fid)),
    [featuredUsers]
  );
  const filteredFollowing = useMemo(
    () => following.filter((user) => matchesFilter(user, filter)),
    [following, filter]
  );
  const circleOverlap = useMemo(
    () => following.filter((user) => isPodMember(user.fid) || isAcylMember(user.fid) || isOfficialAccount(user.fid)),
    [following]
  );
  const filteredRecent = useMemo(
    () => recentSearches.filter((user) => matchesFilter(user, filter)).slice(0, 12),
    [recentSearches, filter]
  );
  const ensRecent = useMemo(
    () => recentSearches.filter((user) => user.isENS).slice(0, 8),
    [recentSearches]
  );
  const filteredPopular = useMemo(
    () => popularUsers
      .filter((user) => matchesFilter(user, filter) && !FEATURED_FIDS.has(user.fid))
      .slice(0, 12),
    [popularUsers, filter]
  );

  const showDiscovery = searchResults.length === 0 && !isSearching;

  const renderBadges = (user: { fid: number; isENS?: boolean }) => (
    <CommunityPills
      fid={user.fid}
      isEns={user.isENS}
      isFollowing={Boolean(followedUsers[user.fid])}
      className="mt-1"
    />
  );

  const renderAvatar = (user: { fid: number; username?: string; display_name?: string; pfp_url?: string; isENS?: boolean }, size = 56) => (
    <ProfileAvatar
      src={user.pfp_url || (user.isENS ? '/defaultens.png' : undefined)}
      alt={officialAccountDisplayName(user.fid, user.display_name) || user.username || 'User'}
      size={size}
      className="flex-shrink-0 ring-2 ring-purple-400/25"
      fallback={user.isENS ? '/defaultens.png' : '/default-avatar.png'}
    />
  );

  const renderFollowButton = (user: FarcasterUser) => {
    if (!effectiveUserFid || effectiveUserFid === user.fid) return null;
    const isFollowed = Boolean(followedUsers[user.fid]);
    return (
      <button
        type="button"
        onClick={(e) => handleFollowToggle(user, e)}
        className={`absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center shadow-lg border-2 active:scale-95 touch-manipulation ${
          isFollowed
            ? 'bg-green-600 border-green-400/30'
            : 'bg-purple-600 border-purple-400/30'
        }`}
        aria-label={isFollowed ? 'Unfollow' : 'Follow'}
      >
        {isFollowed ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
        )}
      </button>
    );
  };

  const renderPersonCard = (user: FarcasterUser | SearchedUser, key: string) => {
    const followerLabel = formatCount(user.follower_count);
    const bio = getBio(user);
    return (
      <div
        key={key}
        className="w-full rounded-2xl bg-black/40 border border-purple-400/15 p-3 flex items-center gap-3"
      >
        <div className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => openUser(user)}
            className="block rounded-full active:scale-95 touch-manipulation"
            aria-label={`Open ${officialAccountDisplayName(user.fid, user.display_name) || user.username}`}
          >
            {renderAvatar(user)}
          </button>
          {renderFollowButton(toFarcasterUser(user))}
        </div>
        <button
          type="button"
          onClick={() => openUser(user)}
          className="min-w-0 flex-1 text-left active:scale-[0.99] touch-manipulation"
        >
          <p className="text-white font-medium truncate">{officialAccountDisplayName(user.fid, user.display_name) || user.username}</p>
          <p className={`text-sm truncate ${user.isENS ? 'text-blue-300' : 'text-white/50'}`}>
            {user.isENS ? user.username : `@${user.username}`}
            {followerLabel ? ` · ${followerLabel} followers` : ''}
          </p>
          {bio ? <p className="text-xs text-white/40 truncate mt-0.5">{bio}</p> : null}
          {renderBadges(user)}
        </button>
      </div>
    );
  };

  const renderRail = (title: string, users: Array<FarcasterUser | SearchedUser | FollowedUser>, empty?: string) => {
    if (users.length === 0) {
      return empty ? (
        <section>
          <h2 className="text-sm font-semibold text-white/80 mb-3 px-1">{title}</h2>
          <p className="text-sm text-white/40 px-1">{empty}</p>
        </section>
      ) : null;
    }

    return (
      <section>
        <h2 className="text-sm font-semibold text-white/80 mb-3 px-1">{title}</h2>
        <div className="flex gap-3 overflow-x-auto pt-2 pb-4 -mx-1 px-1 hide-scrollbar">
          {users.map((user) => (
            <button
              key={`${title}-${user.fid}-${user.username}`}
              type="button"
              onClick={() => openUser(toFarcasterUser(user))}
              className="flex-shrink-0 w-24 text-center active:scale-95 touch-manipulation"
            >
              <div className="relative mx-auto w-14 h-14">
                {renderAvatar(user, 56)}
                {getIsEns(user) && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/80 text-white">
                    ENS
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-white truncate">{officialAccountDisplayName(user.fid, user.display_name) || user.username}</p>
              <p className="text-[10px] text-white/40 truncate">
                {getIsEns(user) ? user.username : `@${user.username}`}
              </p>
            </button>
          ))}
        </div>
      </section>
    );
  };

  const musicVideos = useMemo(() => {
    const items = [...SUGGESTED_MUSIC_VIDEOS];
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }, []);

  const playSuggestedVideo = (nft: NFT) => {
    if (!onPlayNFT) return;
    void onPlayNFT(nft, { queue: musicVideos, queueType: 'suggested-music-videos' });
  };

  const renderMusicVideosRail = () => {
    if (musicVideos.length === 0) return null;

    return (
      <section>
        <h2 className="text-sm font-semibold text-white/80 mb-3 px-1">Music videos</h2>
        <div className="flex gap-3 overflow-x-auto pt-2 pb-4 -mx-1 px-1 hide-scrollbar">
          {musicVideos.map((nft) => {
            const isThisPlaying = Boolean(
              isPlaying &&
              currentlyPlaying &&
              (currentlyPlaying === `${nft.contract}-${nft.tokenId}` || currentlyPlaying === getMediaKey(nft))
            );
            return (
              <button
                key={`music-video-${nft.contract}-${nft.tokenId}`}
                type="button"
                onClick={() => playSuggestedVideo(nft)}
                className="flex-shrink-0 w-24 text-center active:scale-95 touch-manipulation"
                aria-label={`Play ${nft.name}`}
              >
                <div className="relative mx-auto w-14 h-14">
                  <div
                    className={`relative rounded-md overflow-hidden flex-shrink-0 ring-2 bg-purple-900/30 ${
                      isThisPlaying ? 'ring-green-400/80' : 'ring-purple-400/25'
                    }`}
                    style={{ width: 56, height: 56 }}
                  >
                    <Image
                      src={nft.image || '/default-avatar.png'}
                      alt={nft.name}
                      className="object-cover"
                      fill
                      sizes="56px"
                      unoptimized
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-white truncate">{nft.name}</p>
                <p className="text-[10px] text-white/40 truncate">
                  {nft.collection?.name || 'Music video'}
                </p>
              </button>
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <>
      <div
        ref={setScrollRoot}
        className="page-scroll space-y-7 pt-20 pb-48 bg-gradient-to-b from-[#1E1525] via-[#2D1B69] to-[#4B0082]"
      >
        <div className="px-4">
          <p className="text-white/50 text-sm mb-3 px-1 text-center">Find Farcaster and ENS listeners</p>
          <SearchBar
            onSearch={onSearch}
            isSearching={isSearching}
            handleUserSelect={handleDirectUserSelect}
          />
        </div>

        {showDiscovery && (
          <div className="px-4 flex gap-2 justify-center">
            {([
              ['all', 'All'],
              ['farcaster', 'Farcaster'],
              ['ens', 'ENS'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`px-3 py-1.5 rounded-full text-sm touch-manipulation ${
                  filter === id
                    ? 'bg-purple-500 text-white'
                    : 'bg-black/40 text-white/60 border border-purple-400/20'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {isSearching && (
          <div className="flex flex-col items-center justify-center py-12 space-y-3">
            <div className="w-10 h-10 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
            <p className="text-sm text-purple-200">Searching…</p>
          </div>
        )}

        {searchResults.length > 0 && (
          <section className="px-4 explore-enter">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white/80">Search results</h2>
              <button
                type="button"
                onClick={() => onSearch('')}
                className="text-sm text-purple-300 active:text-white touch-manipulation"
              >
                Back to explore
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {visibleSearchResults.map((user) => renderPersonCard(user, `search-${user.fid}`))}
            </div>
            {hasMoreSearch && <div ref={searchSentinelRef} className="h-8" aria-hidden="true" />}
          </section>
        )}

        {showDiscovery && (
          <div className="px-4 space-y-8 explore-stack">
            {officialUser && filter !== 'ens' && (
              <div className="w-full rounded-2xl p-4 flex items-center gap-4 border border-purple-300/25 bg-gradient-to-r from-purple-700/40 via-fuchsia-700/20 to-black/30">
                <div className="relative flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => openUser(officialUser)}
                    className="block rounded-full active:scale-95 touch-manipulation"
                    aria-label={`Open ${officialAccountDisplayName(officialUser.fid, officialUser.display_name) || officialUser.username}`}
                  >
                    {renderAvatar(officialUser, 72)}
                  </button>
                  {renderFollowButton(officialUser)}
                </div>
                <button
                  type="button"
                  onClick={() => openUser(officialUser)}
                  className="min-w-0 flex-1 text-left active:scale-[0.99] touch-manipulation"
                >
                  <p className="text-[10px] uppercase tracking-[0.18em] text-purple-200/80">PODPLAYR official account</p>
                  <p className="text-white font-semibold truncate">{officialAccountDisplayName(officialUser.fid, officialUser.display_name) || officialUser.username}</p>
                  <p className="text-sm text-white/50 truncate">
                    @{officialUser.username}
                    {officialUser.fid ? ` · fid ${officialUser.fid}` : ''}
                  </p>
                  {getBioText(officialUser.profile?.bio) ? (
                    <p className="text-xs text-white/45 mt-1 line-clamp-2">{getBioText(officialUser.profile?.bio)}</p>
                  ) : null}
                </button>
              </div>
            )}

            {filter !== 'ens' && renderMusicVideosRail()}
            {filter !== 'ens' && renderRail('THEPOD', podUsers)}
            {filter !== 'ens' && renderRail('ACYL', acylUsers)}
            {effectiveUserFid > 0 && filter !== 'ens' && circleOverlap.length > 0 && renderRail('In your circle', circleOverlap)}
            {effectiveUserFid > 0 && renderRail('People you follow', filteredFollowing, filter === 'ens' ? undefined : 'Follow someone to see them here.')}
            {effectiveUserFid > 0 && renderRail('Recently searched', filteredRecent)}
            {renderRail('Popular on PODPLAYR', filteredPopular)}
            {filter !== 'farcaster' && ensRecent.length > 0 && renderRail('ENS names', ensRecent)}
          </div>
        )}
      </div>
    </>
  );
};

export default ExploreView;
