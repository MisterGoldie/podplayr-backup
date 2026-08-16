'use client';

import {
  attachAdPreload,
  destroyAdPreloadHls,
} from './adHls';

export interface AdConfig {
  video: string;
  muxPlaybackId?: string;
  url?: string;
  title?: string;
  domain?: string;
  isVertical: boolean;
}

export const AD_CONFIG: AdConfig[] = [
  {
    video: '/ad-video.mp4',
    muxPlaybackId: 'ULNyr2IX1KG02LYrs1G9XYVpz7yDObvTsVKbywLPxStc',
    isVertical: false,
  },
  {
    video: '/ad-video-2.mp4',
    muxPlaybackId: '3Yl301rZXh3hQHSGKdE02oM4sHaoZJKvsgGLBP4RIgpaU',
    url: 'https://acyl.world',
    title: 'ACYL Radio',
    domain: 'acyl.world',
    isVertical: false,
  },
  {
    video: '/ad-video-3.mp4',
    muxPlaybackId: '4EaSn1MrvxCvp8AeAHO7QjlNcbNdwOPxYh00S6dE2xs4',
    url: 'https://acyl.world/TV',
    title: 'Art House',
    domain: 'acyl.world/TV',
    isVertical: false,
  },
  {
    video: '/ad-video-4.mp4',
    muxPlaybackId: '3qEMFW814VLn7epTQiUndqJtoWTDwNvYvjhNx00Qakac',
    url: 'https://www.coinbase.com/',
    title: 'More Bitcoin',
    domain: 'coinbase.com/learn',
    isVertical: false,
  },
  {
    video: '/ad-video-5.mp4',
    muxPlaybackId: 'eVJShLbLQviolrNNOhBE3GEl4cnz3iQdRYeOGy00oljw',
    url: 'https://acyl.world',
    title: 'ACYL Radio',
    domain: 'acyl.world',
    isVertical: true,
  },
  {
    video: '/ad-video-6.mp4',
    muxPlaybackId: 'bD6l1wNcV00O1IcYA00jJrWwl8vjsDdFd4UcEfI3ZWFKQ',
    url: 'https://acyl.world',
    title: 'ACYL',
    domain: 'acyl.world',
    isVertical: true,
  },
  {
    video: '/podplayrad1.mp4',
    muxPlaybackId: '6tkXB00ydCjRjP87w02VGeKzSr8AQqLcq00OEUuCmG6P02c',
    isVertical: false,
  },
];

let adBag: AdConfig[] = [];
let lastAdVideo: string | null = null;
let preloadVideo: HTMLVideoElement | null = null;
let pendingClaim: HTMLVideoElement | null = null;
let idlePreloadHandle: number | null = null;

function shuffleAds(ads: AdConfig[]): AdConfig[] {
  const copy = [...ads];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function isVideoFormatSupported(videoPath: string) {
  if (typeof document === 'undefined') return true;
  const video = document.createElement('video');
  const ext = videoPath.split('.').pop() || '';
  return video.canPlayType(`video/${ext}`) !== '';
}

function supportedAds() {
  const ads = AD_CONFIG.filter((ad) => isVideoFormatSupported(ad.video));
  return ads.length > 0 ? ads : AD_CONFIG;
}

function fillBag() {
  if (adBag.length > 0) return;
  adBag = shuffleAds(supportedAds());
  if (lastAdVideo && adBag.length > 1 && adBag[0].video === lastAdVideo) {
    const [first, ...rest] = adBag;
    adBag = [...rest, first];
  }
}

export function adPlaybackUrl(ad: AdConfig) {
  return ad.video;
}

function parkPreloadVideo(video: HTMLVideoElement) {
  video.id = 'podplayr-ad-preload';
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText =
    'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;z-index:-1;border:0;';
}

function ensurePreloadElement() {
  if (typeof document === 'undefined') return null;
  if (preloadVideo && preloadVideo.isConnected) return preloadVideo;
  const video = document.createElement('video');
  parkPreloadVideo(video);
  document.body.appendChild(video);
  preloadVideo = video;
  return video;
}

function loadIntoPreloader(ad: AdConfig) {
  const video = ensurePreloadElement();
  if (!video) return;
  if (video.getAttribute('data-ad-key') === ad.video && video.readyState >= 1) return;

  video.muted = true;
  video.preload = 'auto';
  try {
    video.pause();
  } catch {
    // ignore
  }
  video.setAttribute('data-ad-key', ad.video);
  void attachAdPreload(video, adPlaybackUrl(ad)).catch(() => {
    destroyAdPreloadHls();
    video.src = ad.video;
    video.load();
  });
}

export function peekNextAd(): AdConfig {
  fillBag();
  return adBag[0] ?? AD_CONFIG[0];
}

export function takeNextAd(): AdConfig {
  fillBag();
  const ad = adBag.shift() ?? supportedAds()[0] ?? AD_CONFIG[0];
  lastAdVideo = ad.video;
  if (preloadVideo?.getAttribute('data-ad-key') === ad.video) {
    pendingClaim = preloadVideo;
    preloadVideo = null;
  }
  return ad;
}

export function claimPreloadedAdVideo(): HTMLVideoElement | null {
  const video = pendingClaim;
  pendingClaim = null;
  if (!video) return null;
  try {
    video.pause();
    if (video.currentTime > 0.15) video.currentTime = 0;
  } catch {
    // ignore seek failures on partial buffers
  }
  video.removeAttribute('id');
  video.muted = false;
  video.removeAttribute('aria-hidden');
  return video;
}

/** Buffer the upcoming preroll without using the NFT HLS singleton. */
export function preloadUpcomingAd() {
  if (typeof window === 'undefined') return;
  loadIntoPreloader(peekNextAd());
}

export function preloadUpcomingAdWhenIdle() {
  if (typeof window === 'undefined') return;
  if (idlePreloadHandle !== null) return;
  const start = () => {
    idlePreloadHandle = null;
    preloadUpcomingAd();
  };
  const win = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  if (typeof win.requestIdleCallback === 'function') {
    idlePreloadHandle = win.requestIdleCallback(start, { timeout: 2500 });
  } else {
    idlePreloadHandle = window.setTimeout(start, 400);
  }
}
