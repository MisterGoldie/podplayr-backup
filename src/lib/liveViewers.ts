import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase/config';
import {
  LIVE_CHAT_COLLECTION,
  LIVE_STREAM_ID,
  LIVE_VIEWER_HEARTBEAT_MS,
  LIVE_VIEWER_STALE_MS,
} from '../data/liveStream';
import { isRealFid } from '../utils/platform';

const VIEWER_STORAGE_KEY = 'podplayr.liveViewer';

export type LiveViewerIdentity = {
  fid?: number | null;
  walletAddress?: string | null;
  firebaseUid?: string | null;
  environment?: 'farcaster' | 'coinbase' | 'web';
  username?: string | null;
  displayName?: string | null;
};

export type LiveViewerPresence = {
  viewerId: string;
  lastSeen: number;
  fid: number | null;
  wallet: string | null;
  firebaseUid: string | null;
  environment: 'farcaster' | 'coinbase' | 'web' | null;
  username: string | null;
  displayName: string | null;
};

function viewersRef() {
  return collection(db, LIVE_CHAT_COLLECTION, LIVE_STREAM_ID, 'viewers');
}

function lastSeenMs(value: { toMillis?: () => number } | undefined): number {
  return value?.toMillis?.() ?? 0;
}

let memoryViewerId: string | null = null;

function newViewerId(): string {
  return `v:${crypto.randomUUID()}`;
}

export function getLiveViewerId(): string {
  if (typeof window === 'undefined') return memoryViewerId ?? 'v:ssr';
  try {
    const existing = localStorage.getItem(VIEWER_STORAGE_KEY);
    if (existing) return existing;
    const next = newViewerId();
    localStorage.setItem(VIEWER_STORAGE_KEY, next);
    return next;
  } catch {
    if (!memoryViewerId) memoryViewerId = newViewerId();
    return memoryViewerId;
  }
}

function normalizeWallet(wallet?: string | null): string | null {
  if (!wallet || typeof wallet !== 'string') return null;
  const trimmed = wallet.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function presenceFromDoc(
  viewerId: string,
  data: Record<string, unknown>
): LiveViewerPresence {
  const fid = isRealFid(Number(data.fid)) ? Number(data.fid) : null;
  return {
    viewerId,
    lastSeen: lastSeenMs(data.lastSeen as { toMillis?: () => number } | undefined),
    fid,
    wallet: normalizeWallet(typeof data.wallet === 'string' ? data.wallet : null),
    firebaseUid: typeof data.firebaseUid === 'string' && data.firebaseUid ? data.firebaseUid : null,
    environment:
      data.environment === 'farcaster' || data.environment === 'coinbase' || data.environment === 'web'
        ? data.environment
        : null,
    username: typeof data.username === 'string' && data.username ? data.username : null,
    displayName: typeof data.displayName === 'string' && data.displayName ? data.displayName : null,
  };
}

/** One person across devices: FID, else Firebase uid, else wallet, else anonymous device id. */
export function liveViewerDedupeKey(viewer: LiveViewerPresence): string {
  if (viewer.fid) return `fid:${viewer.fid}`;
  if (viewer.firebaseUid) return `uid:${viewer.firebaseUid}`;
  if (viewer.wallet) return `wallet:${viewer.wallet}`;
  return `anon:${viewer.viewerId}`;
}

function activeViewersFromSnapshot(
  docs: Array<{ id: string; data: () => Record<string, unknown> }>
): LiveViewerPresence[] {
  const cutoff = Date.now() - LIVE_VIEWER_STALE_MS;
  const seen = new Set<string>();
  const active: LiveViewerPresence[] = [];
  for (const docSnap of docs) {
    const viewer = presenceFromDoc(docSnap.id, docSnap.data());
    if (viewer.lastSeen <= cutoff) continue;
    const key = liveViewerDedupeKey(viewer);
    if (seen.has(key)) continue;
    seen.add(key);
    active.push(viewer);
  }
  return active;
}

export async function beatLiveViewer(
  viewerId: string,
  identity?: LiveViewerIdentity
): Promise<void> {
  if (!viewerId) return;
  const fid = isRealFid(identity?.fid) ? identity!.fid : null;
  const wallet = normalizeWallet(identity?.walletAddress);
  const firebaseUid = identity?.firebaseUid?.trim() || null;
  const username = identity?.username?.replace(/^@/, '').trim() || null;
  const displayName = identity?.displayName?.trim() || null;
  await setDoc(
    doc(viewersRef(), viewerId),
    {
      lastSeen: Timestamp.now(),
      fid,
      wallet,
      firebaseUid,
      environment: identity?.environment || 'web',
      username,
      displayName,
    },
    { merge: true }
  );
}

export async function leaveLiveViewer(viewerId: string): Promise<void> {
  if (!viewerId) return;
  try {
    await deleteDoc(doc(viewersRef(), viewerId));
  } catch {
    // Offline / rules — stale cutoff still drops the count.
  }
}

export function subscribeLiveViewers(
  onViewers: (viewers: LiveViewerPresence[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    viewersRef(),
    (snap) => {
      onViewers(
        activeViewersFromSnapshot(snap.docs.map((d) => ({ id: d.id, data: () => d.data() })))
      );
    },
    (error) => {
      onError?.(error);
    }
  );
}

export function subscribeLiveViewerCount(
  onCount: (count: number) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return subscribeLiveViewers((viewers) => onCount(viewers.length), onError);
}

export function startLiveViewerHeartbeat(getIdentity?: () => LiveViewerIdentity): () => void {
  const viewerId = getLiveViewerId();
  const beat = () => {
    void beatLiveViewer(viewerId, getIdentity?.());
  };
  beat();
  const timer = window.setInterval(beat, LIVE_VIEWER_HEARTBEAT_MS);
  return () => {
    window.clearInterval(timer);
    void leaveLiveViewer(viewerId);
  };
}
