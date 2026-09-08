import {
  collection,
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

const VIEWER_STORAGE_KEY = 'podplayr.liveViewer';

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

export async function beatLiveViewer(viewerId: string): Promise<void> {
  if (!viewerId) return;
  await setDoc(
    doc(viewersRef(), viewerId),
    { lastSeen: Timestamp.now() },
    { merge: true }
  );
}

export function subscribeLiveViewerCount(
  onCount: (count: number) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    viewersRef(),
    (snap) => {
      const cutoff = Date.now() - LIVE_VIEWER_STALE_MS;
      const count = snap.docs.filter((docSnap) => lastSeenMs(docSnap.data().lastSeen) > cutoff).length;
      onCount(count);
    },
    (error) => {
      onError?.(error);
    }
  );
}

export function startLiveViewerHeartbeat(): () => void {
  const viewerId = getLiveViewerId();
  void beatLiveViewer(viewerId);
  const timer = window.setInterval(() => {
    void beatLiveViewer(viewerId);
  }, LIVE_VIEWER_HEARTBEAT_MS);
  return () => {
    window.clearInterval(timer);
  };
}
