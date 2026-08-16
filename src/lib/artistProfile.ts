import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase/config';

export type ArtistProfilePreview = {
  pfpUrl?: string;
  username?: string;
  displayName?: string;
};

const previewCache = new Map<number, ArtistProfilePreview>();

function isUsablePfp(url?: string | null): url is string {
  if (!url || typeof url !== 'string') return false;
  if (/avatar\.vercel\.sh/i.test(url)) return false;
  return /^https?:\/\//i.test(url);
}

async function previewFromFirebase(fid: number): Promise<ArtistProfilePreview | null> {
  const snap = await getDoc(doc(db, 'searchedusers', String(fid)));
  if (!snap.exists()) return null;
  const data = snap.data() as {
    pfp_url?: string;
    avatar?: string;
    username?: string;
    display_name?: string;
  };
  const pfp = data.pfp_url || data.avatar;
  return {
    pfpUrl: isUsablePfp(pfp) ? pfp : undefined,
    username: data.username,
    displayName: data.display_name,
  };
}

async function previewFromNeynar(fid: number): Promise<ArtistProfilePreview | null> {
  const key = process.env.NEXT_PUBLIC_NEYNAR_API_KEY;
  if (!key) return null;
  const res = await fetch(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
    headers: { accept: 'application/json', api_key: key },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    users?: Array<{ pfp_url?: string; username?: string; display_name?: string }>;
  };
  const user = data.users?.[0];
  if (!user) return null;
  return {
    pfpUrl: isUsablePfp(user.pfp_url) ? user.pfp_url : undefined,
    username: user.username,
    displayName: user.display_name,
  };
}

/** Read-only profile bits for the info-panel artist row. Does not record a search. */
export async function getArtistProfilePreview(fid: number): Promise<ArtistProfilePreview> {
  const cached = previewCache.get(fid);
  if (cached?.pfpUrl) return cached;

  const fromFirebase = await previewFromFirebase(fid).catch(() => null);
  if (fromFirebase?.pfpUrl) {
    previewCache.set(fid, fromFirebase);
    return fromFirebase;
  }

  const fromNeynar = await previewFromNeynar(fid).catch(() => null);
  const merged: ArtistProfilePreview = {
    ...fromFirebase,
    ...fromNeynar,
    pfpUrl: fromNeynar?.pfpUrl || fromFirebase?.pfpUrl,
  };
  previewCache.set(fid, merged);
  return merged;
}
