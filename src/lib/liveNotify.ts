import {
  LIVE_HLS_URL,
  LIVE_OFFLINE_POLLS,
  LIVE_PLAYBACK_ID,
  LIVE_POLL_MS,
} from '../data/liveStream';
import { LIVE_NOTIFY_BODY, LIVE_NOTIFY_TITLE, fidsToNotify } from '../data/liveNotifications';
import { getAppUrl, getLiveUrl } from './miniapp';
import {
  getLiveNotifyState,
  isNotificationStoreConfigured,
  listNotifiableFids,
  setLiveNotifyState,
  type LiveNotifyState,
} from './kv';
import { sendFrameNotification, type SendFrameNotificationResult } from './notifs';

const emptyState = (): LiveNotifyState => ({
  online: false,
  seq: null,
  seqAt: 0,
  misses: 0,
  sessionId: null,
  notifiedSessionId: null,
});

async function checkManifest(): Promise<{ status: 'live' | 'ended' | 'down'; seq: string | null }> {
  try {
    const res = await fetch(LIVE_HLS_URL, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return { status: 'down', seq: null };
    const text = await res.text();
    if (!text.includes('#EXTM3U')) return { status: 'down', seq: null };
    if (text.includes('#EXT-X-ENDLIST')) return { status: 'ended', seq: null };
    const seq = text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1] ?? null;
    return { status: 'live', seq };
  } catch {
    return { status: 'down', seq: null };
  }
}

async function notifyLiveStarted(sessionId: string): Promise<SendFrameNotificationResult[]> {
  const fids = fidsToNotify(await listNotifiableFids());
  const targetUrl = getLiveUrl(getAppUrl());
  return Promise.all(
    fids.map((fid) =>
      sendFrameNotification({
        fid,
        title: LIVE_NOTIFY_TITLE,
        body: LIVE_NOTIFY_BODY,
        notificationId: sessionId.slice(0, 128),
        targetUrl,
      })
    )
  );
}

export type LiveNotifyPollResult = {
  online: boolean;
  notified: boolean;
  results: SendFrameNotificationResult[];
};

export async function pollAndNotifyLive(): Promise<LiveNotifyPollResult> {
  if (!isNotificationStoreConfigured()) {
    return { online: false, notified: false, results: [] };
  }
  const prev = (await getLiveNotifyState()) ?? emptyState();
  const { status, seq } = await checkManifest();
  const now = Date.now();
  let classified = status;
  if (status === 'live' && seq && prev.seq === seq && now - prev.seqAt >= LIVE_POLL_MS) {
    classified = 'ended';
  }

  const next: LiveNotifyState = { ...prev };

  if (classified === 'live') {
    next.misses = 0;
    next.seq = seq;
    next.seqAt = now;
    if (!prev.online) {
      next.online = true;
      next.sessionId = `live-${LIVE_PLAYBACK_ID}-${now}`.slice(0, 128);
      next.notifiedSessionId = null;
    }
  } else {
    next.misses = classified === 'ended' ? LIVE_OFFLINE_POLLS : prev.misses + 1;
    if (prev.online && next.misses >= LIVE_OFFLINE_POLLS) {
      next.online = false;
      next.seq = null;
      next.seqAt = 0;
      next.misses = 0;
      next.sessionId = null;
      next.notifiedSessionId = null;
    }
  }

  await setLiveNotifyState(next);

  let results: SendFrameNotificationResult[] = [];
  let notified = false;
  if (next.online && next.sessionId && next.sessionId !== next.notifiedSessionId) {
    results = await notifyLiveStarted(next.sessionId);
    if (results.some((result) => result.state === 'success')) {
      next.notifiedSessionId = next.sessionId;
      await setLiveNotifyState(next);
      notified = true;
    }
  }

  return { online: next.online, notified, results };
}
