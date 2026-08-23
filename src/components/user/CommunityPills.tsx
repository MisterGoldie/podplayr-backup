'use client';

import { isAcylMember, isOfficialAccount, isPodMember } from '../../constants/community';

const PILL =
  'inline-flex items-center text-[10px] font-semibold tracking-[0.14em] uppercase px-2 py-0.5 rounded-full border';

export function CommunityPills({
  fid,
  isEns,
  isFollowing,
  className = '',
}: {
  fid?: number | null;
  isEns?: boolean;
  isFollowing?: boolean;
  className?: string;
}) {
  const id = fid ?? 0;
  const showPod = id > 0 && isPodMember(id);
  const showOfficial = id > 0 && isOfficialAccount(id);
  const showAcyl = id > 0 && isAcylMember(id);

  if (!isEns && !isFollowing && !showPod && !showOfficial && !showAcyl) {
    return null;
  }

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`.trim()}>
      {isFollowing && (
        <span className={`${PILL} border-green-400/25 bg-green-500/20 text-green-300 tracking-normal font-medium`}>
          Following
        </span>
      )}
      {isEns && (
        <span className={`${PILL} border-blue-400/25 bg-blue-500/20 text-blue-300 tracking-normal font-medium`}>
          ENS
        </span>
      )}
      {showPod && (
        <span className={`${PILL} border-fuchsia-400/35 bg-fuchsia-600/25 text-fuchsia-100`}>
          THEPOD
        </span>
      )}
      {showOfficial && (
        <span className={`${PILL} border-purple-300/30 bg-purple-800/50 text-purple-100`}>
          Official
        </span>
      )}
      {showAcyl && (
        <span
          className={`${PILL} border-white/20 text-white`}
          style={{
            background:
              'linear-gradient(90deg, rgba(255,60,60,0.45) 0%, rgba(255,170,0,0.4) 45%, rgba(60,200,80,0.45) 100%)',
          }}
        >
          ACYL
        </span>
      )}
    </div>
  );
}
