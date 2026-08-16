'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { profileImageSrcChain } from '../../utils/openSeaMedia';

interface ProfileAvatarProps {
  src?: string | null;
  alt: string;
  size: number;
  className?: string;
  fallback?: string;
}

const ProfileAvatar: React.FC<ProfileAvatarProps> = ({
  src,
  alt,
  size,
  className = '',
  fallback = '/default-avatar.png',
}) => {
  const candidates = useMemo(() => {
    const chain = profileImageSrcChain(src).filter((url) => url !== '/default-avatar.png');
    chain.push(fallback);
    return chain;
  }, [src, fallback]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [src]);

  const current = candidates[Math.min(index, candidates.length - 1)];

  return (
    <div
      className={`relative overflow-hidden rounded-full bg-purple-900/40 ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Native img: Next's optimizer 500s/403s OpenSea + Pinata avatar CDNs. */}
      <img
        src={current}
        alt={alt}
        className="absolute inset-0 h-full w-full object-cover"
        referrerPolicy="no-referrer"
        onError={() => {
          setIndex((i) => (i + 1 < candidates.length ? i + 1 : i));
        }}
      />
    </div>
  );
};

export default ProfileAvatar;
