import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase/config';
import { censorChatText } from './chatCensor';
import {
  LIVE_CHAT_COLLECTION,
  LIVE_CHAT_MAX_LEN,
  LIVE_CHAT_PAGE_SIZE,
  LIVE_SESSION_END_MS,
  LIVE_STREAM_ID,
} from '../data/liveStream';

export type LiveChatMessage = {
  id: string;
  sessionId: string;
  fid: number;
  username: string;
  displayName: string;
  pfp: string;
  text: string;
  createdAt: Timestamp | null;
};

export type LiveChatSession = {
  status: 'live' | 'idle';
  activeSessionId: string | null;
  /** After a real stream end, only show the new show's messages. */
  strictSession: boolean;
};

function sessionRef() {
  return doc(db, LIVE_CHAT_COLLECTION, LIVE_STREAM_ID);
}

function messagesRef() {
  return collection(db, LIVE_CHAT_COLLECTION, LIVE_STREAM_ID, 'messages');
}

export function subscribeLiveChatSession(
  onSession: (session: LiveChatSession) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    sessionRef(),
    (snap) => {
      const data = snap.data();
      onSession({
        status: data?.status === 'live' ? 'live' : 'idle',
        activeSessionId: typeof data?.activeSessionId === 'string' ? data.activeSessionId : null,
        strictSession: data?.strictSession === true,
      });
    },
    (error) => {
      onError?.(error);
    }
  );
}

export function subscribeLiveChat(
  onMessages: (messages: LiveChatMessage[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(messagesRef(), orderBy('createdAt', 'desc'), limit(LIVE_CHAT_PAGE_SIZE));

  return onSnapshot(
    q,
    (snap) => {
      const messages = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          const fid = Number(data.fid);
          const text = typeof data.text === 'string' ? data.text.trim() : '';
          if (!fid || !text) return null;
          return {
            id: docSnap.id,
            sessionId: typeof data.sessionId === 'string' ? data.sessionId : '',
            fid,
            username: typeof data.username === 'string' ? data.username : '',
            displayName: typeof data.displayName === 'string' ? data.displayName : '',
            pfp: typeof data.pfp === 'string' ? data.pfp : '',
            text,
            createdAt: data.createdAt ?? null,
          } satisfies LiveChatMessage;
        })
        .filter((msg): msg is LiveChatMessage => msg !== null)
        .reverse();
      onMessages(messages);
    },
    (error) => {
      onError?.(error);
    }
  );
}

function lastSeenMs(data: { lastSeenLiveAt?: { toMillis?: () => number } } | undefined): number {
  return data?.lastSeenLiveAt?.toMillis?.() ?? 0;
}

function recentlyLive(data: { lastSeenLiveAt?: { toMillis?: () => number } } | undefined): boolean {
  const seen = lastSeenMs(data);
  return seen > 0 && Date.now() - seen < LIVE_SESSION_END_MS;
}

/** Same chat while Mux is live. Refresh / reconnect never opens a new thread. */
export async function syncLiveChatSession(isLive: boolean): Promise<string | null> {
  return runTransaction(db, async (tx) => {
    const ref = sessionRef();
    const snap = await tx.get(ref);
    const data = snap.data();
    const currentId = typeof data?.activeSessionId === 'string' ? data.activeSessionId : null;
    const status = data?.status === 'live' ? 'live' : 'idle';
    const now = Timestamp.now();

    if (isLive) {
      if (currentId && (status === 'live' || recentlyLive(data))) {
        tx.set(
          ref,
          {
            status: 'live',
            lastSeenLiveAt: now,
            endedAt: null,
          },
          { merge: true }
        );
        return currentId;
      }
      const nextId = `${Date.now()}`;
      tx.set(
        ref,
        {
          status: 'live',
          activeSessionId: nextId,
          liveSince: now,
          lastSeenLiveAt: now,
          endedAt: null,
          strictSession: status === 'idle' && Boolean(currentId),
        },
        { merge: true }
      );
      return nextId;
    }

    if (recentlyLive(data)) return currentId;
    if (status === 'live') {
      tx.set(ref, { status: 'idle', endedAt: now }, { merge: true });
    }
    return null;
  });
}

export async function sendLiveChatMessage({
  fid,
  username,
  displayName,
  pfp,
  text,
  sessionId,
}: {
  fid: number;
  username?: string;
  displayName?: string;
  pfp?: string;
  text: string;
  sessionId: string;
}): Promise<void> {
  const trimmed = censorChatText(text.replace(/\s+/g, ' ').trim()).slice(0, LIVE_CHAT_MAX_LEN);
  if (!fid || !trimmed || !sessionId) return;

  await addDoc(messagesRef(), {
    fid,
    sessionId,
    username: username?.replace(/^@/, '') || '',
    displayName: displayName || '',
    pfp: pfp || '',
    text: trimmed,
    createdAt: Timestamp.now(),
  });
}
