/**
 * Mux live ingest + playback.
 * Stream keys stay in the Mux dashboard / Restream custom RTMP — never commit them here.
 * `streamId`/`playbackId` are safe to commit (they only enable playback/chat namespacing,
 * not broadcasting).
 */
type LiveStreamerConfig = {
  label: string;
  /** Mux "Stream ID" — used only as a Firestore chat namespace key, doesn't need to be secret. */
  streamId: string;
  /** Mux "Playback ID" — required to build the HLS/thumbnail URLs the app actually plays. */
  playbackId: string;
  rtmpUrl: string;
};

export const LIVE_STREAMERS = {
  will: {
    label: 'Will',
    streamId: 'O6f9TGui400kDQY023IAtlKjfmXctYy1YcAUofPyHHGql',
    playbackId: 'kyG01vdLgiolO005FBlZ01TVrAXouGc4U9FK238N82QZ7E',
    rtmpUrl: 'rtmps://global-live.mux.com:443/app',
  },
  sazon: {
    label: 'Sazon',
    // No separate Mux "Stream ID" on hand — the playback ID doubles as the chat
    // namespace key fine since it's already unique to this stream.
    streamId: 'sVDSlO11WykB6zMjrm0002m01g1Q6rHwaGNI5mUhdr6tNQ',
    playbackId: 'sVDSlO11WykB6zMjrm0002m01g1Q6rHwaGNI5mUhdr6tNQ',
    rtmpUrl: 'rtmps://global-live.mux.com:443/app',
    // Stream key (goes in the streamer's OBS/Restream config, never used by the app):
    // 0ba7f6f3-3635-af80-5488-df51a7e56354
  },
} as const satisfies Record<string, LiveStreamerConfig>;

/** Change this to switch which streamer's feed the whole app plays/chats around. */
const ACTIVE_STREAMER = LIVE_STREAMERS.will;

export const LIVE_STREAM_ID = ACTIVE_STREAMER.streamId;
export const LIVE_PLAYBACK_ID = ACTIVE_STREAMER.playbackId;

export const LIVE_HLS_URL = `https://stream.mux.com/${LIVE_PLAYBACK_ID}.m3u8`;

export const LIVE_DEFAULT_POSTER_URL = '/livedefault.png';
export const LIVE_WILL_POSTER_URL = '/willstream.png';

/** Fallback poster. Prefer `livePosterUrl()` so Will’s art reverts after the stream ends. */
export const LIVE_POSTER_URL = LIVE_DEFAULT_POSTER_URL;

export function livePosterUrl({
  online,
  showEnded,
}: {
  online: boolean;
  showEnded: boolean;
}): string {
  const willIsActive = ACTIVE_STREAMER === LIVE_STREAMERS.will;
  if (willIsActive && (online || !showEnded)) return LIVE_WILL_POSTER_URL;
  return LIVE_DEFAULT_POSTER_URL;
}

export const LIVE_TITLE = 'PODPLAYR Live';
export const LIVE_POLL_MS = 12_000;
export const LIVE_OFFLINE_POLLS = 3;

export const LIVE_CHAT_COLLECTION = 'live_chat';
export const LIVE_VIEWER_HEARTBEAT_MS = 10_000;
export const LIVE_VIEWER_STALE_MS = 90_000;
export const LIVE_CHAT_MAX_LEN = 200;
export const LIVE_CHAT_PAGE_SIZE = 150;
export const LIVE_CHAT_RATE_MS = 2_000;
/** Only treat the show as over after Mux has been gone this long. Reconnects keep the same chat. */
export const LIVE_SESSION_END_MS = 2 * 60 * 1000;
