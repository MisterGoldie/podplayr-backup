import { useState, useEffect, useContext, useRef } from 'react';
import Image from 'next/image';
import { FarcasterUser } from '../../types/user';
import { createENSUser } from '../../types/ens';
import { UserFidContext } from '../../app/providers';
import { trackENSUserSearch } from '../../lib/firebase';
import { resolveEnsAddress, getEnsProfile } from '../../lib/ens';
import { logger } from '../../utils/logger';
import { officialAccountDisplayName } from '../../constants/community';
import { CommunityPills } from '../user/CommunityPills';
import { normalizeFname, normalizeSearchQuery, pickExactFnameUser } from '../../utils/farcasterFname';

interface SearchBarProps {
  onSearch: (username: string) => void;
  isSearching: boolean;
  handleUserSelect?: (user: FarcasterUser) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSearch, isSearching, handleUserSelect }) => {
  const { fid: userFid = 0 } = useContext(UserFidContext);
  const [username, setUsername] = useState('');
  const [suggestions, setSuggestions] = useState<FarcasterUser[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLFormElement>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, []);

  useEffect(() => {
    const query = normalizeSearchQuery(username);
    const isDigitFid = /^\d+$/.test(query);
    if (query.length < (isDigitFid ? 1 : 2)) {
      requestIdRef.current += 1;
      setSuggestions([]);
      setSuggesting(false);
      setOpen(false);
      return;
    }

    const isIncompleteEnsName = query.includes('.') && !query.toLowerCase().endsWith('.eth');
    if (isIncompleteEnsName) {
      return;
    }

    const requestId = ++requestIdRef.current;
    setSuggesting(true);

    const debounceTimer = setTimeout(async () => {
      try {
        const isEnsSearch = query.toLowerCase().endsWith('.eth');
        let users: FarcasterUser[] = [];

        if (isEnsSearch) {
          const address = await resolveEnsAddress(query);
          if (requestId !== requestIdRef.current) return;

          if (address) {
            const { searchUsersByAddress } = await import('../../lib/firebase');
            const farcasterUsers = await searchUsersByAddress(address);
            if (requestId !== requestIdRef.current) return;

            if (farcasterUsers.length > 0) {
              users = farcasterUsers;
            } else {
              const ensProfile = await getEnsProfile(query);
              if (requestId !== requestIdRef.current) return;
              if (ensProfile) {
                users = [createENSUser(ensProfile) as unknown as FarcasterUser];
              }
            }
          }
        }

        if (users.length === 0) {
          const { searchUsers } = await import('../../lib/firebase');
          users = (await searchUsers(query)) || [];
          if (requestId !== requestIdRef.current) return;
        }

        setSuggestions(users.slice(0, 8));
        setHighlightIndex(0);
        setOpen(true);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        logger.error('Search error:', err);
        setSuggestions([]);
        setOpen(true);
      } finally {
        if (requestId === requestIdRef.current) {
          setSuggesting(false);
        }
      }
    }, 280);

    return () => clearTimeout(debounceTimer);
  }, [username]);

  const selectUser = async (suggestion: FarcasterUser) => {
    setUsername('');
    setSuggestions([]);
    setOpen(false);

    if (suggestion.isENS && 'ensName' in suggestion) {
      try {
        const address = await resolveEnsAddress(suggestion.ensName as string);
        if (address) {
          const ensProfile = await getEnsProfile(suggestion.ensName as string);
          const { trackENSUserSearch } = await import('../../lib/firebase');
          await trackENSUserSearch(
            suggestion.ensName as string,
            suggestion.fid,
            address,
            ensProfile,
            userFid
          );
        }
      } catch (error) {
        logger.error(`Failed to track ENS user selection:`, error);
      }
    }

    handleUserSelect?.(suggestion);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = normalizeSearchQuery(username);
    if (!query) return;

    const highlighted = suggestions[highlightIndex];
    const exact = pickExactFnameUser(suggestions, query);
    if (highlighted || exact) {
      await selectUser(highlighted || exact!);
      return;
    }

    const isEnsName = query.toLowerCase().endsWith('.eth');
    if (isEnsName) {
      try {
        const address = await resolveEnsAddress(query);
        if (address) {
          const { searchUsersByAddress } = await import('../../lib/firebase');
          const farcasterUsers = await searchUsersByAddress(address);

          if (farcasterUsers.length === 1) {
            handleUserSelect?.(farcasterUsers[0]);
            setUsername('');
            setSuggestions([]);
            setOpen(false);
            return;
          }

          if (farcasterUsers.length === 0) {
            const ensProfile = await getEnsProfile(query);
            if (ensProfile) {
              const ensUser = createENSUser(ensProfile);
              try {
                await trackENSUserSearch(query, ensUser.fid, address, ensProfile, userFid);
              } catch (trackError) {
                logger.error(`Failed to track ENS user search:`, trackError);
              }
              handleUserSelect?.(ensUser as unknown as FarcasterUser);
              setUsername('');
              setSuggestions([]);
              setOpen(false);
              return;
            }
          }
        }
      } catch (error) {
        logger.error('Error processing ENS search:', error);
      }
    }

    setSuggestions([]);
    setOpen(false);
    onSearch(query);
  };

  const showMenu = open && (suggesting || suggestions.length > 0 || normalizeSearchQuery(username).length >= 2);

  return (
    <form
      ref={rootRef}
      onSubmit={handleSubmit}
      className="w-full max-w-[90vw] mx-auto text-center relative"
    >
      <div className="relative mt-1">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-300/70 pointer-events-none">
          <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor" aria-hidden="true">
            <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z"/>
          </svg>
        </span>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!showMenu || suggestions.length === 0) {
              if (e.key === 'Escape') setOpen(false);
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlightIndex((index) => (index + 1) % suggestions.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlightIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
            }
          }}
          placeholder="Search @username or .eth"
          className={`w-full pl-11 py-3 bg-black/40 border border-purple-400/30 
                   rounded-full text-white placeholder-white/40 
                   focus:outline-none focus:border-purple-400 
                   transition-all duration-300 text-base ${
                     username.length > 0 ? 'pr-20' : 'pr-4'
                   }`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-busy={isSearching || suggesting}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showMenu}
          aria-controls="explore-search-suggestions"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          {suggesting && (
            <span className="w-4 h-4 border-2 border-purple-300/30 border-t-purple-300 rounded-full animate-spin" />
          )}
          {username.length > 0 && (
            <button
              type="button"
              onClick={() => {
                requestIdRef.current += 1;
                setUsername('');
                setSuggestions([]);
                setOpen(false);
                setSuggesting(false);
              }}
              className="w-7 h-7 rounded-full bg-white/10 text-white/70 text-sm leading-none active:bg-white/20 touch-manipulation"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {showMenu && (
        <div
          id="explore-search-suggestions"
          role="listbox"
          className="absolute left-0 right-0 mt-2 bg-gray-950/95 backdrop-blur-md rounded-2xl border border-purple-400/25 max-h-72 overflow-y-auto z-20 shadow-xl shadow-purple-900/30"
        >
          {suggesting && suggestions.length === 0 && (
            <div className="px-4 py-3 text-sm text-white/50 text-left">Searching…</div>
          )}
          {!suggesting && suggestions.length === 0 && (
            <div className="px-4 py-3 text-sm text-white/50 text-left">No users found</div>
          )}
          {suggestions.map((suggestion, index) => {
            const displayName =
              officialAccountDisplayName(suggestion.fid, suggestion.display_name) || suggestion.username;
            const isExact = normalizeFname(suggestion.username) === normalizeFname(username);
            return (
              <button
                key={`${suggestion.fid}-${suggestion.username}`}
                type="button"
                role="option"
                aria-selected={index === highlightIndex}
                onMouseEnter={() => setHighlightIndex(index)}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void selectUser(suggestion);
                }}
                className={`w-full px-4 py-2.5 flex items-center gap-3 text-left touch-manipulation ${
                  index === highlightIndex ? 'bg-purple-500/15' : 'active:bg-purple-500/10'
                }`}
              >
                <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 relative bg-purple-900/40">
                  <Image
                    src={suggestion.pfp_url || `https://avatar.vercel.sh/${suggestion.username}`}
                    alt={displayName || 'User avatar'}
                    className="object-cover"
                    fill
                    sizes="40px"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = `https://avatar.vercel.sh/${suggestion.username}`;
                    }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white truncate">
                    {displayName}
                    {isExact && (
                      <span className="ml-2 text-[10px] font-semibold tracking-wide uppercase text-purple-300">
                        Exact
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-white/50 truncate">
                    {suggestion.isENS ? suggestion.username : `@${suggestion.username}`}
                  </div>
                  <CommunityPills fid={suggestion.fid} isEns={suggestion.isENS} className="mt-1" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </form>
  );
};
