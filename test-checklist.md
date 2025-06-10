# PODPLAYR Functionality Test Checklist

## Core Audio Playback
- [ ] Play NFT from main grid
  - Verify audio starts playing
  - Verify play button changes to pause
  - Verify NFT appears in recently played
  - Verify play count increases in info card
  - Verify play count increases in top played badge (if applicable)

- [ ] Play NFT from top played section
  - Verify same checks as above
  - Verify order updates if play count changes ranking

- [ ] Play NFT from recently played
  - Verify same checks as above
  - Verify recently played order updates

- [ ] Play/Pause Controls
  - Verify play/pause button toggles correctly
  - Verify audio actually stops/starts
  - Verify current time indicator updates

## NFT Play Count Tracking
- [ ] Play Count Synchronization
  - Play an NFT multiple times
  - Verify info card count matches top played badge
  - Verify counts persist after page refresh

- [ ] Identical Media Content
  - Find two NFTs with same media content
  - Play one NFT
  - Verify play count increases for both NFTs
  - Verify both show same count in info card
  - Verify both show same count in top played badge

## Recently Played
- [ ] Order
  - Play several NFTs in sequence
  - Verify most recent appears first
  - Verify list updates in real-time
  - Verify list persists after refresh

## Top Played
- [ ] Display
  - Verify shows top 3 most played NFTs
  - Verify play counts are accurate
  - Verify order is by play count (highest first)
  - Verify updates when play counts change

## Like/Unlike Feature
- [ ] Basic Functionality
  - Like an NFT
  - Verify heart icon fills
  - Unlike the NFT
  - Verify heart icon empties

- [ ] Persistence
  - Like several NFTs
  - Refresh page
  - Verify liked status remains
  - Unlike some NFTs
  - Refresh page
  - Verify unliked status remains

## Search & Filter
- [ ] Search
  - Search for existing NFT name
  - Verify correct NFTs appear
  - Search for non-existent name
  - Verify no results shown
  - Clear search
  - Verify all NFTs return

- [ ] Collection Filter
  - Filter by existing collection
  - Verify only NFTs from that collection show
  - Clear filter
  - Verify all NFTs return

## Data Consistency
- [ ] Play Count Storage
  - Verify nft_plays collection updates
  - Verify top_played collection updates
  - Verify mediaKey grouping works

- [ ] Recently Played Storage
  - Verify play_history collection updates
  - Verify timestamp ordering works

- [ ] Liked NFTs Storage
  - Verify liked_nfts collection updates
  - Verify user-specific likes work

## Error Handling
- [ ] Invalid NFT Data
  - Try playing NFT with missing audio
  - Verify appropriate error shown
  - Verify app doesn't crash

- [ ] Network Issues
  - Test with slow connection
  - Verify loading states show
  - Verify appropriate error handling

## Performance
- [ ] Loading Times
  - Verify initial load is reasonable
  - Verify NFT grid loads efficiently
  - Verify audio starts playing promptly
  - Verify UI remains responsive during playback

## Notes
- Document any bugs or inconsistencies found
- Note any performance issues
- List any suggested improvements for future versions
