import { collectionGroup, doc, getDocs, limit, query, updateDoc, where } from 'firebase/firestore';
import { db } from './config';

const LIKER_QUERY_LIMIT = 16;
const CACHE_TTL_MS = 60_000;

const fidCache = new Map<string, { fids: number[]; at: number }>();

function parseFid(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const fid = Number(value);
    return fid > 0 ? fid : null;
  }
  return null;
}

function fidFromLikeDoc(pathUserId: string | undefined, data: Record<string, unknown>): number | null {
  const fromPath = parseFid(pathUserId);
  if (fromPath) return fromPath;
  return parseFid(data.fid) || parseFid(data.userId);
}

export async function getRecentLikerFids(mediaKey: string): Promise<number[]> {
  if (!mediaKey) return [];

  const cached = fidCache.get(mediaKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.fids;
  }

  try {
    const snap = await getDocs(
      query(
        collectionGroup(db, 'likes'),
        where('mediaKey', '==', mediaKey),
        limit(LIKER_QUERY_LIMIT)
      )
    );

    const fids: number[] = [];
    const seen = new Set<number>();
    for (const likeDoc of snap.docs) {
      const fid = fidFromLikeDoc(
        likeDoc.ref.parent.parent?.id,
        likeDoc.data() as Record<string, unknown>
      );
      if (!fid || seen.has(fid)) continue;
      seen.add(fid);
      fids.push(fid);
    }

    fidCache.set(mediaKey, { fids, at: Date.now() });

    if (fids.length > 0) {
      void updateDoc(doc(db, 'global_likes', mediaKey), {
        recentLikers: fids.slice(0, 12),
      }).catch(() => {
        // Historical likes already exist; caching on global_likes is optional.
      });
    }

    return fids;
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[likers] collection-group query failed; deploy the likes.mediaKey COLLECTION_GROUP index if missing.', error);
    }
    return cached?.fids ?? [];
  }
}

export function rememberLikerFids(mediaKey: string, fids: number[]) {
  if (!mediaKey || fids.length === 0) return;
  fidCache.set(mediaKey, { fids, at: Date.now() });
}
