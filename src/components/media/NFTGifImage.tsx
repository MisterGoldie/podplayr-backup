import React, { useState, useRef, useEffect, useMemo } from 'react';
import { NFT } from '../../types/user';
import { processMediaUrl } from '../../utils/media';

interface NFTGifImageProps {
  nft: NFT;
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
}

export const NFTGifImage: React.FC<NFTGifImageProps> = ({
  nft,
  className,
  width = 300,
  height = 300,
  priority = false,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [hasError, setHasError] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);

  const imageUrl = useMemo(() => {
    return nft.image ? processMediaUrl(nft.image, '/default-nft.png', 'image') : '/default-nft.png';
  }, [nft.image]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1, rootMargin: '80px' }
    );

    if (elementRef.current) {
      observer.observe(elementRef.current);
    }

    return () => observer.disconnect();
  }, []);

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
          src={imageUrl}
          alt={nft.name || 'NFT'}
          className="w-full h-full object-cover"
          width={width}
          height={height}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setHasError(true)}
        />
      ) : null}
    </div>
  );
};
