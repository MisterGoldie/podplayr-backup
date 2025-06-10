import { useState, useEffect, useContext } from 'react';
import Image from 'next/image';
import { FarcasterUser } from '../../types/user';
import { ENSUser, createENSUser } from '../../types/ens';
import { FarcasterContext } from '../../app/providers';
import { trackUserSearch, trackENSUserSearch } from '../../lib/firebase';
import { resolveEnsAddress, getEnsProfile } from '../../lib/ens';
import { logger } from '../../utils/logger';

// Hardcoded list of FIDs for users who should have "thepod" badge
const POD_MEMBER_FIDS = [15019, 7472, 14871, 414859, 892616, 892130];

// PODPLAYR official account FID
const PODPLAYR_OFFICIAL_FID = 1014485;

interface SearchBarProps {
  onSearch: (username: string) => void;
  isSearching: boolean;
  handleUserSelect?: (user: FarcasterUser) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSearch, isSearching, handleUserSelect }) => {
  const { fid: userFid = 0 } = useContext(FarcasterContext);
  const [username, setUsername] = useState('');
  const [suggestions, setSuggestions] = useState<FarcasterUser[]>([]);

  useEffect(() => {
    const fetchSuggestions = async () => {
      // Increase minimum length for search to reduce premature searches
      if (username.length < 3) {
        setSuggestions([]);
        return;
      }
      
      // Check if this is an ENS name (ends with .eth)
      const isEnsSearch = username.toLowerCase().endsWith('.eth');
      
      // For incomplete ENS names (typing in progress), don't search
      // This prevents the search while user is still entering "...goldie.eth"
      const isIncompleteEnsName = username.includes('.') && !username.endsWith('.eth');
      if (isIncompleteEnsName) {
        return;
      }

      try {
        // Handle ENS name search first
        if (isEnsSearch) {
          console.log(`🌐 DETECTED ENS NAME IN SUGGESTIONS: "${username}"`);
          logger.info(`SearchBar detected ENS name in suggestions: ${username}`);
          
          // Try to resolve the ENS name to an Ethereum address
          const address = await resolveEnsAddress(username);
          console.log(`🔗 ENS RESOLUTION RESULT:`, { name: username, address });
          
          if (address) {
            logger.info(`SearchBar resolved ENS name ${username} to address: ${address}`);
            
            // Use dynamic import to load only when needed
            const { searchUsersByAddress } = await import('../../lib/firebase');
            
            // First check if there are Farcaster users with this address
            console.log(`🔍 SEARCHING BY ADDRESS: ${address}`);
            const farcasterUsers = await searchUsersByAddress(address);
            console.log(`👥 FARCASTER ADDRESS SEARCH RESULTS:`, { count: farcasterUsers.length, results: farcasterUsers });
            
            if (farcasterUsers && farcasterUsers.length > 0) {
              logger.info(`Found ${farcasterUsers.length} Farcaster users matching address ${address} from ENS ${username}`);
              setSuggestions(farcasterUsers.slice(0, 5)); // Limit to 5 suggestions
              return;
            } else {
              // No Farcaster users found, but we have a valid ENS name and address
              // Create a synthetic ENS user that is compatible with FarcasterUser
              console.log(`ℹ️ No Farcaster users found for ENS ${username}, creating ENS user`);
              logger.info(`Creating synthetic ENS user for ${username} (address: ${address})`);
              
              try {
                // Get full ENS profile data and create an ENSUser object
                const ensProfile = await getEnsProfile(username);
                if (ensProfile) {
                  const ensUser = createENSUser(ensProfile);
                  console.log(`✅ Created synthetic ENS user:`, ensUser);
                  
                  // Don't track the ENS user search here - only track when user actually selects
                  // Store the ENS user data for later use when selected
                  logger.info(`Created ENS user for suggestions, will track only when selected: ${username}`);
                  
                  setSuggestions([ensUser as unknown as FarcasterUser]);
                  return;
                }
              } catch (ensError) {
                console.log(`⚠️ Error creating ENS user:`, ensError);
                logger.warn(`Error creating ENS user for ${username}:`, ensError);
                // Fall through to regular username search
              }
            }
          } else {
            console.log(`⚠️ Could not resolve ENS name: ${username}`);
            // Fall through to regular username search
          }
        }

        // Regular Farcaster username search
        const { searchUsers } = await import('../../lib/firebase');
        const users = await searchUsers(username);
        
        if (users && users.length > 0) {
          // If we found multiple users, show them all in the suggestions
          setSuggestions(users.slice(0, 5)); // Limit to 5 suggestions
        } else {
          // Fallback to hardcoded suggestions only if not searching for ENS
          if (!isEnsSearch) {
            // Use hardcoded suggestions for common searches
            const commonUsers = [
              {
                fid: 1014485, // PODPLAYR_OFFICIAL_FID
                username: 'podplayr',
                display_name: 'PODPLAYR',
                pfp_url: 'https://i.imgur.com/XqQZ3Kc.png',
                follower_count: 1000,
                following_count: 100
              },
              {
                fid: 15019, // A POD_MEMBER_FID
                username: 'thepod',
                display_name: 'The Pod',
                pfp_url: 'https://avatar.vercel.sh/thepod',
                follower_count: 500,
                following_count: 200
              }
            ];
            
            // Filter common users by the search term
            const filteredUsers = commonUsers.filter(user => 
              user.username.toLowerCase().includes(username.toLowerCase()) ||
              user.display_name.toLowerCase().includes(username.toLowerCase())
            );
            
            setSuggestions(filteredUsers.length > 0 ? filteredUsers : []);
          } else {
            setSuggestions([]);
          }
        }
      } catch (err) {
        console.error('Error fetching suggestions:', err);
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
        console.log(`🌐 SUBMITTING ENS NAME SEARCH: "${query}"`);
        logger.info(`SearchBar submitting ENS name search: ${query}`);
        
        try {
          // Try to resolve the ENS name to an Ethereum address
          const address = await resolveEnsAddress(query);
          console.log(`🔗 ENS RESOLUTION RESULT (SUBMIT):`, { name: query, address });
          
          if (address) {
            // Use dynamic import to load only when needed
            const { searchUsersByAddress } = await import('../../lib/firebase');
            
            // Get Farcaster users with this address
            const farcasterUsers = await searchUsersByAddress(address);
            console.log(`👥 FARCASTER ADDRESS SEARCH RESULTS (SUBMIT):`, { count: farcasterUsers.length });
            
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
                  console.log(`✅ Created ENS user for direct selection:`, ensUser);
                  
                  // Track the ENS user search in Firebase
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
                console.log(`⚠️ Error creating ENS user on submit:`, ensError);
                // Fall through to regular search
              }
            }
            // If we have multiple users or couldn't create ENS user, continue with search
          }
        } catch (error) {
          console.error('Error processing ENS search:', error);
          // Fall through to regular search
        }
      }
      
      // Regular search as fallback
      onSearch(query);
    }
  };

  const handleSuggestionClick = async (suggestion: FarcasterUser) => {
    setUsername(''); // Clear the input field
    setSuggestions([]); // Clear suggestions
    
    console.log('=== HANDLING SUGGESTION CLICK ===', suggestion);
    
    // Check if this is an ENS user that needs to be tracked
    if (suggestion.isENS && 'ensName' in suggestion) {
      console.log(`🌐 TRACKING ENS USER SELECTION: ${suggestion.ensName}`);
      
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
    <div className="w-full max-w-[90vw] mx-auto text-center">
      <div className="relative mt-4">
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Search Farcaster users or .eth names"
          className="w-full px-4 py-3 bg-transparent border-2 border-green-400/30 
                   rounded-full text-green-400 placeholder-green-400/50 
                   focus:outline-none focus:border-green-400 
                   transition-all duration-300 font-mono text-base"
          disabled={isSearching}
        />
      </div>

      {/* Suggestions dropdown */}
      {suggestions.length > 0 && (
        <div className="absolute left-0 right-0 mt-1 mx-4 bg-gray-900/90 backdrop-blur-sm rounded-lg border border-green-400/30 max-h-60 overflow-y-auto z-10">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.fid}
              onClick={(e) => {
                e.preventDefault(); // Prevent any default behavior
                e.stopPropagation(); // Stop event bubbling
                handleSuggestionClick(suggestion);
              }}
              className="w-full px-4 py-2 flex items-center gap-3 hover:bg-green-400/10 text-left transition-colors"
            >
              <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 relative">
                <Image
                  src={suggestion.pfp_url || `https://avatar.vercel.sh/${suggestion.username}`}
                  alt={suggestion.display_name || suggestion.username || 'User avatar'}
                  className="object-cover"
                  fill
                  sizes="40px"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.src = `https://avatar.vercel.sh/${suggestion.username}`;
                  }}
                />
              </div>
              <div className="flex-1">
                <div className="font-medium text-green-400">{suggestion.display_name || suggestion.username}</div>
                <div className="text-sm text-gray-400">@{suggestion.username}</div>
                {/* Badges row */}
                <div className="flex items-center gap-2 mt-1">
                  {POD_MEMBER_FIDS.includes(suggestion.fid) && (
                    <span className="text-xs font-mono px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded-full flex items-center">
                      thepod
                    </span>
                  )}
                  {suggestion.fid === PODPLAYR_OFFICIAL_FID && (
                    <span className="text-xs font-mono px-2 py-0.5 bg-purple-800/40 text-purple-300 rounded-full flex items-center font-semibold">
                      Official
                    </span>
                  )}
                  {[7472, 14871, 414859, 356115, 296462, 195864, 1020224, 1020659].includes(suggestion.fid) && (
                    <span className="text-xs font-mono px-2 py-0.5 rounded-full flex items-center font-semibold" 
                          style={{ 
                            background: 'linear-gradient(90deg, rgba(255,0,0,0.2) 0%, rgba(255,154,0,0.2) 25%, rgba(208,222,33,0.2) 50%, rgba(79,220,74,0.2) 75%, rgba(63,218,216,0.2) 100%)', 
                            color: '#f0f0f0',
                            textShadow: '0 0 2px rgba(0,0,0,0.5)'
                          }}>
                      ACYL
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};