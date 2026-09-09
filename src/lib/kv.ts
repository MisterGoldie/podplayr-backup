import { MiniAppNotificationDetails } from "@farcaster/miniapp-sdk";
import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
  redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
}

function getUserNotificationDetailsKey(fid: number): string {
  return `PODPLAYR:user:${fid}`;
}

const NOTIFIABLE_FIDS_KEY = 'PODPLAYR:notify:fids';
const LIVE_NOTIFY_STATE_KEY = 'PODPLAYR:live:state';

export type LiveNotifyState = {
  online: boolean;
  seq: string | null;
  seqAt: number;
  misses: number;
  sessionId: string | null;
  notifiedSessionId: string | null;
  showEnded: boolean;
};

export function isNotificationStoreConfigured(): boolean {
  return Boolean(redis);
}

export async function getUserNotificationDetails(
  fid: number
): Promise<MiniAppNotificationDetails | null> {
  if (!redis) return null;
  return await redis.get<MiniAppNotificationDetails>(
    getUserNotificationDetailsKey(fid)
  );
}

export async function setUserNotificationDetails(
  fid: number,
  notificationDetails: MiniAppNotificationDetails
): Promise<void> {
  if (!redis) return;
  await redis.set(getUserNotificationDetailsKey(fid), notificationDetails);
  await redis.sadd(NOTIFIABLE_FIDS_KEY, String(fid));
}

export async function deleteUserNotificationDetails(
  fid: number
): Promise<void> {
  if (!redis) return;
  await redis.del(getUserNotificationDetailsKey(fid));
  await redis.srem(NOTIFIABLE_FIDS_KEY, String(fid));
}

export async function listNotifiableFids(): Promise<number[]> {
  if (!redis) return [];
  const members = await redis.smembers(NOTIFIABLE_FIDS_KEY);
  const fromSet = members
    .map((value) => Number(value))
    .filter((fid) => Number.isInteger(fid) && fid > 0);
  if (fromSet.length > 0) return fromSet;

  const scanned = new Set<number>();
  let cursor: string | number = 0;
  do {
    const result = await redis.scan(cursor, { match: 'PODPLAYR:user:*', count: 100 });
    const next = Array.isArray(result) ? result[0] : (result as { cursor: string | number }).cursor;
    const keys = Array.isArray(result) ? result[1] : (result as { keys: string[] }).keys;
    cursor = next;
    for (const key of keys ?? []) {
      const fid = Number(String(key).split(':').pop());
      if (Number.isInteger(fid) && fid > 0) scanned.add(fid);
    }
  } while (cursor !== 0 && cursor !== '0');
  return [...scanned];
}

export async function getLiveNotifyState(): Promise<LiveNotifyState | null> {
  if (!redis) return null;
  return await redis.get<LiveNotifyState>(LIVE_NOTIFY_STATE_KEY);
}

export async function setLiveNotifyState(state: LiveNotifyState): Promise<void> {
  if (!redis) return;
  await redis.set(LIVE_NOTIFY_STATE_KEY, state);
}
