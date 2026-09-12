import { getActiveMainMedia } from './activeMainMedia';
import { playbackDebug } from '../utils/playbackDebug';

let webAudioUnlock: AudioContext | null = null;

/** Resume Web Audio on a tap so later NFT play() is still allowed in WKWebView. */
export function unlockPlaybackAudioSession() {
  if (typeof window === 'undefined') return;
  try {
    const Ctor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) {
      if (!webAudioUnlock) webAudioUnlock = new Ctor();
      if (webAudioUnlock.state === 'suspended') {
        void webAudioUnlock.resume();
      }
      const buffer = webAudioUnlock.createBuffer(1, 1, 22050);
      const source = webAudioUnlock.createBufferSource();
      source.buffer = buffer;
      source.connect(webAudioUnlock.destination);
      source.start(0);
    }
  } catch {
    // ignore
  }
  const clock = getActiveMainMedia();
  if (clock) {
    clock.muted = false;
    if (clock.volume === 0) clock.volume = 0.7;
  }
}

export function ensureMediaAudible(media: HTMLMediaElement | null | undefined) {
  if (!media) return;
  media.muted = false;
  if (media.volume === 0) media.volume = 0.7;
}

/** 44-byte silent WAV. An element with no source rejects play() immediately,
 *  and a rejected call does not count as activation — so there has to be
 *  something real to play. The attempt overwrites this moments later. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA=';

/** Cleared before the silent play so the outgoing track's handlers cannot see
 *  it. A zero-length buffer fires `ended` the instant it starts, which would
 *  otherwise look like the previous song finishing and auto-advance the queue. */
const MEDIA_HANDLER_PROPS = [
  'onerror',
  'onloadedmetadata',
  'ondurationchange',
  'oncanplay',
  'onwaiting',
  'onstalled',
  'onplaying',
  'ontimeupdate',
  'onplay',
  'onpause',
  'onseeking',
  'onseeked',
  'onended',
  'onvolumechange',
] as const;

/**
 * Spend the user's tap on the media element before the handler awaits anything.
 *
 * iOS grants playback per element on a real gesture and revokes it across an
 * await. Desktop Chrome grants it from the Media Engagement Index instead and
 * never revokes it, which is why a track that needs a blocking enrich or MIME
 * probe starts instantly on a laptop and hangs on a phone. Playing a silent
 * buffer here marks the element user-activated, so the real play() later in
 * the attempt is allowed however long that work took.
 *
 * Distinct from unlockPlaybackAudioSession above, which unlocks the Web Audio
 * AudioContext — a separate permission that does not cover HTMLMediaElement.
 */
export function claimMediaGesture(media: HTMLMediaElement | null | undefined) {
  if (!media) return;
  try {
    for (const prop of MEDIA_HANDLER_PROPS) {
      (media as unknown as Record<string, unknown>)[prop] = null;
    }
    media.muted = false;
    media.src = SILENT_WAV;
    const played = media.play();
    if (played) void played.catch(() => {});
  } catch {
    // Best effort — a refusal here just leaves the old behavior in place.
  }
}

function pauseEl(el: HTMLMediaElement) {
  try {
    el.pause();
  } catch {
    // ignore
  }
}

/**
 * Ads (and the 1px muted preloader) must not keep playing after the preroll.
 * A muted <video> that is still "playing" in WKWebView silences every other
 * element until the page is reloaded.
 */
export function stopExclusiveAdMedia() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLMediaElement>('[data-podplayr-ad]').forEach((el) => {
    pauseEl(el);
    el.autoplay = false;
  });
  playbackDebug('audio-session:stop-ads');
}

/** Park the NFT <audio> in the document so iOS does not drop a detached Audio(). */
export function mountClockAudioElement(audio: HTMLAudioElement) {
  if (typeof document === 'undefined' || audio.isConnected) return;
  audio.setAttribute('playsinline', 'true');
  audio.setAttribute('webkit-playsinline', 'true');
  audio.setAttribute('aria-hidden', 'true');
  audio.setAttribute('data-podplayr-clock', 'audio');
  audio.style.cssText =
    'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;z-index:-1;border:0;';
  document.body.appendChild(audio);
}
