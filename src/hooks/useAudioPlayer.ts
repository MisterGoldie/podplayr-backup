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
  abortMediaElement,
  ensurePlaybackVideoElement,
  playbackVideoElementId,
  releaseOrphanPlaybackVideos,
  shouldProbeIpfsDirectory,
  PLAYBACK_STALL_MS,
  FIRST_BYTE_FAILOVER_MS,
  HLS_FIRST_BYTE_FAILOVER_MS,
  IPFS_DIR_FAILOVER_MS,
  clearNftMediaUrlCache,
} from '../utils/media';
import { resolveCdnPlaybackUrls, isOrphanMuxPlaybackUrl, isMuxPlaybackUrl, isPollutedPlaybackUrl, isWeakPlaybackUrl, isMezzanineMuxUrl } from '../lib/mediaCdn';
import { attachPlaybackSource, detachHlsPlayback, isHlsAttached, isHlsUrl, pauseHlsBuffering, resumeHlsBuffering } from '../lib/hlsPlayback';
import { setActiveMainMedia, pauseActiveMainMedia } from '../lib/activeMainMedia';
import { restorePageScroll } from '../utils/pageScroll';

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
} from '../utils/isMediaNFT';
import { logger } from '../utils/logger';
import { useToast } from './useToast';
import { reviveNftMedia } from '../utils/deadNftRegistry';
import { enrichNftMediaFromChain, isIpfsPlaybackUrl, isOnChainNftIdentity, nftNeedsChainMediaEnrich } from '../lib/nft';
import { withFeaturedPlayback } from '../data/featuredNfts';
import { mediaDebugSnapshot, playbackDebug } from '../utils/playbackDebug'; // TEMP — remove with playbackDebug.ts

// Create a dedicated logger for this module
const audioLogger = logger.getModuleLogger('audioPlayer');

// Extend Window interface to include our custom property
declare global {
  interface Window {
    nftList: NFT[];
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
  const playAttemptRef = useRef(0);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    
    const audio = audioRef.current;
    if (!audio) return;

    const updateProgress = () => {
      if (visualPlaybackRef.current) return;
      if (!Number.isFinite(audio.duration)) return;
      
      // Round to prevent micro-updates that cause UI jitter
      const currentTime = Math.floor(audio.currentTime * 10) / 10; // Round to 0.1s precision
      const duration = Math.floor(audio.duration * 10) / 10;
      
      setAudioProgress(currentTime);
      setAudioDuration(duration);
    };

    const handleLoadedMetadata = () => {
      audioLogger.info('Audio metadata loaded:', {
        duration: audio.duration,
        currentTime: audio.currentTime
      });
      // Some gateways stream audio without a proper Content-Length, so duration
      // can be NaN/Infinity here — don't display "NaN:NaN" for that, wait for
      // durationchange (below) to report the real value once it's known.
      if (Number.isFinite(audio.duration)) {
        setAudioDuration(audio.duration);
      }
      setAudioProgress(audio.currentTime);
    };

    // Some gateways only reveal the true duration after the browser has
    // buffered enough of the stream — this fires when that correction happens.
    const handleDurationChange = () => {
      if (Number.isFinite(audio.duration)) {
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
    const hasReadyPlayback = playbackFields.some(
      (u) =>
        !!u &&
        !isWeakPlaybackUrl(u) &&
        (isMuxPlaybackUrl(u) ||
          /\.(mp3|wav|m4a|aac|ogg|flac|mp4|webm|mov|m4v)(?:\?|#|$)/i.test(u) ||
          /gateway\.pinata\.cloud|nft2?-cdn\.alchemy\.com|raw2?\.seadn\.io|arweave\.net|turbo-gateway\.com/i.test(
            u
          ))
    );
    const shouldBlockOnEnrich =
      needsPlaybackRecovery ||
      (!hasReadyPlayback &&
        (needsIpfsPlaybackRefresh || nftNeedsChainMediaEnrich(nft)));
    if (
      isOnChainNftIdentity(nft.contract, nft.tokenId) &&
      (needsPlaybackRecovery || needsIpfsPlaybackRefresh || nftNeedsChainMediaEnrich(nft))
    ) {
      if (!shouldBlockOnEnrich) {
        // Cover / IPFS refresh can finish after play starts — don't stall the switch.
        void enrichNftMediaFromChain(nft);
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
    const skipMimeProbe =
      cachedMime.startsWith('video/') ||
      (cachedMime.startsWith('audio/') && /\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i.test(probeUrl || ''));
    // Extensionless IPFS/Alchemy hashes classified audio-only must always
    // probe — a stale metadata.mimeType of audio/* used to skip this and
    // leave real videos (Dumpster Fire) on the <audio> + still path.
    const mustProbeAudioOnly =
      plan.mode === 'audio-only' &&
      !cachedMime.startsWith('video/') &&
      mediaUrlNeedsMimeProbe(probeUrl) &&
      !/\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i.test(probeUrl || '');
    if ((mediaUrlNeedsMimeProbe(probeUrl) && !skipMimeProbe) || mustProbeAudioOnly) {
      plan = await resolveNftPlaybackPlan(playNft);
      playbackDebug('play:probed', {
        name: playNft.name,
        from: 'audio-only-or-unknown',
        to: plan.mode,
        probeUrl,
        knownMime,
        cachedMime,
      });
    } else if (
      cachedMime.startsWith('video/') &&
      plan.mode === 'audio-only' &&
      (plan.audioUrl || probeUrl)
    ) {
      const videoUrl = plan.audioUrl || probeUrl;
      plan = {
        mode: 'video-with-audio',
        audioUrl: videoUrl,
        videoUrl,
        muteVideo: false,
      };
    }
    applyPlaybackPlanToNft(playNft, plan);
    applyPlaybackPlanToNft(nft, plan);
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
    ].filter(
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
    // Extra origin gateways when raw was scrubbed from mux.
    for (const origin of originCandidates) {
      if (origin === rawAudioUrl || isMuxPlaybackUrl(origin)) continue;
      for (const u of buildFastPlaybackUrls(origin, {
        contract: playNft.contract,
        network: playNft.network,
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
    let playbackUrls = filterLivePlaybackUrls(
      rawAudioUrl,
      audioUrls
        .map(canonicalizeArweaveGatewayUrl)
        .filter((url, index, list) => url && list.indexOf(url) === index)
        .filter((url) => !isPollutedPlaybackUrl(url))
    );
    if (cdnUrls.length) {
      playbackUrls = [
        ...cdnUrls,
        ...playbackUrls.filter((url) => !cdnUrls.includes(url)),
      ];
    }
    playbackDebug('play:urls', {
      name: playNft.name,
      planMode: plan.mode,
      rawAudioUrl,
      audioUrls,
      cdnUrls,
      playbackUrls,
      strippedOrphanMux: orphanMux || null,
    });

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
    };
    detachPlaybackHandlers(audio);
    detachPlaybackHandlers(visualPlaybackRef.current);

    audio.preload = 'auto';
    if (isMobile) {
      audio.volume = 0.7;
    }

    visualPlaybackRef.current = null;
    let media: HTMLMediaElement = audio;
    if (plan.mode === 'video-with-audio' && plan.videoUrl) {
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
    let playTracked = false;

    const showUnplayableToast = () => {
      if (unplayableToastShown) return;
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
          // aborts the original play() — retry once if this click is still live.
          const src = media.currentSrc || media.src;
          playbackDebug('play:abort-error', {
            name: nft.name,
            willRetry: Boolean(src && src !== window.location.href && media.paused),
            media: mediaDebugSnapshot(media),
          });
          if (src && src !== window.location.href && media.paused) {
            media.play().then(() => restorePageScroll()).catch(() => {});
          }
          return;
        }
        if (err instanceof DOMException && err.name === 'NotAllowedError' && isMobile) {
          media.muted = true;
          media.play()
            .then(() => {
              restorePageScroll();
              setTimeout(() => { media.muted = false; }, 300);
            })
            .catch((mutedErr) => {
              playbackDebug('play:muted-retry-failed', {
                name: nft.name,
                errorName: mutedErr instanceof Error ? mutedErr.name : undefined,
                errorMessage: mutedErr instanceof Error ? mutedErr.message : String(mutedErr),
              });
              // Autoplay is blocked outright — don't leave the button showing
              // "pause" for media that never actually started.
              setIsPlaying(false);
            });
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
      if (playAttempt !== playAttemptRef.current) {
        return;
      }
      if (index >= playbackUrls.length) {
        playbackDebug('play:exhausted-urls', {
          name: nft.name,
          tried: playbackUrls,
          media: mediaDebugSnapshot(media),
        });
        clearStall();
        showUnplayableToast();
        setIsPlaying(false);
        return;
      }

      urlIndex = index;
      playbackStarted = false;
      clearStall();
      switchingUrl = true;
      media.pause();
      media.preload = 'auto';
      const nextUrl = playbackUrls[index];
      if (!isHlsUrl(nextUrl)) {
        const existing = media.currentSrc || media.src;
        if (existing && existing !== nextUrl && existing !== window.location.href) {
          media.removeAttribute('src');
          media.load();
        }
      }

      const currentUrlForTimer = playbackUrls[index] || '';
      const knownPlayMime = getCachedMediaMime(currentUrlForTimer);
      const isIpfsDirCandidate =
        shouldProbeIpfsDirectory(currentUrlForTimer) &&
        !knownPlayMime.startsWith('audio/') &&
        !knownPlayMime.startsWith('video/');
      const failoverMs = isHlsUrl(nextUrl)
        ? HLS_FIRST_BYTE_FAILOVER_MS
        : isIpfsDirCandidate
          ? IPFS_DIR_FAILOVER_MS
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

      stallTimerRef.current = setTimeout(() => {
        if (playAttempt !== playAttemptRef.current || playbackStarted) return;
      }, PLAYBACK_STALL_MS);

      failoverTimerRef.current = setTimeout(() => {
        if (playAttempt !== playAttemptRef.current || playbackStarted) return;
        if (media.readyState > 0) return;

        // Directory CIDs often sit in NETWORK_LOADING forever then 404 — don't
        // wait 30s+; hop to the next audio/video candidate.
        const hungIpfsDir = isIpfsDirCandidate;
        const hlsUrl = isHlsUrl(playbackUrls[index]);

        // hls.js attach looks paused at readyState 0 until MANIFEST_PARSED.
        // The outer timer is already 25s for HLS — hop only if still silent.
        if (hlsUrl) {
          playbackDebug('play:failover', {
            name: nft.name,
            from: playbackUrls[index],
            reason: 'hls-no-first-frame',
            hungIpfsDir,
            media: mediaDebugSnapshot(media),
          });
          tryUrl(index + 1);
          return;
        }

        // Huge Arweave MP4s stay at readyState 0 for a long time while bytes
        // are in flight. networkState 2 = actually downloading — do not abort
        // (unless this is a bare IPFS directory that never yields bytes).
        if (
          !hungIpfsDir &&
          (media.networkState === HTMLMediaElement.NETWORK_LOADING || !media.paused)
        ) {
          failoverTimerRef.current = setTimeout(() => {
            if (playAttempt !== playAttemptRef.current || playbackStarted) return;
            if (media.readyState > 0) return;
            tryUrl(index + 1);
          }, FIRST_BYTE_FAILOVER_MS);
          return;
        }
        playbackDebug('play:failover', {
          name: nft.name,
          from: playbackUrls[index],
          reason: hungIpfsDir ? 'ipfs-dir' : 'no-bytes',
          hungIpfsDir,
          media: mediaDebugSnapshot(media),
        });
        tryUrl(index + 1);
      }, failoverMs);

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
        tryUrl(index + 1);
      });
    };

    media.onerror = () => {
      if (playAttempt !== playAttemptRef.current || switchingUrl) {
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

      if (!isHlsUrl(failedSrc) && !/stream\.mux\.com/i.test(failedSrc)) {
        rememberDeadGateway(rawAudioUrl, failedSrc);
      }
      playbackStarted = false;
      tryUrl(urlIndex + 1);
    };

    media.onloadedmetadata = () => {
      if (playAttempt !== playAttemptRef.current) return;
      if (Number.isFinite(media.duration)) {
        setAudioDuration(media.duration);
      }
    };

    media.ondurationchange = () => {
      if (playAttempt !== playAttemptRef.current) return;
      if (Number.isFinite(media.duration)) {
        setAudioDuration(media.duration);
      }
    };

    media.oncanplay = () => {
      if (playAttempt !== playAttemptRef.current) return;
    };

    media.onwaiting = () => {
      if (playAttempt !== playAttemptRef.current) return;
    };

    media.onstalled = () => {
      if (playAttempt !== playAttemptRef.current) return;
      // First frame then starve (Pinata HTTP2 on a huge IPFS file): drop that
      // gateway and try the next instead of freezing on a still.
      if (playbackStarted && media.readyState <= 2 && media.currentTime < 8) {
        const failedSrc = media.currentSrc || media.src;
        if (isHlsUrl(playbackUrls[urlIndex]) || isHlsUrl(failedSrc) || /stream\.mux\.com/i.test(failedSrc)) {
          return;
        }
        rememberDeadGateway(rawAudioUrl, failedSrc);
        playbackStarted = false;
        tryUrl(urlIndex + 1);
      }
    };

    const rememberPlayingMime = () => {
      const playingUrl = playbackUrls[urlIndex];
      const toRemember = isHlsUrl(playingUrl) ? playingUrl : (media.currentSrc || media.src);
      if (!toRemember || toRemember.startsWith('blob:')) return;
      if (media instanceof HTMLVideoElement) {
        const existingMime = getCachedMediaMime(toRemember);
        if (!existingMime || existingMime.startsWith('audio/')) {
          rememberMediaMime(toRemember, 'video/mp4');
        }
      }
    };

    media.onplaying = () => {
      if (playAttempt !== playAttemptRef.current) return;
      playbackStarted = true;
      clearStall();
      setIsPlaying(true);
      playbackDebug('play:playing', {
        name: nft.name,
        url: playbackUrls[urlIndex],
        media: mediaDebugSnapshot(media),
      });
      startCompanionVideo();
      rememberPlayingMime();
    };

    let firstProgressLogged = false;
    media.ontimeupdate = () => {
      if (playAttempt !== playAttemptRef.current) return;
      if (!firstProgressLogged && media.currentTime > 0) {
        firstProgressLogged = true;
      }
      setAudioProgress(media.currentTime);
      if (media.currentTime > 0) {
        rememberPlayingMime();
      }

      const knownDuration = Number.isFinite(media.duration) && media.duration > 0;
      const reachedPercent = knownDuration && media.currentTime >= media.duration * 0.25;
      const reachedFallback = !knownDuration && media.currentTime >= 15;
      if (!playTracked && (reachedPercent || reachedFallback)) {
        playTracked = true;
        audioLogger.info(`Play count threshold reached for NFT: ${nft.name}`);
        trackNFTPlay(nft, fidRef.current, { thresholdReached: true }).catch(error => {
          audioLogger.error('Error tracking NFT play after threshold:', error);
        });
      }
    };

    media.onplay = () => {
      playbackDebug('event:onplay', { name: nft.name, media: mediaDebugSnapshot(media) });
      resumeHlsBuffering();
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
      if (media.paused) pauseHlsBuffering();
    };
    media.onended = () => {
      if (playAttempt !== playAttemptRef.current) return;
      setIsPlaying(false);
      setAudioProgress(0);
    };

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

  const handleSeek = useCallback((time: number) => {
    const clock = visualPlaybackRef.current || audioRef.current;
    if (!clock) return;
    clock.currentTime = time;
    setAudioProgress(time);
  }, []);

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