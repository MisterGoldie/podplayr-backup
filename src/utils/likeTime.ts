type LikeTimeSource = {
  timestamp?: unknown;
  likedAt?: unknown;
  timestampISO?: unknown;
  likedTimestamp?: unknown;
  lastLiked?: unknown;
  createTime?: unknown;
};

const isServerTimestampSentinel = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const v = value as { _methodName?: string; type?: string };
  return v._methodName === 'serverTimestamp' || v.type === 'serverTimestamp';
};

const millisFromUnknown = (value: unknown): number => {
  if (value == null || isServerTimestampSentinel(value)) return 0;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === 'object') {
    const ts = value as {
      toMillis?: () => number;
      seconds?: number;
      _seconds?: number;
    };
    if (typeof ts.toMillis === 'function') {
      const ms = ts.toMillis();
      return Number.isFinite(ms) ? ms : 0;
    }
    const seconds = typeof ts.seconds === 'number' ? ts.seconds : ts._seconds;
    if (typeof seconds === 'number' && Number.isFinite(seconds)) {
      return seconds * 1000;
    }
  }
  return 0;
};

/** Field times only — never document createTime (rewrites would scramble Library order). */
export const likeTimeFromFields = (data?: LikeTimeSource | null): number => {
  if (!data) return 0;
  return (
    millisFromUnknown(data.likedAt) ||
    millisFromUnknown(data.timestampISO) ||
    millisFromUnknown(data.timestamp) ||
    millisFromUnknown(data.lastLiked) ||
    millisFromUnknown(data.likedTimestamp)
  );
};

/** Milliseconds from a Firebase like doc (users/{id}/likes/{mediaKey}). */
export const likeTimeFromDoc = (data?: LikeTimeSource | null): number => {
  if (!data) return 0;
  return likeTimeFromFields(data) || millisFromUnknown(data.createTime);
};

/** QueryDocumentSnapshot createTime — the real like time when `timestamp` is a sentinel map. */
export const snapshotCreateMillis = (doc: object | null | undefined): number => {
  if (!doc) return 0;
  const anyDoc = doc as {
    createTime?: unknown;
    _document?: { createTime?: unknown };
  };
  return millisFromUnknown(anyDoc.createTime) || millisFromUnknown(anyDoc._document?.createTime);
};

/** Milliseconds used to sort Library by last liked. */
export const getNftLikedTime = (nft: LikeTimeSource): number => likeTimeFromDoc(nft);

export const stampNftLikeTime = <T extends object>(nft: T, data?: LikeTimeSource | null): T => {
  const timed = nft as T & {
    likedTimestamp?: number;
    likedAt?: string;
    timestamp?: unknown;
  };
  const ms = likeTimeFromFields(data) || likeTimeFromFields(timed) || millisFromUnknown(data?.createTime);
  timed.likedTimestamp = ms;
  if (typeof data?.likedAt === 'string' && data.likedAt) {
    timed.likedAt = data.likedAt;
  } else if (ms && !timed.likedAt) {
    timed.likedAt = new Date(ms).toISOString();
  }
  if (data?.timestamp != null && !isServerTimestampSentinel(data.timestamp)) {
    timed.timestamp = data.timestamp;
  }
  return nft;
};

export const sortLikedNewestFirst = <T extends object>(nfts: T[]): T[] => {
  const times = nfts.map((nft) => getNftLikedTime(nft as LikeTimeSource));
  const counts = new Map<number, number>();
  for (const time of times) {
    if (!time) continue;
    counts.set(time, (counts.get(time) || 0) + 1);
  }

  return nfts
    .map((nft, index) => {
      let time = getNftLikedTime(nft as LikeTimeSource);
      // A large set of identical timestamps is a rewrite batch, not real like order.
      if (time && (counts.get(time) || 0) >= 5) time = 0;
      const name = String((nft as { name?: string }).name || '');
      return { nft, index, time, name };
    })
    .sort((a, b) => b.time - a.time || a.name.localeCompare(b.name) || a.index - b.index)
    .map(({ nft }) => nft);
};

/** Document createTime from Firestore REST — used when `timestamp` was stored as a sentinel map. */
export async function fetchLikeCreateTimes(userId: string): Promise<Map<string, number>> {
  const times = new Map<string, number>();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!projectId || !apiKey || typeof fetch === 'undefined') return times;
  try {
    let pageToken = '';
    do {
      const url = new URL(
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(userId)}/likes`
      );
      url.searchParams.set('pageSize', '300');
      url.searchParams.set('key', apiKey);
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const res = await fetch(url.toString());
      if (!res.ok) break;
      const data = (await res.json()) as {
        documents?: Array<{ name?: string; createTime?: string }>;
        nextPageToken?: string;
      };
      for (const d of data.documents || []) {
        const id = String(d.name || '').split('/').pop() || '';
        const ms = Date.parse(d.createTime || '');
        if (id && Number.isFinite(ms)) times.set(id, ms);
      }
      pageToken = data.nextPageToken || '';
    } while (pageToken);
  } catch {
    return times;
  }
  return times;
}
