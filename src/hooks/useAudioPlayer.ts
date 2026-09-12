import { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { NFT } from '../types/user';
import { trackNFTPlay as originalTrackNFTPlay, recordRecentPlay } from '../lib/firebase';
import { v4 as uuidv4 } from 'uuid';

// Wrapper for trackNFTPlay that respects the 25% threshold requirement
// This is a global variable to track which NFTs have been played immediately
const immediatelyTrackedNFTs = new Set<string>();

// This function wraps the original trackNFTPlay to implement the 25% threshold logic
const trackNFTPlay = (nft: NFT, fid: number, options?: { forceTrack?: boolean, thresholdReached?: boolean }) => {
  // CRITICAL: Use mediaKey as the primary identifier for this NFT
  // This ensures identical content is tracked together regardless of contract/tokenId
  const mediaKey = nft.mediaKey || getMediaKey(nft);
  // For backwards compatibility, also track the legacy nftKey
  const legacyNftKey = `${nft.contract}-${nft.tokenId}`;
  
  // If this is an immediate tracking call (from handlePlayAudio) and not forced
  if (!options?.forceTrack && !options?.thresholdReached) {
    // Just mark this NFT as having been immediately tracked
    // Add both mediaKey and legacy key to support transition
    if (mediaKey) immediatelyTrackedNFTs.add(mediaKey);
    immediatelyTrackedNFTs.add(legacyNftKey);
    audioLogger.info(`Skipping immediate play tracking for NFT: ${nft.name} - will track at 25% threshold`);
    return Promise.resolve(); // Return a resolved promise to maintain the same interface
  }
  
  // If we're tracking because threshold was reached, or it's forced
  if (options?.thresholdReached || options?.forceTrack) {
    // Actually track the play
    audioLogger.info(`${options?.thresholdReached ? '25% threshold reached' : 'Forced tracking'} - Recording play count for NFT: ${nft.name}`);
    return originalTrackNFTPlay(nft, fid, options);
  }
  
  // Default case - shouldn't happen but included for completeness
  return Promise.resolve();
};
import {
  getMediaKey,
  buildFastPlaybackUrls,
  canonicalizeArweaveGatewayUrl,
  nextArweavePlaybackIndex,
  arweaveGatewayApexHost,
  parseArweaveMediaPath,
  toArweaveRawUrl,
  probeAudioHead,
  abortMediaElement,
  ensurePlaybackVideoElement,
  playbackVideoElementId,
  releaseOrphanPlaybackVideos,
  shouldProbeIpfsDirectory,
  listIpfsDirectoryVideoFile,
  extractIPFSPath,
  FIRST_BYTE_FAILOVER_MS,
  HLS_FIRST_BYTE_FAILOVER_MS,
  ARWEAVE_FIRST_BYTE_FAILOVER_MS,
  IPFS_KNOWN_MEDIA_FAILOVER_MS,
  IPFS_DIR_FAILOVER_MS,
  MEDIA_BYTES_RECHECK_MS,
  MEDIA_BYTES_MAX_WAIT_MS,
  MEDIA_BYTES_STALL_TICKS,
  MAX_PLAYBACK_CANDIDATES,
  PLAYBACK_GIVE_UP_MS,
  DEAD_PROBE_FAILOVER_MS,
  PROVEN_ALT_FAILOVER_MS,
  clearNftMediaUrlCache,
} from '../utils/media';
import { resolveCdnPlaybackUrls, isOrphanMuxPlaybackUrl, isMuxPlaybackUrl, isPollutedPlaybackUrl, isWeakPlaybackUrl, isMezzanineMuxUrl, alchemyVideoFetchMp4Url, isAlchemyVideoFetchMp4Url } from '../lib/mediaCdn';
import { attachPlaybackSource, attachProgressivePlaybackSource, detachHlsPlayback, isHlsAttached, isHlsUrl, pauseHlsBuffering, resumeHlsBuffering, seekAttachedMedia } from '../lib/hlsPlayback';
import { setActiveMainMedia, getActiveMainMedia, pauseActiveMainMedia } from '../lib/activeMainMedia';
import {
  ensureMediaAudible,
  mountClockAudioElement,
  unlockPlaybackAudioSession,
  claimMediaGesture,
} from '../lib/playbackAudioSession';
import { restorePageScroll } from '../utils/pageScroll';

/** Path/host check — do not use isExtensionlessArweaveTx here (that one is for hints). */
function isArweavePlaybackUrl(url?: string | null): boolean {
  return !!url && /arweave\.net|permagate\.io|turbo-gateway\.com|(?:^|:)ar:\/\//i.test(url);
}

function isAlchemyCdnPlaybackUrl(url?: string | null): boolean {
  return !!url && /nft2?-cdn\.alchemy\.com/i.test(url);
}

/** Seconds of media actually downloaded. The only reliable "are bytes arriving" signal:
 *  a hung gateway can sit at readyState 1 forever without firing error or stalled. */
function bufferedSeconds(media: HTMLMediaElement): number {
  try {
    const ranges = media.buffered;
    return ranges.length ? ranges.end(ranges.length - 1) : 0;
  } catch {
    return 0;
  }
}

function findNftInQueue(queue: NFT[], nft: NFT): number {
  const mediaKey = nft.mediaKey || getMediaKey(nft);
  if (mediaKey) {
    const byMedia = queue.findIndex((item) => (item.mediaKey || getMediaKey(item)) === mediaKey);
    if (byMedia !== -1) return byMedia;
  }
  if (nft.contract && nft.tokenId) {
    const contract = nft.contract.toLowerCase();
    const tokenId = String(nft.tokenId);
    return queue.findIndex(
      (item) => item.contract?.toLowerCase() === contract && String(item.tokenId) === tokenId
    );
  }
  return -1;
}
import {
  applyPlaybackPlanToNft,
  getNftPlaybackPlan,
  mediaUrlNeedsMimeProbe,
  resolveNftPlaybackPlan,
  filterLivePlaybackUrls,
  rememberDeadGateway,
  isPlayableMediaNFT,
  urlLooksLike3dModel,
  urlLooksLikeImage,
  getCachedMediaMime,
  rememberMediaMime,
  rememberPlayedMediaUrl,
  forgetPlayedMediaUrl,
} from '../utils/isMediaNFT';
import { logger } from '../utils/logger';
import { useToast } from './useToast';
import { reviveNftMedia } from '../utils/deadNftRegistry';
import { enrichNftMediaFromChain, isIpfsPlaybackUrl, ipfsUrlNeedsDirectoryResolve, isOnChainNftIdentity, nftNeedsChainMediaEnrich, collectNftOriginPlaybackUrls, alchemyAnimationUrlFromCover } from '../lib/nft';
import { coerceIpfsUrl, isExtensionlessArweaveTx } from '../utils/ipfsExtensionlessMedia';
import { withFeaturedPlayback } from '../data/featuredNfts';
import { mediaDebugSnapshot, playbackDebug } from '../utils/playbackDebug'; // TEMP — remove with playbackDebug.ts
import { emitPlayCountBump } from '../lib/playCountEvents';

// Create a dedicated logger for this module
const audioLogger = logger.getModuleLogger('audioPlayer');

/** Backoff after a failed play-count write, since timeupdate fires ~4x/sec. */
const PLAY_TRACK_RETRY_COOLDOWN_MS = 10000;

// Extend Window interface to include our custom property
declare global {
  interface Window {
    nftList: NFT[];
    /** TEMP test harness — see the play:hang-harness block in handlePlayAudio. */
    __PODPLAYR_HANG_FIRST_URL?: boolean | string;
  }
}

export interface UseAudioPlayerProps {
  fid?: number;
}

type UseAudioPlayerReturn = {
  isPlaying: boolean;
  currentPlayingNFT: NFT | null;
  currentlyPlaying: string | null;
  audioProgress: number;
  audioDuration: number;
  handlePlayAudio: (nft: NFT, context?: { queue?: NFT[]; queueType?: string; autoplay?: boolean }) => Promise<void>;
  handlePlayPause: () => void;
  handlePlayNext: () => void;
  handlePlayPrevious: () => void;
  handleSeek: (time: number) => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

type AudioPlayerHandles = {
  play: () => void;
  pause: () => void;
  ended: () => void;
  loadedmetadata: () => void;
  timeupdate: () => void;
}

export const useAudioPlayer = ({ fid = 1 }: UseAudioPlayerProps = {}): UseAudioPlayerReturn => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPlayingNFT, setCurrentPlayingNFT] = useState<NFT | null>(null);
  const [currentlyPlaying, setCurrentlyPlaying] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [currentQueue, setCurrentQueue] = useState<NFT[]>([]);
  const [queueType, setQueueType] = useState<string>('default');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentFallbackIndex, setCurrentFallbackIndex] = useState<number>(0);
  const [error, setError] = useState<Error | null>(null);
  const [fallbackUrls, setFallbackUrls] = useState<string[]>([]);
  const fallbackStateRef = useRef({
    currentIndex: 0,
    urls: [] as string[]
  });
  const { error: showErrorToast } = useToast();

  const fidRef = useRef(fid ?? 1);
  fidRef.current = fid ?? 1;
  const currentPlayingNftRef = useRef<NFT | null>(null);
  currentPlayingNftRef.current = currentPlayingNFT;
  const playAttemptRef = useRef(0);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Survives gateway hops — only a real clock or a new tap clears it. */
  const giveUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visualPlaybackRef = useRef<HTMLVideoElement | null>(null);

  const handleError = useCallback((e: Event) => {
    const target = e.target as HTMLAudioElement;
    const error = target.error;
    const errorMessage = error ? `Error ${error.code}: ${error.message}` : 'Unknown error';
    logger.error('Audio error:', errorMessage, {
      currentSrc: target.currentSrc,
      networkState: target.networkState,
      readyState: target.readyState
    });
  }, [logger]);

  // Update fallback URLs when they change
  useEffect(() => {
    fallbackStateRef.current.urls = fallbackUrls;
    fallbackStateRef.current.currentIndex = 0;
  }, [fallbackUrls]);

  useEffect(() => {
    if (!audioRef.current) return;

    // Add error handler to log audio errors
    audioRef.current.addEventListener('error', handleError);
    
    return () => {
      if (audioRef.current) {
        audioRef.current.removeEventListener('error', handleError);
      }
    };
  }, [handleError]);

  useEffect(() => {
    // Initialize the audio element if it doesn't exist
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = 'auto';
      audioLogger.info('Created new audio element');
    }
    mountClockAudioElement(audioRef.current);
    
    const audio = audioRef.current;
    if (!audio) return;

    const updateProgress = () => {
      if (visualPlaybackRef.current) return;
      if (Number.isFinite(audio.currentTime)) {
        setAudioProgress(Math.floor(audio.currentTime * 10) / 10);
      }
      // 0/NaN/Infinity after a gateway hop must not wipe a probed WAV length.
      if (Number.isFinite(audio.duration) && audio.duration > 1) {
        setAudioDuration(Math.floor(audio.duration * 10) / 10);
      }
    };

    const handleLoadedMetadata = () => {
      audioLogger.info('Audio metadata loaded:', {
        duration: audio.duration,
        currentTime: audio.currentTime
      });
      if (Number.isFinite(audio.duration) && audio.duration > 1) {
        setAudioDuration(audio.duration);
      }
      if (Number.isFinite(audio.currentTime)) {
        setAudioProgress(audio.currentTime);
      }
    };

    const handleDurationChange = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 1) {
        setAudioDuration(audio.duration);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setAudioProgress(0);
    };
    
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', updateProgress);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const handlePlayPause = useCallback(() => {
    if (!audioRef.current) return;
    const clock =
      visualPlaybackRef.current ||
      audioRef.current;

    const video =
      currentPlayingNFT
        ? (document.getElementById(
            `video-${currentPlayingNFT.contract}-${currentPlayingNFT.tokenId}`
          ) as HTMLVideoElement | null)
        : visualPlaybackRef.current;

    playbackDebug('handlePlayPause:tap', {
      isPlaying,
      clockPaused: clock.paused,
      clock: mediaDebugSnapshot(clock),
      video: video && video !== clock ? mediaDebugSnapshot(video) : 'same-as-clock',
    });

    if (isPlaying || !clock.paused) {
      clock.pause();
      if (video && video !== clock) video.pause();
      setIsPlaying(false);
    } else {
      unlockPlaybackAudioSession();
      ensureMediaAudible(clock);
      setIsPlaying(true);
      clock.play().catch((error) => {
        audioLogger.error('Error in handlePlayPause:', error);
        playbackDebug('handlePlayPause:play-error', {
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        setIsPlaying(false);
      });
      if (video && video !== clock) {
        video.muted = true;
        video.play().catch(() => {});
      }
    }
  }, [isPlaying, currentPlayingNFT]);

  // Track blob URLs to clean up
  const blobUrlsRef = useRef<string[]>([]);
  
  // Function to clean up blob URLs
  const cleanupBlobUrls = useCallback(() => {
    blobUrlsRef.current.forEach(url => {
      try {
        URL.revokeObjectURL(url);
        audioLogger.info('Revoked blob URL:', url);
      } catch (error) {
        audioLogger.error('Error revoking blob URL:', error);
      }
    });
    blobUrlsRef.current = [];
  }, []);
  
  // Clean up resources when component unmounts
  useEffect(() => {
    return () => {
      cleanupBlobUrls();
    };
  }, [cleanupBlobUrls]);
  
  // Define handlePlayAudio first, before it's used in other functions
  const handlePlayAudio = useCallback(async (nft: NFT, context?: { queue?: NFT[], queueType?: string, autoplay?: boolean }) => {

    // Add mobile optimization
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    // Browsers block .play() without a real user gesture (e.g. loading a
    // shared link on mount) — calling it anyway just throws NotAllowedError
    // and leaves the media looking "frozen". Callers without a gesture (deep
    // links) pass autoplay:false to load/prepare the track and let the
    // user's first tap on the play button provide the gesture instead.
    const shouldAutoplay = context?.autoplay !== false;
    unlockPlaybackAudioSession();
    ensureMediaAudible(visualPlaybackRef.current || audioRef.current);

    // Always update queue context
    if (context?.queue) {
      setCurrentQueue(context.queue);
      setQueueType(context.queueType || 'default');
      window.nftList = context.queue;
    } else if (Array.isArray(window.nftList) && window.nftList.length > 0) {
      setCurrentQueue(window.nftList);
    } else if (!currentQueue.length) {
      setCurrentQueue([nft]);
      setQueueType('single');
    }
    audioLogger.info('handlePlayAudio called with NFT:', nft);

    // Reminted featured episodes (other contract / Pinata metadata) → curated Arweave + Mux.
    const featuredHydrated = withFeaturedPlayback(nft);
    if (featuredHydrated !== nft) {
      Object.assign(nft, featuredHydrated);
    }

    playbackDebug('play:start', {
      name: nft.name,
      contract: nft.contract,
      tokenId: String(nft.tokenId),
      network: nft.network,
      isVideo: nft.isVideo,
      playbackMode: nft.playbackMode,
      hasValidAudio: nft.hasValidAudio,
      audio: nft.audio,
      videoUrl: nft.videoUrl,
      animationUrl: nft.metadata?.animation_url || nft.animationUrl,
      mime: nft.metadata?.mimeType || nft.metadata?.mime_type,
      mediaKey: nft.mediaKey,
      build: 'force-wav-2',
    });

    // Pause/resume must not wait on Alchemy or MIME probes.
    if (currentlyPlaying === `${nft.contract}-${nft.tokenId}`) {
      const clock = visualPlaybackRef.current || audioRef.current;
      const atEnd = Boolean(
        clock &&
          (clock.ended ||
            (Number.isFinite(clock.duration) &&
              clock.duration > 0 &&
              clock.currentTime >= clock.duration - 0.35))
      );
      if (!atEnd) {
        audioLogger.info('Same NFT clicked, toggling play/pause');
        handlePlayPause();
        return;
      }
    }

    reviveNftMedia(nft, 'audio');

    // Cut the current track immediately. Enrich/probe used to run first, so
    // the previous video kept rolling for seconds after a new card click.
    if (currentlyPlaying && currentlyPlaying !== `${nft.contract}-${nft.tokenId}`) {
      pauseActiveMainMedia();
      const clock = visualPlaybackRef.current || audioRef.current;
      if (clock && !clock.paused) clock.pause();
    }

    // Invalidate the previous play() AbortError retries / failover timers
    // before await enrich — otherwise Part One keeps kicking while Part Three starts.
    playAttemptRef.current += 1;
    const playAttempt = playAttemptRef.current;
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    if (failoverTimerRef.current) {
      clearTimeout(failoverTimerRef.current);
      failoverTimerRef.current = null;
    }
    if (giveUpTimerRef.current) {
      clearTimeout(giveUpTimerRef.current);
      giveUpTimerRef.current = null;
    }

    // Last point before the handler can await. Enrich and the MIME probe below
    // both block, and on iOS that await is what costs us the tap — the element
    // is still allowed to play here and will not be by the time we have a URL.
    // Claim it now on the elements the attempt might use. The old track is
    // already paused above, so overwriting the source costs nothing.
    if (shouldAutoplay) {
      claimMediaGesture(audioRef.current);
      if (visualPlaybackRef.current) claimMediaGesture(visualPlaybackRef.current);
      playbackDebug('play:gesture-claimed', { name: nft.name });
    }

    // Likes / recently-played often store raw IPFS URLs. When public gateways
    // hang or 404, Alchemy still has cached CDN copies — refresh via /api/nft.
    // Also force enrich when playback is orphan Mux / broken Alchemy HLS so we
    // recover the real Arweave/IPFS origin before building the URL list.
    let playNft = nft;
    const playbackFields = [
      nft.audio,
      nft.videoUrl,
      nft.animationUrl,
      nft.metadata?.animation_url,
    ];
    const needsPlaybackRecovery = playbackFields.some((u) => isWeakPlaybackUrl(u));
    const needsIpfsPlaybackRefresh = playbackFields.some((u) => isIpfsPlaybackUrl(u));
    const hasOriginSibling = collectNftOriginPlaybackUrls(nft).length > 0;
    const alchemyAnimationOnly =
      playbackFields.some((u) => !!u && /nft2?-cdn\.alchemy\.com/i.test(u) && /_animation/i.test(u)) &&
      playbackFields.filter(Boolean).every((u) => !u || /nft2?-cdn\.alchemy\.com/i.test(u));
    const looksLikeVideoNft =
      nft.isVideo ||
      nft.playbackMode === 'video-with-audio' ||
      nft.playbackMode === 'video-plus-audio';
    const hasReadyPlayback = playbackFields.some((u) => {
      if (
        !u ||
        isWeakPlaybackUrl(u) ||
        ipfsUrlNeedsDirectoryResolve(u) ||
        (alchemyAnimationOnly && !hasOriginSibling)
      ) {
        return false;
      }
      if (isMuxPlaybackUrl(u)) return true;
      if (/\.(mp3|wav|m4a|aac|ogg|flac|mp4|webm|mov|m4v)(?:\?|#|$)/i.test(u)) return true;
      if (/nft2?-cdn\.alchemy\.com|raw2?\.seadn\.io|arweave\.net|turbo-gateway\.com/i.test(u)) {
        return true;
      }
      // Pinata HTTPS is tap-ready for video (Relic). Extensionless audio CIDs
      // hang in WKWebView — wait for Alchemy `_animation` instead.
      if (/gateway\.pinata\.cloud|\.mypinata\.cloud/i.test(u)) {
        return looksLikeVideoNft;
      }
      return false;
    });
    const shouldBlockOnEnrich =
      needsPlaybackRecovery ||
      (!hasReadyPlayback &&
        (needsIpfsPlaybackRefresh || nftNeedsChainMediaEnrich(nft)));
    let enrichPromise: Promise<NFT> | null = null;
    if (
      isOnChainNftIdentity(nft.contract, nft.tokenId) &&
      (needsPlaybackRecovery || needsIpfsPlaybackRefresh || nftNeedsChainMediaEnrich(nft))
    ) {
      if (!shouldBlockOnEnrich) {
        // Cover / IPFS refresh can finish after play starts — don't stall the switch.
        // Gutter Punks: Pinata hangs, Alchemy `_animation` is the real mp4 —
        // inject that URL into this attempt when enrich returns.
        enrichPromise = enrichNftMediaFromChain(nft);
        playbackDebug('play:enrich-background', { name: nft.name, hasReadyPlayback: true });
      } else {
      playNft = await enrichNftMediaFromChain(nft);
      const recoveredUrl = [
        playNft.audio,
        playNft.videoUrl,
        playNft.metadata?.animation_url,
      ].find((u) => u && !isWeakPlaybackUrl(u) && !isPollutedPlaybackUrl(u));
      playbackDebug('play:enrich', {
        name: nft.name,
        changed:
          playNft.audio !== nft.audio ||
          playNft.videoUrl !== nft.videoUrl ||
          playNft.metadata?.animation_url !== nft.metadata?.animation_url,
        recovered: Boolean(recoveredUrl),
        audio: playNft.audio,
        videoUrl: playNft.videoUrl,
        mime: playNft.metadata?.mimeType || playNft.metadata?.mime_type,
      });
      const playbackFieldsChanged =
        playNft.audio !== nft.audio ||
        playNft.videoUrl !== nft.videoUrl ||
        playNft.metadata?.animation_url !== nft.metadata?.animation_url ||
        playNft.isVideo !== nft.isVideo ||
        playNft.playbackMode !== nft.playbackMode;
      if (playbackFieldsChanged) {
        clearNftMediaUrlCache(nft, 'image');
        clearNftMediaUrlCache(nft, 'audio');
        Object.assign(nft, {
          image: playNft.image,
          audio: playNft.audio,
          videoUrl: playNft.videoUrl,
          animationUrl: playNft.animationUrl,
          playbackMode: playNft.playbackMode,
          isVideo: playNft.isVideo,
          hasValidAudio: playNft.hasValidAudio,
          metadata: playNft.metadata,
          collection: playNft.collection,
        });
      }
      }
    }

    // Extensionless CIDs can be audio (Late #7) or video (Community.eth).
    // Probe before mounting <video>, even if metadata put the sound in animation_url.
    let plan = getNftPlaybackPlan(playNft);
    const probeUrl = plan.videoUrl || plan.audioUrl || playNft.audio;
    if (urlLooksLike3dModel(probeUrl) || urlLooksLikeImage(probeUrl) || !isPlayableMediaNFT(playNft)) {
      audioLogger.info('Skipping non-playable media NFT', { name: playNft.name, url: probeUrl });
      playbackDebug('play:skip-not-playable', {
        name: playNft.name,
        probeUrl,
        looks3d: urlLooksLike3dModel(probeUrl),
        looksImage: urlLooksLikeImage(probeUrl),
        isPlayable: isPlayableMediaNFT(playNft),
        plan,
      });
      showErrorToast(`"${playNft.name || 'This NFT'}" isn't playable audio or video.`);
      return;
    }
    const knownMime = String(
      playNft.metadata?.mimeType || playNft.metadata?.mime_type || ''
    ).toLowerCase();
    const cachedMime = (
      getCachedMediaMime(probeUrl) ||
      knownMime
    ).toLowerCase();
    // Never skip a probe just because the host is Alchemy CDN — Rodeo (and
    // others) stuff a raw video/mp4 onto an extensionless nft2-cdn hash.
    // Skipping that HEAD left those tokens stuck audio-only with a still
    // in the maximized player. Only trust a cached audio mime when the URL
    // itself looks like audio (Late #7).
    // `wave` is the spelling Arweave gateways actually return for a WAV, and
    // leaving it out meant an already-known audio/wave was not trusted — so an
    // audio-only Arweave track burned a blocking HEAD to be told what it knew
    // ("from: audio-only-or-unknown, to: audio-only"). The sibling list in
    // isMediaNFT already includes it, and hlsPlayback remaps it to audio/wav.
    const trustedAudioMime =
      /^audio\/(wav|x-wav|wave|mpeg|mp3|mp4|m4a|aac|ogg|flac|webm)(?:;|$)/i.test(knownMime) &&
      !playNft.isVideo &&
      playNft.playbackMode !== 'video-with-audio' &&
      playNft.playbackMode !== 'video-plus-audio';
    const skipMimeProbe =
      cachedMime.startsWith('video/') ||
      trustedAudioMime ||
      (cachedMime.startsWith('audio/') && /\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i.test(probeUrl || ''));
    // Extensionless IPFS/Alchemy hashes classified audio-only must always
    // probe — a stale generic audio/* used to skip this and leave real
    // videos (Dumpster Fire) on the <audio> + still path. Specific types
    // like audio/wav on a bonus track are trusted (Hot Coffee).
    const mustProbeAudioOnly =
      plan.mode === 'audio-only' &&
      !trustedAudioMime &&
      !cachedMime.startsWith('video/') &&
      mediaUrlNeedsMimeProbe(probeUrl) &&
      !/\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i.test(probeUrl || '');
    if ((mediaUrlNeedsMimeProbe(probeUrl) && !skipMimeProbe) || mustProbeAudioOnly) {
      // Awaiting HEAD here drops the iOS tap gesture. If metadata already
      // routed this as video-with-audio, play now and probe in the background.
      if (plan.mode === 'video-with-audio' && plan.videoUrl) {
        void resolveNftPlaybackPlan(playNft);
        playbackDebug('play:probe-deferred', {
          name: playNft.name,
          probeUrl,
          planMode: plan.mode,
        });
      } else {
        plan = await resolveNftPlaybackPlan(playNft);
        playbackDebug('play:probed', {
          name: playNft.name,
          from: 'audio-only-or-unknown',
          to: plan.mode,
          probeUrl,
          knownMime,
          cachedMime,
        });
      }
    } else if (
      cachedMime.startsWith('video/') &&
      plan.mode === 'audio-only' &&
      (plan.audioUrl || probeUrl)
    ) {
      const videoUrl = plan.audioUrl || probeUrl || null;
      plan = {
        mode: 'video-with-audio',
        audioUrl: videoUrl,
        videoUrl,
        muteVideo: false,
      };
    }
    applyPlaybackPlanToNft(playNft, plan);
    applyPlaybackPlanToNft(nft, plan);
    if (plan.mode === 'audio-only' && plan.audioUrl) {
      const stamp = String(
        playNft.metadata?.mimeType || playNft.metadata?.mime_type || ''
      ).toLowerCase();
      if (stamp.startsWith('audio/')) {
        rememberMediaMime(plan.audioUrl, stamp);
      }
    }
    if (!plan.audioUrl && !plan.videoUrl) {
      playbackDebug('play:skip-empty-plan', { name: playNft.name, plan, probeUrl, knownMime });
      showErrorToast(`"${playNft.name || 'This NFT'}" isn't playable audio or video.`);
      return;
    }
    audioLogger.info('NFT playback plan:', {
      mode: plan.mode,
      audioUrl: plan.audioUrl?.slice(0, 80),
      videoUrl: plan.videoUrl?.slice(0, 80),
      name: playNft.name,
    });

    // Sound source: dedicated audio, or the video file's audio track.
    // Skip orphan Mux / broken Alchemy HLS — only intentional PLAYBACK_OVERRIDES
    // may use stream.mux.com; daily Arweave journals must play the origin.
    const playbackCandidates = [
      plan.audioUrl,
      playNft.audio,
      plan.videoUrl,
      playNft.videoUrl,
      playNft.metadata?.animation_url,
      playNft.animationUrl,
    ]
      .map((url) => (typeof url === 'string' ? coerceIpfsUrl(url) : url))
      .filter(
        (url): url is string =>
          Boolean(url) && !urlLooksLike3dModel(url) && !urlLooksLikeImage(url)
      );
    const originCandidates = playbackCandidates.filter((url) => !isPollutedPlaybackUrl(url));
    const strongOrigins = originCandidates.filter((url) => !isWeakPlaybackUrl(url));
    const orphanMux = playbackCandidates.find((url) => isOrphanMuxPlaybackUrl(url));
    const weakMezzanine = playbackCandidates.find((url) => isMezzanineMuxUrl(url));
    const alchemyOrigin = strongOrigins.find((u) => /nft2?-cdn\.alchemy\.com/i.test(u));
    let rawAudioUrl = alchemyOrigin || strongOrigins[0] || '';

    // Only polluted/weak URLs left (expired mezzanine, dead orphan Mux) — fail cleanly.
    if (!rawAudioUrl) {
      audioLogger.error('No usable origin audio URL for NFT', {
        name: playNft.name,
        candidates: playbackCandidates,
      });
      playbackDebug('play:no-raw-url', {
        name: playNft.name,
        plan,
        playbackCandidates,
        strippedOrphanMux: orphanMux || null,
        expiredMezzanine: weakMezzanine || null,
      });
      const expiredMux =
        weakMezzanine ||
        playbackCandidates.some((url) => isMezzanineMuxUrl(url) || isOrphanMuxPlaybackUrl(url));
      showErrorToast(
        expiredMux
          ? `"${playNft.name || 'This NFT'}" video link expired — only Arweave-hosted days still play.`
          : `"${playNft.name || 'This NFT'}" isn't playable right now.`
      );
      return;
    }

    if ((orphanMux || weakMezzanine) && strongOrigins[0]) {
      playbackDebug('play:strip-weak-playback', {
        name: playNft.name,
        orphanMux: orphanMux || null,
        mezzanine: weakMezzanine || null,
        origin: strongOrigins[0],
      });
      // Scrub polluted/weak fields so the next click / Firebase write isn't mux.
      const scrub = (url?: string) =>
        url && isWeakPlaybackUrl(url) ? strongOrigins[0] : url;
      playNft.audio = scrub(playNft.audio) || strongOrigins[0];
      nft.audio = scrub(nft.audio) || strongOrigins[0];
      playNft.videoUrl = scrub(playNft.videoUrl) || strongOrigins[0];
      nft.videoUrl = scrub(nft.videoUrl) || strongOrigins[0];
      if (playNft.metadata) {
        playNft.metadata.animation_url =
          scrub(playNft.metadata.animation_url) || strongOrigins[0];
      }
      if (nft.metadata) {
        nft.metadata.animation_url =
          scrub(nft.metadata.animation_url) || strongOrigins[0];
      }
      rawAudioUrl = strongOrigins[0];
    }
    
    const audioUrls = buildFastPlaybackUrls(rawAudioUrl, {
      contract: playNft.contract,
      network: playNft.network,
      kind: plan.mode === 'audio-only' ? 'audio' : 'media',
    });
    // Always try Alchemy CDN first when enrich provided a *real* video cache
    // (not a broken …_animation HLS stub).
    if (
      playNft.videoUrl &&
      /alchemy\.com/i.test(playNft.videoUrl) &&
      !isMuxPlaybackUrl(playNft.videoUrl) &&
      !isPollutedPlaybackUrl(playNft.videoUrl)
    ) {
      audioUrls.unshift(playNft.videoUrl);
    } else if (
      playNft.audio &&
      /alchemy\.com/i.test(playNft.audio) &&
      !isMuxPlaybackUrl(playNft.audio) &&
      !isPollutedPlaybackUrl(playNft.audio)
    ) {
      audioUrls.unshift(playNft.audio);
    }
    // Alchemy `_animation` can  NotSupportedError (HLS stub / incomplete
    // ingest). Keep the on-chain origin as the next hop — do not of:1.
    for (const origin of collectNftOriginPlaybackUrls(playNft)) {
      if (!originCandidates.includes(origin)) originCandidates.push(origin);
    }
    // Extra origin gateways when raw was scrubbed from mux.
    let originBuilds = 1;
    for (const origin of originCandidates) {
      if (origin === rawAudioUrl || isMuxPlaybackUrl(origin)) continue;
      originBuilds += 1;
      for (const u of buildFastPlaybackUrls(origin, {
        contract: playNft.contract,
        network: playNft.network,
        kind: plan.mode === 'audio-only' ? 'audio' : 'media',
      })) {
        if (!audioUrls.includes(u)) audioUrls.push(u);
      }
    }
    if (audioUrls.length === 0) {
      audioLogger.error('Failed to generate any valid audio URLs', { raw: rawAudioUrl });
      playbackDebug('play:no-candidate-urls', { name: playNft.name, rawAudioUrl });
      return;
    }

    // Mux only via intentional overrides for the *origin* asset — never because
    // a polluted nft.audio already was stream.mux.com.
    const cdnUrls = originCandidates.flatMap((origin) =>
      resolveCdnPlaybackUrls(origin, { mobile: isMobile })
    ).filter((url, index, list) => list.indexOf(url) === index);
    // Trim AFTER ranking, not during the per-origin build. filterLivePlaybackUrls
    // drops dead hosts and promotes the URL that last served real bytes, so a
    // build-time slice was discarding candidates before ranking could rescue
    // them. The budget stays the same as before — MAX_PLAYBACK_CANDIDATES for
    // every origin that contributed — so no NFT loses hops it used to get.
    let playbackUrls = filterLivePlaybackUrls(
      rawAudioUrl,
      audioUrls
        .map(canonicalizeArweaveGatewayUrl)
        .filter((url, index, list) => url && list.indexOf(url) === index)
        .filter((url) => !isPollutedPlaybackUrl(url))
    ).slice(0, MAX_PLAYBACK_CANDIDATES * originBuilds);
    if (cdnUrls.length) {
      playbackUrls = [
        ...cdnUrls,
        ...playbackUrls.filter((url) => !cdnUrls.includes(url)),
      ];
    }
    // ProRes / QuickTime Alchemy caches (Variant Fellowship) fail in Chrome
    // and most WebViews. Cloudinary f_mp4 is already H.264.
    const alchemyAnimationUrl = [
      playNft.videoUrl,
      playNft.audio,
      playNft.metadata?.animation_url,
      rawAudioUrl,
      ...playbackUrls,
    ].find(
      (u): u is string =>
        !!u && /nft2?-cdn\.alchemy\.com/i.test(u) && /_animation(?:\?|#|$)/i.test(u)
    );
    const transcodedAlchemy = alchemyAnimationUrl
      ? alchemyVideoFetchMp4Url(alchemyAnimationUrl)
      : null;
    const alchemyPlaybackMime = (
      getCachedMediaMime(alchemyAnimationUrl || '') ||
      playNft.metadata?.mimeType ||
      playNft.metadata?.mime_type ||
      ''
    ).toLowerCase();
    if (
      transcodedAlchemy &&
      !playbackUrls.includes(transcodedAlchemy) &&
      plan.mode !== 'audio-only' &&
      !alchemyPlaybackMime.startsWith('audio/')
    ) {
      const alchemyMime = alchemyPlaybackMime;
      const preferTranscode =
        alchemyMime.includes('quicktime') ||
        alchemyMime.includes('prores') ||
        (alchemyMime.startsWith('video/') &&
          typeof document !== 'undefined' &&
          document.createElement('video').canPlayType(alchemyMime.split(';')[0]) === '');
      if (preferTranscode) {
        playbackUrls = [transcodedAlchemy, ...playbackUrls];
      } else if (alchemyAnimationUrl) {
        const alchemyIndex = playbackUrls.indexOf(alchemyAnimationUrl);
        playbackUrls =
          alchemyIndex === -1
            ? [transcodedAlchemy, ...playbackUrls]
            : [
                ...playbackUrls.slice(0, alchemyIndex + 1),
                transcodedAlchemy,
                ...playbackUrls.slice(alchemyIndex + 1),
              ];
      }
    }
    const arweaveOrigin =
      isArweavePlaybackUrl(rawAudioUrl) ||
      originCandidates.some((u) => isArweavePlaybackUrl(u)) ||
      playbackUrls.some((u) => isArweavePlaybackUrl(u));
    const coverAlchemy = alchemyAnimationUrlFromCover(
      playNft.image || playNft.metadata?.image || playNft.metadata?.image_url || ''
    );
    if (plan.mode === 'audio-only' && arweaveOrigin) {
      if (coverAlchemy) {
        playbackUrls = playbackUrls.filter((u) => u !== coverAlchemy);
      }
      playbackDebug('play:skip-alchemy-cover', {
        name: playNft.name,
        rawAudioUrl,
        strippedCover: coverAlchemy || null,
      });
    } else if (plan.mode === 'audio-only') {
      const originIsIpfs =
        isIpfsPlaybackUrl(rawAudioUrl) || originCandidates.some((u) => isIpfsPlaybackUrl(u));
      // Async Art: cover hash recovers the CDN MP3. Never for Arweave.
      if (originIsIpfs && coverAlchemy) {
        if (
          !playbackUrls.includes(coverAlchemy) &&
          !isPollutedPlaybackUrl(coverAlchemy) &&
          !isWeakPlaybackUrl(coverAlchemy)
        ) {
          playbackUrls = [coverAlchemy, ...playbackUrls];
          playbackDebug('play:alchemy-audio-cover', {
            name: playNft.name,
            derivedAlchemy: coverAlchemy,
          });
        }
      }
    }
    // TEMP PLAYBACK TEST HARNESS — remove with playbackDebug.ts. A healthy
    // gateway never exercises watchdogTick, so allow a deliberately broken
    // candidate to be pushed in front of the real ones from the console:
    //   window.__PODPLAYR_HANG_FIRST_URL = true        // 'frozen'
    //   window.__PODPLAYR_HANG_FIRST_URL = 'silent'    // headers, no bytes
    //   window.__PODPLAYR_HANG_FIRST_URL = 'slow'      // trickling bytes
    // The real candidates stay behind it, so a correct hop still plays.
    const hangMode = typeof window !== 'undefined' ? window.__PODPLAYR_HANG_FIRST_URL : undefined;
    if (hangMode && process.env.NODE_ENV !== 'production') {
      const mode = typeof hangMode === 'string' ? hangMode : 'frozen';
      const hangUrl = `/api/debug/hang?mode=${encodeURIComponent(mode)}&t=${Date.now()}`;
      playbackUrls = [hangUrl, ...playbackUrls];
      playbackDebug('play:hang-harness', { name: playNft.name, mode, hangUrl });
    }

    playbackDebug('play:urls', {
      name: playNft.name,
      planMode: plan.mode,
      arweaveOrigin,
      firstUrl: playbackUrls[0] || null,
      rawAudioUrl,
      playbackUrlCount: playbackUrls.length,
      playbackHosts: playbackUrls.map((u) => {
        try {
          return new URL(u).hostname;
        } catch {
          return u.slice(0, 40);
        }
      }),
      audioUrls,
      cdnUrls,
      playbackUrls,
      strippedOrphanMux: orphanMux || null,
    });

    if (audioRef.current) {
      audioLogger.info('Stopping current audio');
      abortMediaElement(audioRef.current);
      setAudioProgress(0);
      setAudioDuration(0);
    }

    detachHlsPlayback(visualPlaybackRef.current || audioRef.current);

    const previousClock = visualPlaybackRef.current;
    if (previousClock) {
      previousClock.onerror = null;
      previousClock.onplaying = null;
      previousClock.ontimeupdate = null;
      previousClock.onpause = null;
      previousClock.onended = null;
      previousClock.onplay = null;
      previousClock.onseeking = null;
      previousClock.onseeked = null;
      previousClock.onloadedmetadata = null;
      previousClock.ondurationchange = null;
      previousClock.oncanplay = null;
      previousClock.onwaiting = null;
      previousClock.onstalled = null;
      previousClock.pause();
      previousClock.removeAttribute('src');
      previousClock.load();
    } else if (currentPlayingNFT) {
      const currentVideo = document.getElementById(
        `video-${currentPlayingNFT.contract}-${currentPlayingNFT.tokenId}`
      );
      if (currentVideo instanceof HTMLVideoElement) {
        currentVideo.pause();
        currentVideo.removeAttribute('src');
        currentVideo.load();
      }
    }

    flushSync(() => {
      currentPlayingNftRef.current = nft;
      setCurrentPlayingNFT(nft);
      setCurrentlyPlaying(`${nft.contract}-${nft.tokenId}`);
    });
    releaseOrphanPlaybackVideos(playbackVideoElementId(nft.contract, nft.tokenId));

    recordRecentPlay(nft, fidRef.current).catch((error) => {
      audioLogger.error('Error recording recent play:', error);
    });

    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const audio = audioRef.current;
    mountClockAudioElement(audio);

    const detachPlaybackHandlers = (el: HTMLMediaElement | null) => {
      if (!el) return;
      el.onerror = null;
      el.onloadedmetadata = null;
      el.ondurationchange = null;
      el.oncanplay = null;
      el.onwaiting = null;
      el.onstalled = null;
      el.onplaying = null;
      el.ontimeupdate = null;
      el.onplay = null;
      el.onpause = null;
      el.onseeking = null;
      el.onseeked = null;
      el.onended = null;
      el.onvolumechange = null;
    };
    detachPlaybackHandlers(audio);
    detachPlaybackHandlers(visualPlaybackRef.current);

    audio.preload = 'auto';
    if (isMobile) {
      audio.volume = 0.7;
    }

    visualPlaybackRef.current = null;
    let media: HTMLMediaElement = audio;
    const mediaUrl = plan.audioUrl || rawAudioUrl;
    const mimeForElement = (
      getCachedMediaMime(mediaUrl) ||
      playNft.metadata?.mimeType ||
      playNft.metadata?.mime_type ||
      ''
    ).toLowerCase();
    // <audio> cannot play mp4. Use <video> only when this extensionless URL
    // is still unknown — not when Alchemy already stamped audio/mpeg.
    const unknownExtensionless =
      plan.mode === 'audio-only' &&
      mediaUrlNeedsMimeProbe(mediaUrl) &&
      !mimeForElement.startsWith('audio/');
    if ((plan.mode === 'video-with-audio' && plan.videoUrl) || unknownExtensionless) {
      abortMediaElement(audio);
      audio.removeAttribute('src');
      const mounted = document.getElementById(
        `video-${nft.contract}-${nft.tokenId}`
      );
      const videoEl =
        mounted instanceof HTMLVideoElement
          ? mounted
          : ensurePlaybackVideoElement(nft.contract, nft.tokenId);
      media = videoEl;
      videoEl.muted = false;
      videoEl.setAttribute('playsinline', 'true');
      videoEl.setAttribute('webkit-playsinline', 'true');
      videoEl.playsInline = true;
      videoEl.preload = 'auto';
      videoEl.loop = false;
      if (isMobile) videoEl.volume = 0.7;
      visualPlaybackRef.current = videoEl;
    }
    setActiveMainMedia(media);

    let urlIndex = 0;
    let switchingUrl = false;
    let playbackStarted = false;
    let unplayableToastShown = false;
    /** Terminal for this tap. A late error event must not silently restart the
     *  chain and re-raise the spinner after the user was told it failed. */
    let gaveUp = false;
    let playTracked = false;
    /** Earliest retry after a failed play-count write. See maybeTrackPlay. */
    let playTrackRetryAfter = 0;
    /** Log the play-count target once, not on every timeupdate. */
    let playTrackTargetLogged = false;
    let probedWavDuration = 0;
    /**
     * Set by tryUrl for the candidate currently attached. Lets a side-channel
     * that has proven another gateway works cut the current first-byte wait
     * short, without touching the candidate order itself.
     */
    let shortenFailover: ((ms: number, provenUrl: string) => void) | null = null;

    const applyMediaDuration = (seconds: number, via: string) => {
      if (playAttempt !== playAttemptRef.current) return;
      if (!Number.isFinite(seconds) || seconds < 1 || seconds === Infinity) return;
      probedWavDuration = Math.max(probedWavDuration, seconds);
      setAudioDuration(probedWavDuration);
      playbackDebug('play:wav-duration', {
        name: nft.name,
        seconds: probedWavDuration,
        via,
      });
    };

    if (plan.mode === 'audio-only' && arweaveOrigin) {
      const tx =
        parseArweaveMediaPath(rawAudioUrl).fileTxId ||
        parseArweaveMediaPath(playbackUrls[0] || '').fileTxId;
      if (tx) {
        const wavProbeUrl = toArweaveRawUrl(tx, 'https://arweave.net/');
        void probeAudioHead(wavProbeUrl).then(({ seconds, servedAudioBytes }) => {
          if (playAttempt !== playAttemptRef.current) return;
          playbackDebug('play:wav-duration-probe', {
            name: nft.name,
            seconds,
            servedAudioBytes,
            probeUrl: wavProbeUrl,
          });
          applyMediaDuration(seconds, 'wav-header');
          // Any audio bytes prove this gateway works — not just a readable RIFF
          // header. Long Arweave tracks are often mp3, where the duration is 0
          // and this shortcut never fired, so a slow gateway got the full wait
          // while the probe had already pulled bytes from a fast one.
          if (servedAudioBytes) shortenFailover?.(PROVEN_ALT_FAILOVER_MS, wavProbeUrl);
        });
      }
    }

    const showUnplayableToast = () => {
      if (unplayableToastShown) return;
      // A deep-link load never asked to play, so a failure toast on page open
      // is noise. play() clears `paused` immediately even while buffering, so
      // this still fires if the user has since tapped play.
      if (!shouldAutoplay && media.paused) return;
      unplayableToastShown = true;
      showErrorToast(`Couldn't play "${nft.name || 'this track'}" — its media file is currently unavailable.`);
    };

    const clearStall = () => {
      if (stallTimerRef.current) {
        clearTimeout(stallTimerRef.current);
        stallTimerRef.current = null;
      }
      if (failoverTimerRef.current) {
        clearTimeout(failoverTimerRef.current);
        failoverTimerRef.current = null;
      }
    };

    const clearGiveUp = () => {
      if (giveUpTimerRef.current) {
        clearTimeout(giveUpTimerRef.current);
        giveUpTimerRef.current = null;
      }
    };

    /** Single place that flips the UI to "really playing" so no path can mark
     *  the tap as started while leaving a watchdog or the spinner behind. */
    const markPlaybackStarted = () => {
      if (gaveUp) return;
      playbackStarted = true;
      clearStall();
      clearGiveUp();
      // Reflect the element, not the intent. A deep link loads with
      // autoplay:false, so `canplay` fires on a element that was never
      // play()ed — flipping the UI to "playing" there is exactly what makes a
      // shared link look like a failed autoplay. Checking `paused` instead of
      // `shouldAutoplay` also keeps the button correct once the user does tap
      // play, since handlePlayPause calls play() without a new play attempt.
      if (!media.paused) setIsPlaying(true);
      // Store the candidate, not media.currentSrc: currentSrc is the post-302
      // sandbox target, and re-issuing our own URL is what resolves correctly.
      const winner = playbackUrls[urlIndex];
      if (winner) rememberPlayedMediaUrl(rawAudioUrl, winner);
    };

    // Backstop for the whole tap, across every gateway hop. If no clock is
    // running by now the spinner has to end — silent forever is the worst
    // outcome, worse than telling the user the file is unavailable.
    const armGiveUpTimer = () => {
      clearGiveUp();
      let lastSeenIndex = 0;
      let lastSeenBuffered = 0;
      const check = () => {
        if (playAttempt !== playAttemptRef.current || gaveUp) return;
        if (playbackStarted || media.currentTime > 0.25) {
          clearGiveUp();
          return;
        }
        // We have bytes, so this is not a retrieval failure — an autoplay block
        // parks a fully buffered track here, and "unavailable" would be a lie.
        if (media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          clearGiveUp();
          return;
        }
        // Still walking candidates or still pulling bytes: the chain will end
        // itself at play:exhausted-urls. Truncating it here would abandon
        // gateways we never tried. Only a frozen tap gives up.
        const buffered = bufferedSeconds(media);
        const progressing = urlIndex !== lastSeenIndex || buffered > lastSeenBuffered;
        lastSeenIndex = urlIndex;
        lastSeenBuffered = buffered;
        if (progressing) {
          giveUpTimerRef.current = setTimeout(check, PLAYBACK_GIVE_UP_MS);
          return;
        }
        playbackDebug('play:give-up', {
          name: nft.name,
          url: playbackUrls[urlIndex],
          triedCount: urlIndex + 1,
          of: playbackUrls.length,
          media: mediaDebugSnapshot(media),
        });
        gaveUp = true;
        clearStall();
        clearGiveUp();
        // Pause rather than detach the src: clearing it fires an error event,
        // which would bounce straight back through hopPlayback and restart.
        media.pause();
        showUnplayableToast();
        setIsPlaying(false);
      };
      giveUpTimerRef.current = setTimeout(check, PLAYBACK_GIVE_UP_MS);
    };

    const startCompanionVideo = () => {
      if (media instanceof HTMLVideoElement) {
        return;
      }
      if (!(plan.videoUrl || plan.mode !== 'audio-only')) {
        return;
      }
      const newVideo = document.getElementById(
        `video-${nft.contract}-${nft.tokenId}`
      ) as HTMLVideoElement | null;
      if (!newVideo) {
        return;
      }
      newVideo.muted = true;
      newVideo.play().then(() => restorePageScroll()).catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          audioLogger.error('Error playing muted companion video:', error);
        }
      });
    };

    const kickPlay = () => {
      if (!shouldAutoplay) {
        playbackDebug('play:kick-skip-autoplay', { name: nft.name, media: mediaDebugSnapshot(media) });
        return;
      }
      playbackDebug('play:kick', { name: nft.name, media: mediaDebugSnapshot(media) });
      setIsPlaying(true);
      ensureMediaAudible(media);
      const playPromise = media.play();
      if (!playPromise) {
        return;
      }
      playPromise.then(() => {
        restorePageScroll();
      }).catch((err) => {
        if (playAttempt !== playAttemptRef.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Re-parenting the shared <video> (cover enrich / player layout)
          // aborts the original play() — retry across a few frames.
          const retryAbortedPlay = (attempt: number) => {
            if (playAttempt !== playAttemptRef.current) return;
            if (!media.paused || media.ended) return;
            const src = media.currentSrc || media.src;
            if (!src || src === window.location.href) return;
            playbackDebug('play:abort-error', {
              name: nft.name,
              willRetry: true,
              attempt,
              media: mediaDebugSnapshot(media),
            });
            media.play().then(() => restorePageScroll()).catch((retryErr) => {
              if (
                retryErr instanceof DOMException &&
                retryErr.name === 'AbortError' &&
                attempt < 3
              ) {
                requestAnimationFrame(() => retryAbortedPlay(attempt + 1));
              }
            });
          };
          retryAbortedPlay(0);
          return;
        }
        if (err instanceof DOMException && err.name === 'NotAllowedError' && isMobile) {
          // Do NOT play muted. WKWebView then keeps the session silent until
          // a full refresh, while the UI still looks like it's playing.
          playbackDebug('play:not-allowed', {
            name: nft.name,
            media: mediaDebugSnapshot(media),
          });
          ensureMediaAudible(media);
          if (media.paused) setIsPlaying(false);
          return;
        }
        audioLogger.error('Error playing media:', {
          error: err,
          url: playbackUrls[urlIndex],
          nftId: `${nft.contract}-${nft.tokenId}`,
        });
        playbackDebug('play:kick-failed', {
          name: nft.name,
          url: playbackUrls[urlIndex],
          errorName: err instanceof Error ? err.name : undefined,
          errorMessage: err instanceof Error ? err.message : String(err),
          media: mediaDebugSnapshot(media),
        });
        // Same rule for every other rejection (e.g. desktop NotAllowedError
        // with no muted-autoplay fallback) — isPlaying must reflect reality.
        if (media.paused) setIsPlaying(false);
      });
    };

    const tryUrl = (index: number) => {
      if (playAttempt !== playAttemptRef.current || gaveUp) {
        return;
      }
      if (index >= playbackUrls.length) {
        playbackDebug('play:exhausted-urls', {
          name: nft.name,
          tried: playbackUrls,
          media: mediaDebugSnapshot(media),
        });
        gaveUp = true;
        clearStall();
        clearGiveUp();
        showUnplayableToast();
        setIsPlaying(false);
        return;
      }

      const nextUrl = playbackUrls[index];
      // Cover-hash `_animation` is not the Arweave WAV. Skip it — do not
      // burn the first-byte timer on a still.
      if (
        arweaveOrigin &&
        isAlchemyCdnPlaybackUrl(nextUrl) &&
        playbackUrls.some((u, i) => i > index && isArweavePlaybackUrl(u))
      ) {
        playbackDebug('play:skip-url', {
          name: nft.name,
          reason: 'alchemy-cover-on-arweave',
          index,
          url: nextUrl,
        });
        tryUrl(index + 1);
        return;
      }

      urlIndex = index;
      playbackStarted = false;
      clearStall();
      switchingUrl = true;
      media.pause();
      media.preload = 'auto';
      if (!isHlsUrl(nextUrl)) {
        const existing = media.currentSrc || media.src;
        if (existing && existing !== nextUrl && existing !== window.location.href) {
          media.removeAttribute('src');
          media.load();
        }
      }

      const currentUrlForTimer = playbackUrls[index] || '';
      const knownPlayMime = (
        getCachedMediaMime(currentUrlForTimer) ||
        (isIpfsPlaybackUrl(currentUrlForTimer)
          ? String(playNft.metadata?.mimeType || playNft.metadata?.mime_type || '')
          : '')
      ).toLowerCase();
      const isIpfsDirCandidate =
        shouldProbeIpfsDirectory(currentUrlForTimer) &&
        !knownPlayMime.startsWith('audio/') &&
        !knownPlayMime.startsWith('video/');
      const isIpfsFileCandidate =
        /\/ipfs\/|\.ipfs\./i.test(currentUrlForTimer) && !isIpfsDirCandidate;
      const ipfsHasMediaExt =
        /\.(mp4|webm|mov|m4v|mp3|wav|m4a|ogg|flac|aac)(?:\?|#|$)/i.test(
          currentUrlForTimer.split('#')[0]
        );
      const isAudioElement =
        typeof HTMLAudioElement !== 'undefined' && media instanceof HTMLAudioElement;
      const isArweaveCandidate = isExtensionlessArweaveTx(currentUrlForTimer);
      const knownIpfsMedia =
        isIpfsFileCandidate &&
        !ipfsHasMediaExt &&
        (knownPlayMime.startsWith('video/') || knownPlayMime.startsWith('audio/'));
      const failoverMs = isHlsUrl(nextUrl)
        ? HLS_FIRST_BYTE_FAILOVER_MS
        : isIpfsDirCandidate
          ? IPFS_DIR_FAILOVER_MS
          : isArweaveCandidate
            ? ARWEAVE_FIRST_BYTE_FAILOVER_MS
            : knownIpfsMedia
              ? IPFS_KNOWN_MEDIA_FAILOVER_MS
            : isIpfsFileCandidate && !ipfsHasMediaExt
            ? isAudioElement
              ? FIRST_BYTE_FAILOVER_MS
              : 4000
            : FIRST_BYTE_FAILOVER_MS;
      playbackDebug('play:try-url', {
        name: nft.name,
        index,
        of: playbackUrls.length,
        url: nextUrl,
        isHls: isHlsUrl(nextUrl),
        isIpfsDirCandidate,
        failoverMs,
        cachedMime: knownPlayMime,
        element: media.tagName,
      });

      // Byte-progress watchdog. Every branch must end in a hop or a re-arm:
      // a bare `return` here is what leaves a tapped NFT spinning forever,
      // because a gateway that sends headers and then stalls parks the element
      // at readyState 1 without ever firing error, stalled, or playing.
      // Starts at 0, not -1: a first tick with zero bytes must not read as
      // growth and buy the gateway a free recheck window.
      let lastBuffered = 0;
      let bufferingWaitedMs = 0;
      let loadingGraceUsed = false;
      /** Consecutive ticks with a parsed element and no new bytes. */
      let noGrowthTicks = 0;

      const watchdogTick = () => {
        // urlIndex, not just playAttempt: enrich and the IPFS directory listing
        // both restart the chain with tryUrl(0) without bumping playAttempt, so
        // a timer armed by an earlier candidate could still be pending and would
        // hop against a stale index. Every other async callback here already
        // checks this.
        if (playAttempt !== playAttemptRef.current || urlIndex !== index) return;
        if (playbackStarted || gaveUp) return;

        // Real playback — hopping pauses the clock and WKWebView mutes.
        if (media.currentTime > 0.25) {
          markPlaybackStarted();
          return;
        }

        // Directory CIDs often sit in NETWORK_LOADING forever then 404 — don't
        // wait 30s+; hop to the next audio/video candidate.
        const hungIpfsDir = isIpfsDirCandidate;

        // hls.js attach looks paused at readyState 0 until MANIFEST_PARSED.
        // The outer timer is already 25s for HLS — hop only if still silent.
        if (isHlsUrl(playbackUrls[index])) {
          playbackDebug('play:failover', {
            name: nft.name,
            from: playbackUrls[index],
            reason: 'hls-no-first-frame',
            hungIpfsDir,
            media: mediaDebugSnapshot(media),
          });
          hopPlayback(index, playbackUrls[index], 'hls-no-first-frame');
          return;
        }

        // Two ways a gateway proves it is alive: a growing buffer, or metadata
        // already parsed. readyState matters most for video, where the element
        // reaches HAVE_METADATA long before `buffered` reports any range —
        // judging by buffered alone hops off working-but-slow .mp4/.mov.
        // The original code returned here with no timer armed, which is what
        // hung a tap forever; wait instead, bounded so it still terminates.
        const buffered = bufferedSeconds(media);
        const gainedBytes = buffered > lastBuffered + 0.01;
        lastBuffered = Math.max(lastBuffered, buffered);
        // readyState never falls back to HAVE_NOTHING when a socket dies, so
        // on its own it reads as "alive" forever — which is how a gateway that
        // served headers and then hung used to ride out the whole 30s cap plus
        // the NETWORK_LOADING grace before hopping. Growing bytes still buy
        // full patience; a frozen-but-parsed element only gets a few ticks.
        if (gainedBytes) noGrowthTicks = 0;
        else if (media.readyState > 0) noGrowthTicks += 1;
        const parsedButFrozen = noGrowthTicks > MEDIA_BYTES_STALL_TICKS;
        const responding = gainedBytes || (media.readyState > 0 && !parsedButFrozen);
        if (responding && !hungIpfsDir && bufferingWaitedMs < MEDIA_BYTES_MAX_WAIT_MS) {
          bufferingWaitedMs += MEDIA_BYTES_RECHECK_MS;
          playbackDebug('play:buffering', {
            name: nft.name,
            url: playbackUrls[index],
            buffered,
            gainedBytes,
            noGrowthTicks,
            waitedMs: bufferingWaitedMs,
            media: mediaDebugSnapshot(media),
          });
          failoverTimerRef.current = setTimeout(watchdogTick, MEDIA_BYTES_RECHECK_MS);
          return;
        }

        // Huge Arweave files stay at readyState 0 while bytes are in flight.
        // Known IPFS mp4s (In The Meantime) can `onplay` with 0 frames on a
        // hung Pinata CF challenge — hop to 4everland / Zora at 25s.
        const forceHopExtensionlessIpfsVideo =
          isIpfsFileCandidate &&
          !ipfsHasMediaExt &&
          !isAudioElement &&
          !knownIpfsMedia;
        if (
          !loadingGraceUsed &&
          !hungIpfsDir &&
          !forceHopExtensionlessIpfsVideo &&
          !knownIpfsMedia &&
          media.networkState === HTMLMediaElement.NETWORK_LOADING
        ) {
          loadingGraceUsed = true;
          failoverTimerRef.current = setTimeout(
            watchdogTick,
            isExtensionlessArweaveTx(playbackUrls[index] || '')
              ? ARWEAVE_FIRST_BYTE_FAILOVER_MS
              : FIRST_BYTE_FAILOVER_MS
          );
          return;
        }

        const hopReason = hungIpfsDir
          ? 'ipfs-dir'
          : parsedButFrozen
            ? 'parsed-but-frozen'
            : 'no-bytes';
        playbackDebug('play:failover', {
          name: nft.name,
          from: playbackUrls[index],
          reason: hopReason,
          hungIpfsDir,
          buffered,
          noGrowthTicks,
          readyState: media.readyState,
          networkState: media.networkState,
          waitedMs: bufferingWaitedMs,
          media: mediaDebugSnapshot(media),
        });
        hopPlayback(index, media.currentSrc || playbackUrls[index], hopReason);
      };

      failoverTimerRef.current = setTimeout(watchdogTick, failoverMs);

      shortenFailover = (ms: number, provenUrl: string) => {
        if (playAttempt !== playAttemptRef.current || gaveUp) return;
        if (urlIndex !== index || playbackStarted) return;
        // Already on the proven URL — there is nothing better to hop to.
        const current = (playbackUrls[index] || '').split('#')[0];
        if (current === provenUrl.split('#')[0]) return;
        // This candidate is producing bytes. Slow is not dead; leave it alone.
        if (media.readyState > 0 || bufferedSeconds(media) > 0) return;
        playbackDebug('play:proven-alt', {
          name: nft.name,
          current: playbackUrls[index],
          provenUrl,
          shortenedToMs: ms,
          media: mediaDebugSnapshot(media),
        });
        // A proven alternative also makes the NETWORK_LOADING grace pointless.
        loadingGraceUsed = true;
        clearStall();
        failoverTimerRef.current = setTimeout(watchdogTick, ms);
      };

      if (!isHlsUrl(nextUrl)) {
        const metaMime = (
          playNft.metadata?.mimeType ||
          playNft.metadata?.mime_type ||
          ''
        ).toLowerCase();
        const cachedPlayMime = getCachedMediaMime(nextUrl);
        const arweaveAudio =
          plan.mode === 'audio-only' &&
          isAudioElement &&
          isExtensionlessArweaveTx(nextUrl);
        const playMime =
          (cachedPlayMime &&
          !(arweaveAudio && /^audio\/(mpeg|mp3)(?:;|$)/i.test(cachedPlayMime))
            ? cachedPlayMime
            : '') ||
          (isAlchemyVideoFetchMp4Url(nextUrl) ? 'video/mp4' : '') ||
          (plan.mode === 'audio-only' &&
          metaMime.startsWith('audio/') &&
          !(arweaveAudio && /^audio\/(mpeg|mp3)(?:;|$)/i.test(metaMime))
            ? metaMime
            : '') ||
          (arweaveAudio ? 'audio/wav' : '') ||
          (plan.mode === 'audio-only' &&
          isAudioElement &&
          !ipfsHasMediaExt &&
          !arweaveAudio &&
          !/\.mypinata\.cloud/i.test(nextUrl)
            ? 'audio/mpeg'
            : '');
        const attachedSrc = attachProgressivePlaybackSource(
          media,
          nextUrl,
          playMime || undefined
        );
        switchingUrl = false;
        playbackDebug('play:attached', {
          name: nft.name,
          candidate: nextUrl,
          attachedSrc: attachedSrc.slice(0, 220),
          playMime: playMime || null,
          // '' here means the browser will refuse to fetch this source at all.
          canPlayType: playMime ? media.canPlayType(playMime) || '(unsupported)' : null,
          tag: media.tagName,
        });
        kickPlay();
        // Turbo sandbox often 404s as HTML; <audio> fires onplay, not onerror.
        const arIoApex = arweaveGatewayApexHost(nextUrl);
        if (
          arweaveAudio &&
          (arIoApex === 'turbo-gateway.com' || arIoApex === 'permagate.io')
        ) {
          const probeUrl = nextUrl.split('#')[0];
          void fetch(probeUrl, {
            method: 'GET',
            headers: { Range: 'bytes=0-0' },
            mode: 'cors',
          })
            .then((res) => {
              if (playAttempt !== playAttemptRef.current || urlIndex !== index) return;
              // Fake `onplaying` on a 404 must not block this hop.
              if (media.currentTime > 0.25 || media.readyState >= 2) return;
              const type = (res.headers.get('content-type') || '').toLowerCase();
              const dead =
                res.status === 404 ||
                (type.includes('text/html') && !type.includes('audio')) ||
                (type.includes('text/plain') && !type.includes('audio') && !type.includes('wave'));
              if (!dead) return;
              rememberDeadGateway(rawAudioUrl, res.url || nextUrl);
              playbackDebug('play:arweave-404', {
                name: nft.name,
                url: nextUrl,
                finalUrl: res.url,
                status: res.status,
                type: type || null,
              });
              hopPlayback(index, res.url || nextUrl, 'arweave-sandbox-404');
            })
            .catch(() => {
              // CORS hides the status (turbo's 504 surfaces as ERR_FAILED), so
              // this is only trustworthy alongside a second signal: the media
              // element itself holding zero bytes. Both together mean the
              // gateway is broken, so re-arm short rather than pay the full 25s.
              if (playAttempt !== playAttemptRef.current || urlIndex !== index || gaveUp) return;
              if (playbackStarted || media.readyState > 0 || bufferedSeconds(media) > 0) {
                return;
              }
              playbackDebug('play:probe-failed', {
                name: nft.name,
                url: nextUrl,
                media: mediaDebugSnapshot(media),
              });
              // Independent proof of death — skip the NETWORK_LOADING grace too.
              loadingGraceUsed = true;
              clearStall();
              failoverTimerRef.current = setTimeout(watchdogTick, DEAD_PROBE_FAILOVER_MS);
            });
        }
        return;
      }

      void attachPlaybackSource(media, nextUrl, () => {
        if (playAttempt !== playAttemptRef.current || urlIndex !== index) return;
        playbackDebug('play:hls-fatal', { name: nft.name, url: nextUrl, media: mediaDebugSnapshot(media) });
        tryUrl(index + 1);
      }).then(() => {
        if (playAttempt !== playAttemptRef.current || urlIndex !== index) return;
        switchingUrl = false;
        kickPlay();
      }).catch((attachErr) => {
        if (playAttempt !== playAttemptRef.current || urlIndex !== index) return;
        switchingUrl = false;
        playbackDebug('play:attach-failed', {
          name: nft.name,
          url: nextUrl,
          error: attachErr instanceof Error ? attachErr.message : String(attachErr),
          media: mediaDebugSnapshot(media),
        });
        hopPlayback(index, nextUrl, 'hls-attach-failed');
      });
    };

    const hopPlayback = (fromIndex: number, failedSrc: string, reason: string) => {
      if (playAttempt !== playAttemptRef.current || gaveUp) return;
      const failed = failedSrc || playbackUrls[fromIndex] || '';
      // A remembered winner that just failed must lose its promotion, or every
      // future play re-walks a gateway that has since gone dead.
      forgetPlayedMediaUrl(rawAudioUrl, playbackUrls[fromIndex]);
      const nextIndex =
        isArweavePlaybackUrl(failed) || isArweavePlaybackUrl(playbackUrls[fromIndex])
          ? nextArweavePlaybackIndex(playbackUrls, failed, fromIndex, {
              skipArIoAfterSandbox404: plan.mode === 'audio-only',
            })
          : fromIndex + 1;
      if (nextIndex > fromIndex + 1) {
        playbackDebug('play:skip-url', {
          name: nft.name,
          reason,
          from: fromIndex,
          to: nextIndex,
          failedSrc: failed,
        });
      }
      // Path arweave.net/{tx} 302s without Content-Length → duration Infinity.
      // Pull /raw/ next; keep path behind it if /raw/ NotSupportedError.
      if (plan.mode === 'audio-only' && nextIndex < playbackUrls.length) {
        const rawIdx = playbackUrls.findIndex(
          (u, i) => i >= nextIndex && /arweave\.net\/raw\//i.test(u)
        );
        if (rawIdx > nextIndex) {
          const [rawUrl] = playbackUrls.splice(rawIdx, 1);
          playbackUrls.splice(nextIndex, 0, rawUrl);
          playbackDebug('play:prefer-raw', {
            name: nft.name,
            rawUrl,
            index: nextIndex,
          });
        }
      }
      tryUrl(nextIndex);
    };

    media.onerror = () => {
      if (playAttempt !== playAttemptRef.current || switchingUrl || gaveUp) {
        return;
      }
      const failedSrc = media.currentSrc || media.src;
      if (!failedSrc || failedSrc === window.location.href) {
        playbackDebug('play:media-error-empty-src', {
          name: nft.name,
          media: mediaDebugSnapshot(media),
        });
        return;
      }

      playbackDebug('play:media-error', {
        name: nft.name,
        index: urlIndex,
        url: playbackUrls[urlIndex],
        failedSrc,
        media: mediaDebugSnapshot(media),
      });

      // ProRes / QuickTime Alchemy `_animation` — next tap leads with Cloudinary f_mp4.
      const failedCandidate = playbackUrls[urlIndex] || failedSrc;
      if (
        /nft2?-cdn\.alchemy\.com/i.test(failedCandidate) &&
        /_animation(?:\?|#|$)/i.test(failedCandidate)
      ) {
        rememberMediaMime(failedCandidate, 'video/quicktime');
      }

      const originParts = (extractIPFSPath(rawAudioUrl) || '').split('/').filter(Boolean);
      const failedParts = (extractIPFSPath(failedSrc) || '').split('/').filter(Boolean);
      const guessedFilename = failedParts.length > Math.max(1, originParts.length);
      if (
        !isHlsUrl(failedSrc) &&
        !/stream\.mux\.com/i.test(failedSrc) &&
        !guessedFilename
      ) {
        rememberDeadGateway(rawAudioUrl, failedSrc);
      }
      playbackStarted = false;
      hopPlayback(urlIndex, failedSrc, 'media-error');
    };

    media.onloadedmetadata = () => {
      if (playAttempt !== playAttemptRef.current) return;
      if (Number.isFinite(media.duration) && media.duration > 1) {
        applyMediaDuration(media.duration, 'loadedmetadata');
      } else if (probedWavDuration > 1) {
        setAudioDuration(probedWavDuration);
      }
    };

    media.ondurationchange = () => {
      if (playAttempt !== playAttemptRef.current) return;
      if (Number.isFinite(media.duration) && media.duration > 1) {
        applyMediaDuration(media.duration, 'durationchange');
      } else if (probedWavDuration > 1) {
        setAudioDuration(probedWavDuration);
      }
    };

    media.oncanplay = () => {
      if (playAttempt !== playAttemptRef.current) return;
      if (
        media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        Number.isFinite(media.duration) &&
        media.duration > 1
      ) {
        markPlaybackStarted();
      }
    };

    media.onwaiting = () => {
      if (playAttempt !== playAttemptRef.current) return;
    };

    media.onstalled = () => {
      if (playAttempt !== playAttemptRef.current) return;
      // Never hop from here: a mid-play stall on a live clock would pause and
      // replay, which mutes WKWebView. This only guarantees a watchdog exists,
      // since `stalled` is often the last event a hung gateway ever sends.
      if (playbackStarted || switchingUrl || gaveUp || failoverTimerRef.current) return;
      playbackDebug('event:onstalled-rearm', {
        name: nft.name,
        url: playbackUrls[urlIndex],
        media: mediaDebugSnapshot(media),
      });
      failoverTimerRef.current = setTimeout(() => {
        if (playAttempt !== playAttemptRef.current || playbackStarted || gaveUp) return;
        if (media.currentTime > 0.25) {
          markPlaybackStarted();
          return;
        }
        const failedSrc = media.currentSrc || media.src;
        if (
          isHlsUrl(playbackUrls[urlIndex]) ||
          isHlsUrl(failedSrc) ||
          /stream\.mux\.com/i.test(failedSrc)
        ) {
          return;
        }
        rememberDeadGateway(rawAudioUrl, failedSrc);
        hopPlayback(urlIndex, failedSrc, 'stalled');
      }, FIRST_BYTE_FAILOVER_MS);
    };

    const rememberPlayingMime = () => {
      const playingUrl = playbackUrls[urlIndex];
      const toRemember = isHlsUrl(playingUrl) ? playingUrl : (media.currentSrc || media.src);
      if (!toRemember || toRemember.startsWith('blob:')) return;
      if (plan.mode === 'audio-only') {
        const audioMime = (
          getCachedMediaMime(toRemember) ||
          playNft.metadata?.mimeType ||
          playNft.metadata?.mime_type ||
          'audio/mpeg'
        ).toLowerCase();
        if (audioMime.startsWith('audio/')) {
          rememberMediaMime(toRemember, audioMime);
        }
        return;
      }
      if (media instanceof HTMLVideoElement) {
        const existingMime = getCachedMediaMime(toRemember);
        if (!existingMime || existingMime.startsWith('audio/')) {
          rememberMediaMime(toRemember, 'video/mp4');
        }
        if (alchemyAnimationUrl && isAlchemyVideoFetchMp4Url(playingUrl)) {
          rememberMediaMime(alchemyAnimationUrl, 'video/quicktime');
        }
      }
    };

    media.onplaying = () => {
      if (playAttempt !== playAttemptRef.current || gaveUp) return;
      ensureMediaAudible(media);
      // Turbo sandbox 404 fires onplaying with 0 bytes — that used to set
      // playbackStarted and cancel failover until media-error.
      if (media.currentTime < 0.05 && media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        playbackDebug('play:playing-pending', {
          name: nft.name,
          url: playbackUrls[urlIndex],
          media: mediaDebugSnapshot(media),
        });
        return;
      }
      markPlaybackStarted();
      playbackDebug('play:playing', {
        name: nft.name,
        url: playbackUrls[urlIndex],
        media: mediaDebugSnapshot(media),
      });
      startCompanionVideo();
      rememberPlayingMime();
    };

    let firstProgressLogged = false;
    const syncClockStatus = () => {
      if (Number.isFinite(media.currentTime)) {
        setAudioProgress(media.currentTime);
      }
      if (Number.isFinite(media.duration) && media.duration > 1) {
        setAudioDuration(media.duration);
      } else if (probedWavDuration > 1) {
        setAudioDuration(probedWavDuration);
      }
    };
    const maybeTrackPlay = () => {
      if (playTracked) return;
      // media.duration stays Infinity/NaN on the Arweave WAVs until the whole
      // file is buffered, and we already recover the real length into
      // probedWavDuration (it's what the clock runs on). Reading only
      // media.duration here meant the same NFT counted at a flat 15s on one
      // run and at a true 25% on the next, depending on whether the element
      // happened to learn its duration — use the same number the UI shows.
      const elementDuration =
        Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0;
      const effectiveDuration = Math.max(elementDuration, probedWavDuration);
      const durationSource = elementDuration
        ? 'element'
        : probedWavDuration
          ? 'wav-probe'
          : 'unknown';
      const countsAt = effectiveDuration > 0 ? effectiveDuration * 0.25 : 15;
      // Announce the target once so a run that never counts is explainable.
      if (!playTrackTargetLogged && effectiveDuration > 0) {
        playTrackTargetLogged = true;
        playbackDebug('play:count-target', {
          name: nft.name,
          durationSource,
          durationSeconds: Number(effectiveDuration.toFixed(2)),
          countsAtSeconds: Number(countsAt.toFixed(2)),
          rule: effectiveDuration > 0 ? '25%' : 'flat-15s',
        });
      }
      const reached = media.currentTime >= countsAt;
      if (!reached) return;
      if (Date.now() < playTrackRetryAfter) return;

      playTracked = true;
      audioLogger.info(`Play count threshold reached for NFT: ${nft.name}`);
      playbackDebug('play:count-fire', {
        name: nft.name,
        currentTime: Number(media.currentTime.toFixed(2)),
        countsAtSeconds: Number(countsAt.toFixed(2)),
        durationSource,
        mediaKey: getMediaKey(nft).slice(0, 12),
      });
      // Move the number now. trackNFTPlay needs a legacy fold, three getDocs
      // and a batch commit before it can emit an absolute count, and the
      // panel is supposed to react the moment the threshold is crossed.
      const trackedMediaKey = getMediaKey(nft);
      emitPlayCountBump(trackedMediaKey, 1);
      // The guess was wrong — take it back and let a later timeupdate retry.
      // timeupdate fires ~4x/sec, so hold a cooldown or a persistent failure
      // would spray writes at Firestore.
      const undoOptimisticBump = (reason: string, detail?: unknown) => {
        playbackDebug('play:count-rollback', {
          name: nft.name,
          reason,
          detail: detail instanceof Error ? detail.message : detail,
          mediaKey: trackedMediaKey.slice(0, 12),
        });
        emitPlayCountBump(trackedMediaKey, -1);
        playTracked = false;
        playTrackRetryAfter = Date.now() + PLAY_TRACK_RETRY_COOLDOWN_MS;
      };
      const writeStartedAt = Date.now();
      trackNFTPlay(nft, fidRef.current, { thresholdReached: true })
        .then((writtenMediaKey) => {
          // trackNFTPlay resolves with the mediaKey it wrote. It also bails
          // early and resolves undefined (no audio URL, no mediaKey) without
          // writing anything — that must not leave a phantom +1 on screen.
          if (!writtenMediaKey) {
            audioLogger.warn(`Play count write skipped for NFT: ${nft.name}`);
            undoOptimisticBump('write-skipped');
            return;
          }
          playbackDebug('play:count-written', {
            name: nft.name,
            mediaKey: String(writtenMediaKey).slice(0, 12),
            tookMs: Date.now() - writeStartedAt,
          });
        })
        .catch(error => {
          audioLogger.error('Error tracking NFT play after threshold:', error);
          undoOptimisticBump('write-failed', error);
        });
    };
    media.ontimeupdate = () => {
      if (playAttempt !== playAttemptRef.current) return;
      if (!firstProgressLogged && media.currentTime > 0) {
        firstProgressLogged = true;
      }
      if (!playbackStarted && media.currentTime > 0.25) {
        markPlaybackStarted();
        playbackDebug('play:playing', {
          name: nft.name,
          url: playbackUrls[urlIndex],
          via: 'timeupdate',
          media: mediaDebugSnapshot(media),
        });
        startCompanionVideo();
        rememberPlayingMime();
      }
      syncClockStatus();
      if (media.currentTime > 0) {
        rememberPlayingMime();
      }
      maybeTrackPlay();
    };

    media.onplay = () => {
      playbackDebug('event:onplay', { name: nft.name, media: mediaDebugSnapshot(media) });
      ensureMediaAudible(media);
      resumeHlsBuffering();
    };
    media.onvolumechange = () => {
      if (playAttempt !== playAttemptRef.current) return;
      if (media.muted || media.volume === 0) {
        playbackDebug('event:got-silent', {
          name: nft.name,
          media: mediaDebugSnapshot(media),
        });
        ensureMediaAudible(media);
      }
    };
    media.onpause = () => {
      playbackDebug('event:onpause', {
        name: nft.name,
        skippedReason: playAttempt !== playAttemptRef.current ? 'stale-play-attempt' : switchingUrl ? 'switching-url' : media.ended ? 'ended' : null,
        media: mediaDebugSnapshot(media),
      });
      if (playAttempt !== playAttemptRef.current || switchingUrl) return;
      if (!media.ended) setIsPlaying(false);
      pauseHlsBuffering();
    };
    media.onseeking = () => {
      if (playAttempt !== playAttemptRef.current) return;
      resumeHlsBuffering();
    };
    media.onseeked = () => {
      if (playAttempt !== playAttemptRef.current) return;
      syncClockStatus();
      maybeTrackPlay();
      // Wait until the new position actually has data before pausing Mux
      // loads — otherwise a paused seek never picks up the target frame.
      if (media.paused && media.readyState >= 2) {
        pauseHlsBuffering();
      }
    };
    media.onended = () => {
      if (playAttempt !== playAttemptRef.current) return;
      setIsPlaying(false);
      setAudioProgress(0);
    };

    const listSource = [
      ...collectNftOriginPlaybackUrls(playNft),
      playNft.metadata?.original_animation_url,
      playNft.metadata?.animation_url,
      playNft.audio,
      rawAudioUrl,
    ].find((u) => !!u && ipfsUrlNeedsDirectoryResolve(u));
    if (enrichPromise) {
      void enrichPromise.then((enriched) => {
        if (playAttempt !== playAttemptRef.current || playbackStarted) return;
        const alchemy = [
          enriched.videoUrl,
          enriched.audio,
          enriched.metadata?.animation_url,
        ].find(
          (u): u is string =>
            !!u &&
            /nft2?-cdn\.alchemy\.com/i.test(u) &&
            !isPollutedPlaybackUrl(u) &&
            !isWeakPlaybackUrl(u)
        );
        if (!alchemy) return;
        if (arweaveOrigin || isArweavePlaybackUrl(rawAudioUrl)) {
          playbackDebug('play:enrich-skip-alchemy-arweave', {
            name: playNft.name,
            alchemy,
          });
          return;
        }
        const extras: string[] = [];
        if (!playbackUrls.includes(alchemy)) extras.push(alchemy);
        if (
          plan.mode !== 'audio-only' &&
          /_animation(?:\?|#|$)/i.test(alchemy)
        ) {
          const transcoded = alchemyVideoFetchMp4Url(alchemy);
          if (transcoded && !playbackUrls.includes(transcoded) && !extras.includes(transcoded)) {
            extras.push(transcoded);
          }
        }
        if (!extras.length) return;
        const current = playbackUrls[urlIndex] || '';
        const hungOnIpfs =
          isIpfsPlaybackUrl(current) &&
          media.readyState === 0 &&
          !playbackStarted;
        const hungAudio =
          plan.mode === 'audio-only' && media.readyState === 0 && !playbackStarted;
        playbackUrls = [...extras, ...playbackUrls.filter((u) => !extras.includes(u))];
        playbackDebug('play:enrich-inject', {
          name: playNft.name,
          extras,
          hungOnIpfs,
          hungAudio,
        });
        if (hungOnIpfs || (hungAudio && isIpfsPlaybackUrl(current))) {
          tryUrl(0);
        }
      });
    }

    if (listSource) {
      void listIpfsDirectoryVideoFile(listSource).then((listed) => {
        if (!listed || playAttempt !== playAttemptRef.current || playbackStarted) return;
        const listedPath = extractIPFSPath(listed);
        if (
          listedPath &&
          playbackUrls.some((u) => extractIPFSPath(u) === listedPath)
        ) {
          return;
        }
        playbackDebug('play:ipfs-dir-listed', { name: playNft.name, listed });
        playbackUrls = [listed, ...playbackUrls.filter((u) => u !== listed)];
        tryUrl(0);
      });
    }

    armGiveUpTimer();
    tryUrl(0);

    // iOS audio unlock only — do not reset video to 0 (desyncs from Audio)
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isIOS && (plan.videoUrl || nft.isVideo)) {
      try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContext) {
          const audioCtx = new AudioContext();
          const buffer = audioCtx.createBuffer(1, 1, 22050);
          const source = audioCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(audioCtx.destination);
          source.start(0);
          if (audioCtx.state === 'suspended') {
            audioCtx.resume();
          }
        }
      } catch {
        // ignore
      }
    }
  }, [currentlyPlaying, handlePlayPause, fid]);
  
  // Now define handlePlayNext and handlePlayPrevious which use handlePlayAudio
  const skipInQueue = useCallback(async (direction: 1 | -1) => {
    if (!currentPlayingNFT) return;

    const queue = currentQueue.length > 0
      ? currentQueue
      : (Array.isArray(window.nftList) ? window.nftList : []);

    if (queue.length === 0) {
      audioLogger.debug('No queue available for skip');
      return;
    }

    const currentIndex = findNftInQueue(queue, currentPlayingNFT);
    if (currentIndex === -1) {
      audioLogger.debug('Current NFT not found in queue');
      return;
    }

    const nextIndex = (currentIndex + direction + queue.length) % queue.length;
    const nextNFT = queue[nextIndex];
    if (!nextNFT) return;

    audioLogger.info(`Skipping ${direction === 1 ? 'next' : 'previous'} to`, nextNFT.name, 'at index', nextIndex);
    await handlePlayAudio(nextNFT, { queue, queueType: queueType || 'default' });
  }, [currentPlayingNFT, currentQueue, queueType, handlePlayAudio]);

  const handlePlayNext = useCallback(async () => {
    await skipInQueue(1);
  }, [skipInQueue]);

  const handlePlayPrevious = useCallback(async () => {
    await skipInQueue(-1);
  }, [skipInQueue]);

  const resolvePlaybackClock = useCallback(() => {
    const visual = visualPlaybackRef.current;
    if (visual?.isConnected) return visual;

    const nft = currentPlayingNftRef.current;
    if (nft?.contract && nft.tokenId) {
      const mounted = document.getElementById(
        playbackVideoElementId(nft.contract, String(nft.tokenId))
      );
      if (mounted instanceof HTMLVideoElement) {
        visualPlaybackRef.current = mounted;
        return mounted;
      }
    }

    const active = getActiveMainMedia();
    if (active?.isConnected || active === audioRef.current) return active;
    return audioRef.current;
  }, []);

  const handleSeek = useCallback((time: number) => {
    const clock = resolvePlaybackClock();
    if (!clock) return;
    const wasPlaying = !clock.paused;
    const landed = seekAttachedMedia(clock, time);
    if (landed === null) return;
    setAudioProgress(landed);
    if (Number.isFinite(clock.duration) && clock.duration > 0) {
      setAudioDuration(clock.duration);
    }
    if (wasPlaying && clock.paused) {
      clock.play().catch(() => {});
    }
  }, [resolvePlaybackClock]);

  // Add a function to set fallback URLs
  const setFallbackSources = useCallback((urls: string[]) => {
    setFallbackUrls(urls);
    setCurrentFallbackIndex(0);
  }, []);

  return {
    isPlaying,
    currentPlayingNFT,
    currentlyPlaying,
    audioProgress,
    audioDuration,
    handlePlayAudio,
    handlePlayPause,
    handlePlayNext,
    handlePlayPrevious,
    handleSeek,
    audioRef
  };
}