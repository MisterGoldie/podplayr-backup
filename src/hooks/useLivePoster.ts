'use client';

import { livePosterUrl } from '../data/liveStream';

/** Poster follows live status immediately — no Will art while Mux is down. */
export function useLivePoster(online: boolean) {
  return livePosterUrl({ online });
}
