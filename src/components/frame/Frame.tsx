'use client';

import { useEffect, useState } from 'react';
import sdk from '@farcaster/miniapp-sdk';
import type { FrameContext } from '~/types/user';

interface FrameProps {
  onContextUpdate?: (context: FrameContext) => void;
}

function mapMiniAppContextToFrameContext(ctx: any): FrameContext {
  return {
    user: {
      fid: ctx.user.fid,
      username: ctx.user.username,
      displayName: ctx.user.displayName,
      pfpUrl: ctx.user.pfpUrl,
    },
    location:
      ctx.location && ctx.location.type === 'cast_embed'
        ? {
            type: 'cast_embed',
            embed: ctx.location.embed,
            cast: ctx.location.cast
              ? {
                  fid: ctx.location.cast.author.fid,
                  hash: ctx.location.cast.hash,
                }
              : undefined,
          }
        : undefined,
    client: {
      clientFid: ctx.client.clientFid,
      added: ctx.client.added,
      safeAreaInsets: ctx.client.safeAreaInsets,
      notificationDetails: ctx.client.notificationDetails,
    },
  };
}

// No helpers needed - we're loading the SDK script in layout.tsx

// Simple, no-frills Frame component
export const Frame: React.FC<FrameProps> = ({ onContextUpdate }) => {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const isMiniApp = await sdk.isInMiniApp();
        if (isMiniApp) {
          const context = await sdk.context;
          if (context?.user?.fid) {
            onContextUpdate?.(mapMiniAppContextToFrameContext(context));
          } else {
            setError('No Farcaster user found');
          }
          await sdk.actions.ready();
        } else {
          setError('Not running in Farcaster Mini App');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    }
    init();
  }, [onContextUpdate]);

  return null;
};