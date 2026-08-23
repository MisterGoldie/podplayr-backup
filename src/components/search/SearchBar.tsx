import { useState, useEffect, useContext } from 'react';
import Image from 'next/image';
import { FarcasterUser } from '../../types/user';
import { createENSUser } from '../../types/ens';
import { UserFidContext } from '../../app/providers';
import { trackENSUserSearch } from '../../lib/firebase';
import { resolveEnsAddress, getEnsProfile } from '../../lib/ens';
import { logger } from '../../utils/logger';
import { officialAccountDisplayName } from '../../constants/community';
import { CommunityPills } from '../user/CommunityPills';

interface SearchBarProps {
  onSearch: (username: string) => void;
  isSearching: boolean;
  handleUserSelect?: (user: FarcasterUser) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSearch, isSearching, handleUserSelect }) => {
  const { fid: userFid = 0 } = useContext(UserFidContext);
  const [username, setUsername] = useState('');
  const [suggestions, setSuggestions] = useState<FarcasterUser[]>([]);

  useEffect(() => {
    const fetchSuggestions = async () => {
      if (username.length < 2) { // Reduce minimum length
        setSuggestions([]);
        return;
      }
      
      const isEnsSearch = username.toLowerCase().endsWith('.eth');
      const isIncompleteEnsName = username.includes('.') && !username.endsWith('.eth');
      
      if (isIncompleteEnsName) {
        return;
      }

      try {
        if (isEnsSearch) {
          const address = await resolveEnsAddress(username);
          
          if (address) {
            // Check for Farcaster users with this address first
            const { searchUsersByAddress } = await import('../../lib/firebase');
            const farcasterUsers = await searchUsersByAddress(address);
            
            if (farcasterUsers.length > 0) {
              setSuggestions(farcasterUsers.slice(0, 5));
              return;
            }
            
            // Create ENS user if no Farcaster users found
            const ensProfile = await getEnsProfile(username);
            if (ensProfile) {
              const ensUser = createENSUser(ensProfile);
              setSuggestions([ensUser as unknown as FarcasterUser]);
              return;
            }
          }
        }
        
        // Regular Farcaster search
        const { searchUsers } = await import('../../lib/firebase');
        const users = await searchUsers(username);
        
        if (users && users.length > 0) {
          setSuggestions(users.slice(0, 5));
        } else {
          // Fallback suggestions
          setSuggestions([]);
        }
      } catch (err) {
        logger.error('Search error:', err);
        setSuggestions([]);
      }
    };

    // Increase debounce time to reduce API calls during typing
    const debounceTimer = setTimeout(fetchSuggestions, 600);
    return () => clearTimeout(debounceTimer);
  }, [username, userFid]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      // Clear suggestions immediately for better UX
      setSuggestions([]);
      
      // Check if this is an ENS name
      const query = username.trim();
      const isEnsName = query.toLowerCase().endsWith('.eth');
      
      if (isEnsName) {
        try {
          const address = await resolveEnsAddress(query);
          
          if (address) {
            const { searchUsersByAddress } = await import('../../lib/firebase');
            const farcasterUsers = await searchUsersByAddress(address);
            
            if (farcasterUsers.length === 1) {
              // If there's exactly one user, select it directly
              if (handleUserSelect) {
                handleUserSelect(farcasterUsers[0]);
                return; // Skip the regular search
              }
            } else if (farcasterUsers.length === 0) {
              // No Farcaster users found, create a synthetic ENS user
              try {
                const ensProfile = await getEnsProfile(query);
                if (ensProfile) {
                  const ensUser = createENSUser(ensProfile);
                  try {
                    await trackENSUserSearch(
                      query,
                      ensUser.fid,
                      address,
                      ensProfile,
                      userFid // Pass the current user's FID
                    );
                    logger.info(`Successfully tracked ENS user search for ${query}`);
                  } catch (trackError) {
                    logger.error(`Failed to track ENS user search:`, trackError);
                  }
                  
                  if (handleUserSelect) {
                    handleUserSelect(ensUser as unknown as FarcasterUser);
                    return; // Skip the regular search
                  }
                }
              } catch (ensError) {
                logger.error('Error creating ENS user on submit:', ensError);
              }
            }
            // If we have multiple users or couldn't create ENS user, continue with search
          }
        } catch (error) {
          logger.error('Error processing ENS search:', error);
        }
      }
      
      // Regular search as fallback
      onSearch(query);
    }
  };

  const handleSuggestionClick = async (suggestion: FarcasterUser) => {
    setUsername(''); // Clear the input field
    setSuggestions([]); // Clear suggestions
    
    if (suggestion.isENS && 'ensName' in suggestion) {
      
      try {
        // Get the ENS address
        const address = await resolveEnsAddress(suggestion.ensName as string);
        if (address) {
          // Get the full ENS profile
          const ensProfile = await getEnsProfile(suggestion.ensName as string);
          
          // Track the ENS user search now that the user has explicitly selected it
          const { trackENSUserSearch } = await import('../../lib/firebase');
          await trackENSUserSearch(
            suggestion.ensName as string,
            suggestion.fid,
            address,
            ensProfile,
            userFid // Pass the current user's FID
          );
          logger.info(`Successfully tracked ENS user selection for ${suggestion.ensName}`);
        }
      } catch (error) {
        logger.error(`Failed to track ENS user selection:`, error);
      }
    }
    
    // ONLY use the direct handler, never fall back to regular search
    if (handleUserSelect) {
      handleUserSelect(suggestion);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-[90vw] mx-auto text-center relative">
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
          placeholder="Search @username or name.eth"
          className="w-full pl-11 pr-4 py-3 bg-black/40 border border-purple-400/30 
                   rounded-full text-white placeholder-white/40 
                   focus:outline-none focus:border-purple-400 
                   transition-all duration-300 text-base"
          disabled={isSearching}
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>

      {suggestions.length > 0 && (
        <div className="absolute left-0 right-0 mt-2 bg-gray-950/95 backdrop-blur-md rounded-2xl border border-purple-400/25 max-h-60 overflow-y-auto z-20 shadow-xl shadow-purple-900/30">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.fid}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleSuggestionClick(suggestion);
              }}
              className="w-full px-4 py-2.5 flex items-center gap-3 active:bg-purple-500/10 text-left"
            >
              <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 relative bg-purple-900/40">
                <Image
                  src={suggestion.pfp_url || `https://avatar.vercel.sh/${suggestion.username}`}
                  alt={officialAccountDisplayName(suggestion.fid, suggestion.display_name) || suggestion.username || 'User avatar'}
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
                <div className="font-medium text-white truncate">{officialAccountDisplayName(suggestion.fid, suggestion.display_name) || suggestion.username}</div>
                <div className="text-sm text-white/50 truncate">
                  {suggestion.isENS ? suggestion.username : `@${suggestion.username}`}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <CommunityPills fid={suggestion.fid} />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </form>
  );
};