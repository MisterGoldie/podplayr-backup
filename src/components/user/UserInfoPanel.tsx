'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import type { FarcasterUser } from '../../types/user';
import { isAcylMember, isOfficialAccount, isPodMember, officialAccountDisplayName } from '../../constants/community';
import { isENSUserObject } from '../../utils/ensUtils';
import { getBioText } from '../../utils/format';

const BIO_CLAMP_CHARS = 160;

interface UserInfoPanelProps {
  user: FarcasterUser;
  totalPlays: number;
  nftCount: number;
  likedNFTsCount: number;
  onClose: () => void;
}

const UserInfoPanel: React.FC<UserInfoPanelProps> = ({
  user,
  totalPlays,
  nftCount,
  likedNFTsCount,
  onClose,
}) => {
  const [isClosing, setIsClosing] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);

  const bio = getBioText(user.profile?.bio);
  const bioIsLong = bio.length > BIO_CLAMP_CHARS;
  const isEns = isENSUserObject(user);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  useEffect(() => {
    setIsClosing(false);
    setBioExpanded(false);
  }, [user]);

  return (
    <div className="fixed inset-0 z-[120] pointer-events-none">
      <div
        className={`absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto ${
          isClosing ? 'animate-fade-out' : 'animate-fade-in'
        }`}
        onClick={handleClose}
      />

      <div
        className="absolute inset-x-0 flex items-center justify-center px-4 pointer-events-none"
        style={{
          top: '4.75rem',
          bottom: 'calc(10.75rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div
          className={`relative bg-gray-900/95 backdrop-blur-lg rounded-3xl overflow-hidden shadow-2xl shadow-purple-900/40 border border-purple-400/30 w-full max-w-sm max-h-full flex flex-col pointer-events-auto ${
            isClosing ? 'animate-slide-down' : 'animate-slide-up'
          }`}
        >
          <div className="relative flex-shrink-0 px-5 pt-5 pb-4">
            <button
              type="button"
              onClick={handleClose}
              className="absolute top-3 right-3 z-10 text-white/80 hover:text-white active:scale-95 transition-all p-2 touch-manipulation rounded-full bg-black/50 backdrop-blur-sm border border-white/10"
              aria-label="Close info panel"
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
                <path d="M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11 11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z" />
              </svg>
            </button>

            <div className="flex items-start gap-3 pr-10">
              <div className="relative w-14 h-14 rounded-full overflow-hidden flex-shrink-0 ring-2 ring-purple-400/30 bg-purple-900/40">
                <Image
                  src={user.pfp_url || '/default-avatar.png'}
                  alt={officialAccountDisplayName(user.fid, user.display_name) || user.username || 'User'}
                  fill
                  sizes="56px"
                  className="object-cover"
                />
              </div>
              <div className="min-w-0">
                <h2 className="text-white text-lg font-semibold leading-snug tracking-tight truncate">
                  {officialAccountDisplayName(user.fid, user.display_name) || user.username || 'User'}
                </h2>
                {user.username && (
                  <p className={`text-sm truncate ${isEns ? 'text-blue-300' : 'text-white/50'}`}>
                    {isEns ? user.username : `@${user.username}`}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {isEns && (
                    <span className="text-[10px] px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded-full">ENS</span>
                  )}
                  {user.fid > 0 && isPodMember(user.fid) && (
                    <span className="text-[10px] px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded-full">thepod</span>
                  )}
                  {user.fid > 0 && isOfficialAccount(user.fid) && (
                    <span className="text-[10px] px-2 py-0.5 bg-purple-800/40 text-purple-200 rounded-full">Official</span>
                  )}
                  {user.fid > 0 && isAcylMember(user.fid) && (
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full text-white/90"
                      style={{
                        background: 'linear-gradient(90deg, rgba(255,0,0,0.25) 0%, rgba(255,154,0,0.25) 40%, rgba(79,220,74,0.25) 100%)',
                      }}
                    >
                      ACYL
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div
            className="px-5 pb-5 min-h-0 flex-1 overflow-y-auto overscroll-contain"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(168, 85, 247, 0.4) rgba(0, 0, 0, 0.2)',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-black/40 border border-purple-400/15 px-3 py-2.5 text-center">
                <p className="text-white text-lg font-semibold tabular-nums leading-none">
                  {totalPlays.toLocaleString()}
                </p>
                <p className="mt-1.5 text-[10px] uppercase tracking-wider text-purple-300/80">Plays</p>
              </div>
              <div className="rounded-2xl bg-black/40 border border-purple-400/15 px-3 py-2.5 text-center">
                <p className="text-white text-lg font-semibold tabular-nums leading-none">
                  {nftCount.toLocaleString()}
                </p>
                <p className="mt-1.5 text-[10px] uppercase tracking-wider text-purple-300/80">Media</p>
              </div>
              <div className="rounded-2xl bg-black/40 border border-purple-400/15 px-3 py-2.5 text-center">
                <p className="text-white text-lg font-semibold tabular-nums leading-none">
                  {likedNFTsCount.toLocaleString()}
                </p>
                <p className="mt-1.5 text-[10px] uppercase tracking-wider text-purple-300/80">Liked</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl bg-black/40 border border-purple-400/15 px-3 py-3">
              <p className="text-[10px] uppercase tracking-wider text-purple-400/80 mb-1.5">Bio</p>
              {bio ? (
                <>
                  <p
                    className={`text-gray-300 text-sm leading-relaxed break-words ${
                      !bioExpanded && bioIsLong ? 'line-clamp-4' : ''
                    }`}
                  >
                    {bio}
                  </p>
                  {bioIsLong && (
                    <button
                      type="button"
                      onClick={() => setBioExpanded((open) => !open)}
                      className="mt-1.5 text-purple-300 hover:text-purple-200 text-xs font-medium"
                    >
                      {bioExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </>
              ) : (
                <p className="text-white/40 text-sm">No bio available</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserInfoPanel;
