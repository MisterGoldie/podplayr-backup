import { cache } from 'react';
import type { FarcasterUser } from '../types/user';

/** Inline JSON on `/profile/{fid}` so the client can paint the profile shell immediately. */
export const PROFILE_BOOTSTRAP_SCRIPT_ID = 'podplayr-profile-bootstrap';

type NeynarUser = {
  fid?: number;
  username?: string;
  display_name?: string;
  pfp_url?: string;
  follower_count?: number;
  following_count?: number;
  custody_address?: string;
  verifications?: string[];
  profile?: {
    bio?: string | { text?: string };
  };
};

export function mapNeynarUserToFarcasterUser(user: NeynarUser | null | undefined): FarcasterUser | null {
  if (!user?.fid || !user.username) return null;

  const bio = user.profile?.bio;
  const bioText =
    typeof bio === 'string' ? bio : bio && typeof bio === 'object' ? bio.text || '' : '';

  const addresses = [...(user.verifications || []), user.custody_address]
    .filter((addr): addr is string => Boolean(addr && addr.startsWith('0x') && addr.length === 42));

  return {
    fid: user.fid,
    username: user.username,
    display_name: user.display_name || user.username,
    pfp_url: user.pfp_url || `https://avatar.vercel.sh/${user.username}`,
    follower_count: user.follower_count || 0,
    following_count: user.following_count || 0,
    custody_address: user.custody_address,
    verified_addresses: {
      eth_addresses: [...new Set(addresses)],
    },
    profile: {
      bio: bioText,
    },
  };
}

/**
 * Full Neynar card for a profile route. `cache()` dedupes generateMetadata +
 * the page body so a launch only hits Neynar once on the server.
 */
export const fetchProfileUser = cache(async (fid: number): Promise<FarcasterUser | null> => {
  const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY || process.env.NEYNAR_API_KEY;
  if (!neynarKey || !Number.isInteger(fid) || fid === 0) return null;

  try {
    const response = await fetch(
      `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`,
      {
        headers: {
          accept: 'application/json',
          api_key: neynarKey,
        },
        next: { revalidate: 300 },
      }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { users?: NeynarUser[] };
    return mapNeynarUserToFarcasterUser(data.users?.[0]);
  } catch {
    return null;
  }
});

export function serializeProfileBootstrap(user: FarcasterUser): string {
  return JSON.stringify(user).replace(/</g, '\\u003c');
}

export function readProfileBootstrap(): FarcasterUser | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(PROFILE_BOOTSTRAP_SCRIPT_ID);
  if (!el?.textContent) return null;
  try {
    const parsed = JSON.parse(el.textContent) as FarcasterUser;
    if (!parsed?.fid || !parsed.username) return null;
    return parsed;
  } catch {
    return null;
  }
}
