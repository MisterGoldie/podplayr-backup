import React, { useState, useRef, useEffect, useMemo } from 'react';
import { NFT } from '../../types/user';
import {
  buildArweaveImageFallbackUrls,
  buildHttpCdnImageFallbackUrls,
  buildIpfsFallbackUrls,
  extractIPFSPath,
  getMediaKey,
  getNftMediaUrl,
  pickImageCandidates,
  processMediaUrl,
  isIpfsCorsHostileUrl,
} from '../../utils/media';
import { rememberWorkingMediaUrl, forgetMediaUrl, getRememberedMediaUrl } from '../../utils/gatewayMemory';

interface NFTGifImageProps {
  nft: NFT;
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
}

const IMG_LOG = true;
const GIF_HANG_MS = 15000;
const GIF_HANG_MS_SMALL = 2500;

const shortUrl = (url?: string | null, max = 120): string => {
  if (!url) return '(empty)';
  return url.length <= max ? url : `${url.slice(0, max)}…`;
};

const gifLog = (stage: string, nft: NFT, details: Record<string, unknown> = {}) => {
  if (!IMG_LOG) return;
  console.log(`[NFT-IMG:GIF] ${stage}`, {
    name: nft.name,
    id: `${nft.contract?.slice(0, 10)}…/${nft.tokenId}`,
    ...details,
  });
};

const preferPublicIpfs = (urls: string[]): string[] => {
  return [...urls].sort((a, b) => {
    const score = (u: string) => {
      if (/w3s\.link|nftstorage\.link|dweb\.link/i.test(u)) return 3;
      if (/\.mypinata\.cloud/i.test(u)) return 0;
      if (/gateway\.pinata\.cloud/i.test(u)) return 1;
      if (/ipfs\.io/i.test(u)) return 2;
      return 2;
    };
    return score(a) - score(b);
  });
};

/**
 * Animated GIF/APNG card thumb. Cycles IPFS + Arweave gateways.
 * Dedicated mypinata hosts work for curated covers; public gateways are fallback.
 */
const NFTGifImageInner: React.FC<NFTGifImageProps> = ({
  nft,
  className,
  width = 300,
  height = 300,
  priority = false,
}) => {
  const [isVisible, setIsVisible] = useState(priority);
  const [attemptIndex, setAttemptIndex] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [imgLoading, setImgLoading] = useState(true);
  const elementRef = useRef<HTMLDivElement>(null);
  const nftRef = useRef(nft);
  nftRef.current = nft;
  const loggedVisibleRef = useRef(false);

  const candidates = useMemo(() => {
    const rawCandidates = pickImageCandidates(nft);
    const primary = getNftMediaUrl(nft, 'image');
    const urls: string[] = [];
    const seen = new Set<string>();
    const push = (u?: string) => {
      if (!u || u === '/default-nft.png' || seen.has(u)) return;
      if (isIpfsCorsHostileUrl(u)) return;
      seen.add(u);
      urls.push(u);
    };

    // Dedicated Pinata hosts often succeed for curated covers while the public
    // gateway hangs (and getNftMediaUrl rewrites mypinata → gateway.pinata).
    for (const raw of [nft.image, nft.metadata?.image]) {
      if (raw && /\.mypinata\.cloud/i.test(raw)) push(raw);
    }
    push(primary);
    for (const raw of rawCandidates.length ? rawCandidates : [nft.image || nft.metadata?.image || '']) {
      if (!raw) continue;
      const processed = processMediaUrl(raw, '', 'image');
      if (processed) push(processed);
      if (extractIPFSPath(raw)) {
        for (const u of preferPublicIpfs(buildIpfsFallbackUrls(raw).filter((g) => !isIpfsCorsHostileUrl(g))).slice(0, 8)) push(u);
      }
      if (/arweave|ar:\/\/|turbo-gateway|permagate/i.test(raw)) {
        for (const u of buildArweaveImageFallbackUrls(raw)) push(u);
      }
      if (/seadn\.io|openseauserdata\.com/i.test(raw) || /seadn\.io|openseauserdata\.com/i.test(processed)) {
        for (const u of buildHttpCdnImageFallbackUrls(raw || processed, {
          contract: nft.contract,
          network: nft.network,
        })) push(u);
      }
    }

    gifLog('resolve:candidates', nft, {
      primary: shortUrl(primary),
      rawCandidates: rawCandidates.map((u) => shortUrl(u)),
      count: urls.length,
      urls: urls.map((u) => shortUrl(u, 80)),
    });
    return urls.length ? urls : ['/default-nft.png'];
  }, [nft.contract, nft.tokenId, nft.image, nft.metadata?.image, nft.name]);

  const imageUrl = candidates[Math.min(attemptIndex, candidates.length - 1)];

  useEffect(() => {
    setAttemptIndex(0);
    setHasError(false);
    setImgLoading(true);
    loggedVisibleRef.current = false;
  }, [nft.contract, nft.tokenId, nft.image]);

  useEffect(() => {
    if (priority || isVisible) return;
    const el = elementRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.05, rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [priority, isVisible]);

  useEffect(() => {
    if (!(isVisible || priority) || loggedVisibleRef.current) return;
    loggedVisibleRef.current = true;
    gifLog('visible', nftRef.current, { url: shortUrl(imageUrl) });
  }, [isVisible, priority, imageUrl]);

  // Large GIFs can hang on one gateway without firing onError.
  useEffect(() => {
    if (!imgLoading || hasError || !(isVisible || priority)) return;
    if (attemptIndex >= candidates.length - 1) return;

    const hangMs = width <= 200 ? GIF_HANG_MS_SMALL : GIF_HANG_MS;
    const timeout = window.setTimeout(() => {
      const next = attemptIndex + 1;
      const current = nftRef.current;
      gifLog('timeout:hang → next gateway', current, {
        hung: shortUrl(imageUrl),
        next: shortUrl(candidates[next]),
        attempt: next,
      });
      if (imageUrl === getRememberedMediaUrl(getMediaKey(current), 'image')) {
        forgetMediaUrl(getMediaKey(current), 'image');
      }
      setAttemptIndex(next);
      setImgLoading(true);
    }, hangMs);

    return () => window.clearTimeout(timeout);
  }, [imgLoading, hasError, isVisible, priority, attemptIndex, candidates, imageUrl, width]);

  const handleError = () => {
    const failed = imageUrl;
    const current = nftRef.current;
    const key = getMediaKey(current);
    if (failed === getRememberedMediaUrl(key, 'image')) {
      forgetMediaUrl(key, 'image');
    }

    const next = attemptIndex + 1;
    if (next < candidates.length) {
      gifLog('error:retry', current, {
        failed: shortUrl(failed),
        next: shortUrl(candidates[next]),
        attempt: next,
      });
      setAttemptIndex(next);
      setImgLoading(true);
      return;
    }

    gifLog('give-up → default-nft.png', current, { failed: shortUrl(failed) });
    setHasError(true);
    setImgLoading(false);
  };

  const handleLoad = () => {
    setImgLoading(false);
    gifLog('success:loaded', nftRef.current, { loaded: shortUrl(imageUrl) });
    if (imageUrl && !imageUrl.includes('default-nft.png')) {
      rememberWorkingMediaUrl(getMediaKey(nftRef.current), 'image', imageUrl);
    }
  };

  return (
    <div ref={elementRef} className={`relative ${className || ''}`}>
      {hasError ? (
        <img
          src="/default-nft.png"
          alt="Fallback"
          className="w-full h-full object-cover"
          width={width}
          height={height}
        />
      ) : isVisible || priority ? (
        <img
          key={imageUrl}
          src={imageUrl}
          alt={nft.name || 'NFT'}
          className="w-full h-full object-cover"
          width={width}
          height={height}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onError={handleError}
          onLoad={handleLoad}
        />
      ) : null}
    </div>
  );
};

function areGifImagesEqual(prev: NFTGifImageProps, next: NFTGifImageProps) {
  return (
    prev.nft.contract === next.nft.contract &&
    prev.nft.tokenId === next.nft.tokenId &&
    prev.nft.image === next.nft.image &&
    prev.nft.metadata?.image === next.nft.metadata?.image &&
    prev.width === next.width &&
    prev.height === next.height &&
    prev.priority === next.priority &&
    prev.className === next.className
  );
}

export const NFTGifImage = React.memo(NFTGifImageInner, areGifImagesEqual);
