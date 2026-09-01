/**
 * Mux live ingest + playback.
 * Stream key stays in the Mux dashboard / Restream custom RTMP — never commit it.
 */
export const LIVE_STREAM_ID = 'O6f9TGui400kDQY023IAtlKjfmXctYy1YcAUofPyHHGql';
export const LIVE_PLAYBACK_ID = 'kyG01vdLgiolO005FBlZ01TVrAXouGc4U9FK238N82QZ7E';

export const LIVE_HLS_URL = `https://stream.mux.com/${LIVE_PLAYBACK_ID}.m3u8`;
export const LIVE_POSTER_URL = `https://image.mux.com/${LIVE_PLAYBACK_ID}/thumbnail.jpg`;

export const LIVE_TITLE = 'PODPLAYR Live';
export const LIVE_POLL_MS = 12_000;

export const LIVE_CHAT_COLLECTION = 'live_chat';
export const LIVE_CHAT_MAX_LEN = 200;
export const LIVE_CHAT_PAGE_SIZE = 60;
export const LIVE_CHAT_RATE_MS = 2_000;
