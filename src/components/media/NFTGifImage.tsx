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
      if (/mypinata\.cloud/i.test(u)) return 2;
      if (/gateway\.pinata\.cloud/i.test(u)) return 0;
      if (/ipfs\.io/i.test(u)) return 1;
      return 1;
    };
    return score(a) - score(b);
  });
};

/**
 * Animated GIF/APNG card thumb. Cycles IPFS + Arweave gateways — dedicated
 * mypinata hosts and 9MB GIFs (Chili Sounds) need public-gateway fallbacks.
 */
export const NFTGifImage: React.FC<NFTGifImageProps> = ({
  nft,
  className,
  width = 300,
  height = 300,
  priority = false,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [attemptIndex, setAttemptIndex] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [imgLoading, setImgLoading] = useState(true);
  const elementRef = useRef<HTMLDivElement>(null);

  const candidates = useMemo(() => {
    const rawCandidates = pickImageCandidates(nft);
    const primary = getNftMediaUrl(nft, 'image');
    const urls: string[] = [];
    const seen = new Set<string>();
    const push = (u?: string) => {
      if (!u || u === '/default-nft.png' || seen.has(u)) return;
      seen.add(u);
      urls.push(u);
    };

    push(primary);
    for (const raw of rawCandidates.length ? rawCandidates : [nft.image || nft.metadata?.image || '']) {
      if (!raw) continue;
      const processed = processMediaUrl(raw, '', 'image');
      if (processed) push(processed);
      if (extractIPFSPath(raw)) {
        for (const u of preferPublicIpfs(buildIpfsFallbackUrls(raw)).slice(0, 8)) push(u);
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
  }, [nft.contract, nft.tokenId, nft.image]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          gifLog('visible', nft, { url: shortUrl(imageUrl) });
          setIsVisible(true);
        }
      },
      { threshold: 0.05, rootMargin: '200px' }
    );

    if (elementRef.current) {
      observer.observe(elementRef.current);
    }

    return () => observer.disconnect();
  }, [nft, imageUrl]);

  // Large GIFs (Chili ~9MB) can hang on one gateway without firing onError.
  useEffect(() => {
    if (!imgLoading || hasError || !(isVisible || priority)) return;
    if (attemptIndex >= candidates.length - 1) return;

    const timeout = window.setTimeout(() => {
      const next = attemptIndex + 1;
      gifLog('timeout:hang → next gateway', nft, {
        hung: shortUrl(imageUrl),
        next: shortUrl(candidates[next]),
        attempt: next,
      });
      if (imageUrl === getRememberedMediaUrl(getMediaKey(nft), 'image')) {
        forgetMediaUrl(getMediaKey(nft), 'image');
      }
      setAttemptIndex(next);
      setImgLoading(true);
    }, GIF_HANG_MS);

    return () => window.clearTimeout(timeout);
  }, [imgLoading, hasError, isVisible, priority, attemptIndex, candidates, imageUrl, nft]);

  const handleError = () => {
    const failed = imageUrl;
    const key = getMediaKey(nft);
    if (failed === getRememberedMediaUrl(key, 'image')) {
      forgetMediaUrl(key, 'image');
    }

    const next = attemptIndex + 1;
    if (next < candidates.length) {
      gifLog('error:retry', nft, {
        failed: shortUrl(failed),
        next: shortUrl(candidates[next]),
        attempt: next,
      });
      setAttemptIndex(next);
      setImgLoading(true);
      return;
    }

    gifLog('give-up → default-nft.png', nft, { failed: shortUrl(failed) });
    setHasError(true);
    setImgLoading(false);
  };

  const handleLoad = () => {
    setImgLoading(false);
    gifLog('success:loaded', nft, { loaded: shortUrl(imageUrl) });
    if (imageUrl && !imageUrl.includes('default-nft.png')) {
      rememberWorkingMediaUrl(getMediaKey(nft), 'image', imageUrl);
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
