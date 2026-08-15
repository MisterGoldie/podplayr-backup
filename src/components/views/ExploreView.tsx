'use client';

import React, { useState, useEffect, useMemo, useContext } from 'react';
import { SearchBar } from '../search/SearchBar';
import Image from 'next/image';
import { FarcasterUser, SearchedUser, FollowedUser } from '../../types/user';
import { getDoc, doc } from 'firebase/firestore';
import { db, trackUserSearch, isUserFollowed, toggleFollowUser, getFollowingUsers } from '../../lib/firebase';
import { searchUsers, getPopularSearchedUsers } from '../../lib/firebase/user';
import { UserFidContext } from '../../app/providers';
import NotificationHeader from '../NotificationHeader';
import { useNFTNotification } from '../../context/NFTNotificationContext';
import NFTNotification from '../NFTNotification';
import { PAGE_SIZE, usePagedItems } from '../../hooks/usePagedItems';
import {
  ACYL_FIDS,
  POD_MEMBER_FIDS,
  PODPLAYR_OFFICIAL_FID,
  isAcylMember,
  isOfficialAccount,
  isPodMember,
} from '../../constants/community';
import { getBioText } from '../../utils/format';

type ExploreFilter = 'all' | 'farcaster' | 'ens';

interface ExploreViewProps {
  onSearch: (query: string) => void;
  isPlaying: boolean;
  searchResults: FarcasterUser[];
  isSearching: boolean;
  recentSearches: SearchedUser[];
  handleDirectUserSelect: (user: FarcasterUser) => void;
  onReset: () => void;
  userFid?: number;
}

function toFarcasterUser(user: FarcasterUser | SearchedUser | FollowedUser): FarcasterUser {
  return {
    fid: user.fid,
    username: user.username,
    display_name: user.display_name || user.username,
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

const ENS_FALLBACK =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzIiIGZpbGw9IiM3QzNBRUQiLz4KPHRleHQgeD0iMzIiIHk9IjM4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJ3aGl0ZSIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxNCIgZm9udC13ZWlnaHQ9ImJvbGQiPkVOUzwvdGV4dD4KPC9zdmc+';

const ExploreView: React.FC<ExploreViewProps> = (props) => {
  const { fid: contextFid } = useContext(UserFidContext);
  const effectiveUserFid = props.userFid || contextFid || 0;

  const {
    onSearch,
    searchResults,
    isSearching,
    recentSearches,
    handleDirectUserSelect,
    onReset,
  } = props;

  const [followedUsers, setFollowedUsers] = useState<Record<number, boolean>>({});
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<ExploreFilter>('all');
  const [featuredUsers, setFeaturedUsers] = useState<FarcasterUser[]>([]);
  const [featuredReady, setFeaturedReady] = useState(false);
  const [popularUsers, setPopularUsers] = useState<SearchedUser[]>([]);
  const [following, setFollowing] = useState<FollowedUser[]>([]);
  const { hideNotification } = useNFTNotification();

  const { visibleItems: visibleSearchResults, hasMore: hasMoreSearch, sentinelRef: searchSentinelRef } = usePagedItems(searchResults, {
    pageSize: PAGE_SIZE,
    resetKey: searchResults.map((user) => user.fid).join(','),
    scrollRoot,
  });

  useEffect(() => {
    let cancelled = false;
    const ids = [...FEATURED_FIDS];
    searchUsers(`fid:${ids.join(',')}`)
      .then((users) => {
        if (!cancelled) setFeaturedUsers(users || []);
      })
      .catch(() => {
        if (!cancelled) setFeaturedUsers([]);
      })
      .finally(() => {
        if (!cancelled) setFeaturedReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getPopularSearchedUsers(12)
      .then((users) => {
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
      return;
    }
    let cancelled = false;
    getFollowingUsers(effectiveUserFid)
      .then((users) => {
        if (!cancelled) setFollowing(users);
      })
      .catch(() => {
        if (!cancelled) setFollowing([]);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveUserFid]);

  useEffect(() => {
    const checkFollowStatuses = async () => {
      if (!effectiveUserFid) return;
      const pool = [...searchResults, ...recentSearches, ...featuredUsers, ...popularUsers];
      const uniqueFids = [...new Set(pool.map((user) => user.fid).filter(Boolean))];
      const next: Record<number, boolean> = {};
      await Promise.all(
        uniqueFids.map(async (fid) => {
          next[fid] = await isUserFollowed(effectiveUserFid, fid);
        })
      );
      following.forEach((user) => {
        next[user.fid] = true;
      });
      setFollowedUsers((prev) => ({ ...prev, ...next }));
    };

    void checkFollowStatuses();
  }, [effectiveUserFid, searchResults, recentSearches, featuredUsers, popularUsers, following]);

  useEffect(() => {
    return () => {
      hideNotification();
    };
  }, [hideNotification]);

  const getSafeImageUrl = (user: { username?: string; pfp_url?: string; isENS?: boolean }) => {
    if (user.isENS && !user.pfp_url) return '/defaultens.png';
    const originalUrl = user.pfp_url || (user.isENS ? '/defaultens.png' : `https://avatar.vercel.sh/${user.username}`);
    if (failedImages.has(originalUrl)) {
      return user.isENS ? ENS_FALLBACK : '/default-avatar.png';
    }
    return originalUrl;
  };

  const handleImageError = (imageUrl: string) => {
    setFailedImages((prev) => new Set([...prev, imageUrl]));
  };

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

  const openUser = async (user: FarcasterUser | SearchedUser) => {
    if (effectiveUserFid && !user.isENS) {
      try {
        await trackUserSearch(user.username, effectiveUserFid);
      } catch {
        // Tracking is best-effort
      }
    }

    if ('searchCount' in user || !('custody_address' in user)) {
      try {
        const userDoc = await getDoc(doc(db, 'searchedusers', user.fid.toString()));
        const userData = userDoc.data();
        handleDirectUserSelect({
          fid: user.fid,
          username: user.username,
          display_name: user.display_name || user.username,
          pfp_url: user.pfp_url || userData?.pfp_url || (user.isENS ? '/defaultens.png' : `https://avatar.vercel.sh/${user.username}`),
          follower_count: user.follower_count || 0,
          following_count: user.following_count || 0,
          custody_address: userData?.custody_address,
          verified_addresses: userData?.verified_addresses,
          isENS: user.isENS || userData?.isENS || false,
          profile: { bio: getBio(user) || userData?.bio || '' },
        });
        return;
      } catch {
        // Fall through to the lightweight profile
      }
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
    <div className="flex flex-wrap items-center gap-1.5 mt-1">
      {followedUsers[user.fid] && (
        <span className="text-[10px] px-2 py-0.5 bg-green-500/20 text-green-400 rounded-full">Following</span>
      )}
      {user.isENS && (
        <span className="text-[10px] px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded-full">ENS</span>
      )}
      {isPodMember(user.fid) && (
        <span className="text-[10px] px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded-full">thepod</span>
      )}
      {isOfficialAccount(user.fid) && (
        <span className="text-[10px] px-2 py-0.5 bg-purple-800/40 text-purple-200 rounded-full">Official</span>
      )}
      {isAcylMember(user.fid) && (
        <span
          className="text-[10px] px-2 py-0.5 rounded-full text-white/90"
          style={{
            background: 'linear-gradient(90deg, rgba(255,0,0,0.25) 0%, rgba(255,154,0,0.25) 40%, rgba(79,220,74,0.25) 100%)',
          }}
        >
          ACYL
        </span>
      )}
    </div>
  );

  const renderAvatar = (user: { fid: number; username?: string; display_name?: string; pfp_url?: string; isENS?: boolean }, size = 56) => (
    <div
      className="relative rounded-full overflow-hidden flex-shrink-0 ring-2 ring-purple-400/25 bg-purple-900/30"
      style={{ width: size, height: size }}
    >
      <Image
        src={getSafeImageUrl(user)}
        alt={user.display_name || user.username || 'User'}
        className="object-cover"
        fill
        sizes={`${size}px`}
        unoptimized={Boolean(user.isENS && !user.pfp_url)}
        onError={(e) => {
          handleImageError(e.currentTarget.src);
          e.currentTarget.src = user.isENS ? ENS_FALLBACK : '/default-avatar.png';
        }}
      />
    </div>
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
            aria-label={`Open ${user.display_name || user.username}`}
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
          <p className="text-white font-medium truncate">{user.display_name || user.username}</p>
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
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 hide-scrollbar">
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
              <p className="mt-2 text-xs text-white truncate">{user.display_name || user.username}</p>
              <p className="text-[10px] text-white/40 truncate">
                {getIsEns(user) ? user.username : `@${user.username}`}
              </p>
            </button>
          ))}
        </div>
      </section>
    );
  };

  return (
    <>
      <NotificationHeader show={false} message="" onReset={onReset} />
      <NFTNotification onReset={onReset} />

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

        {showDiscovery && featuredReady && (
          <div className="px-4 space-y-8 explore-stack">
            {officialUser && filter !== 'ens' && (
              <div className="w-full rounded-2xl p-4 flex items-center gap-4 border border-purple-300/25 bg-gradient-to-r from-purple-700/40 via-fuchsia-700/20 to-black/30">
                <div className="relative flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => openUser(officialUser)}
                    className="block rounded-full active:scale-95 touch-manipulation"
                    aria-label={`Open ${officialUser.display_name || officialUser.username}`}
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
                  <p className="text-white font-semibold truncate">{officialUser.display_name || officialUser.username}</p>
                  <p className="text-sm text-white/50 truncate">
                    @{officialUser.username}
                    {officialUser.follower_count ? ` · ${formatCount(officialUser.follower_count)} followers` : ''}
                  </p>
                  {getBioText(officialUser.profile?.bio) ? (
                    <p className="text-xs text-white/45 mt-1 line-clamp-2">{getBioText(officialUser.profile?.bio)}</p>
                  ) : null}
                </button>
              </div>
            )}

            {filter !== 'ens' && renderRail('thepod', podUsers)}
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
