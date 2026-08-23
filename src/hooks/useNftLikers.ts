import { useContext, useEffect, useState } from 'react';
import { FarcasterContext, UserFidContext } from '~/app/providers';
import { getArtistProfilePreviews, type ArtistProfilePreview } from '../lib/artistProfile';
import { getRecentLikerFids } from '../lib/firebase/likers';
import { getMediaKey } from '../utils/media';
import type { NFT } from '../types/user';

export type NftLiker = ArtistProfilePreview & {
  fid: number;
  isCurrentUser: boolean;
};

const DISPLAY_LIKERS = 3;

export function useNftLikers(nft: NFT | null, isLiked: boolean, likesCount: number) {
  const { fid: currentFid } = useContext(UserFidContext);
  const { user: farcasterUser } = useContext(FarcasterContext);
  const [likers, setLikers] = useState<NftLiker[]>([]);
  const [loading, setLoading] = useState(false);

  const mediaKey = nft ? getMediaKey(nft) : '';

  useEffect(() => {
    if (!mediaKey || (likesCount <= 0 && !isLiked)) {
      setLikers([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      const fids = await getRecentLikerFids(mediaKey);
      if (cancelled) return;

      const ordered = [...fids];
      if (isLiked && currentFid && currentFid > 0 && !ordered.includes(currentFid)) {
        ordered.unshift(currentFid);
      } else if (isLiked && currentFid && currentFid > 0) {
        ordered.splice(ordered.indexOf(currentFid), 1);
        ordered.unshift(currentFid);
      }

      const previewFids = ordered.slice(0, DISPLAY_LIKERS);
      const previews = await getArtistProfilePreviews(previewFids);
      if (cancelled) return;

      setLikers(
        previewFids.map((fid) => {
          const preview = previews.get(fid) || {};
          const isCurrentUser = Boolean(currentFid && fid === currentFid);
          return {
            fid,
            isCurrentUser,
            username: preview.username || (isCurrentUser ? farcasterUser?.username : undefined),
            displayName: preview.displayName || (isCurrentUser ? farcasterUser?.displayName : undefined),
            pfpUrl: preview.pfpUrl || (isCurrentUser ? farcasterUser?.pfp : undefined),
          };
        })
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    mediaKey,
    likesCount,
    isLiked,
    currentFid,
    farcasterUser?.username,
    farcasterUser?.displayName,
    farcasterUser?.pfp,
  ]);

  return { likers, loading };
}
