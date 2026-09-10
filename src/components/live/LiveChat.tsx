'use client';

import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { UnifiedContext, UserFidContext } from '../../app/providers';
import { LIVE_CHAT_MAX_LEN, LIVE_CHAT_RATE_MS, LIVE_SESSION_END_MS } from '../../data/liveStream';
import {
  sendLiveChatMessage,
  subscribeLiveChat,
  subscribeLiveChatSession,
  syncLiveChatSession,
  type LiveChatMessage,
  type LiveChatSession,
} from '../../lib/liveChat';
import { censorChatText } from '../../lib/chatCensor';
import { isRealFid } from '../../utils/platform';
import ProfileAvatar from '../user/ProfileAvatar';

function handleOf(message: LiveChatMessage) {
  return message.username || message.displayName || `fid:${message.fid}`;
}

export function LiveChat({
  online,
  variant = 'card',
  collapsed,
  onCollapsedChange,
}: {
  online: boolean;
  variant?: 'card' | 'player';
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const fill = variant === 'player';
  const { fid } = useContext(UserFidContext);
  const { user } = useContext(UnifiedContext);
  const [internalMinimized, setInternalMinimized] = useState(false);
  const minimized = collapsed ?? internalMinimized;
  const setMinimized = (next: boolean) => {
    if (collapsed === undefined) setInternalMinimized(next);
    onCollapsedChange?.(next);
  };
  const [session, setSession] = useState<LiveChatSession>({
    status: 'idle',
    activeSessionId: null,
    strictSession: false,
  });
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastSentRef = useRef(0);
  const stickToBottomRef = useRef(true);
  const sawLiveRef = useRef(false);
  const liveSessionId = online && session.status === 'live' ? session.activeSessionId : null;
  const canSend = isRealFid(fid) && Boolean(liveSessionId);
  const visibleMessages = useMemo(() => {
    if (!online || !liveSessionId) return [];
    return messages.filter((message) => message.sessionId === liveSessionId);
  }, [liveSessionId, messages, online]);

  useEffect(() => {
    const stopSession = subscribeLiveChatSession(setSession, () => {
      setError('Chat is unavailable right now');
    });
    const stopMessages = subscribeLiveChat(setMessages, () => {
      setError('Chat is unavailable right now');
    });
    return () => {
      stopSession();
      stopMessages();
    };
  }, []);

  useEffect(() => {
    if (online) {
      sawLiveRef.current = true;
      const beat = () => {
        void syncLiveChatSession(true).catch(() => {
          setError('Chat is unavailable right now');
        });
      };
      beat();
      const id = window.setInterval(beat, 30_000);
      return () => window.clearInterval(id);
    }
    // Close a leftover "live" session when Mux is already down. Keep the
    // reconnect grace only if this client actually saw the stream this visit.
    const delay = sawLiveRef.current ? LIVE_SESSION_END_MS : 0;
    const timer = window.setTimeout(() => {
      void syncLiveChatSession(false).catch(() => {
        setError('Chat is unavailable right now');
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [online]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !stickToBottomRef.current) return;
    list.scrollTop = list.scrollHeight;
  }, [visibleMessages]);

  const mention = (username: string) => {
    const handle = username.replace(/^@/, '');
    if (!handle) return;
    setDraft((prev) => {
      const mentionText = `@${handle} `;
      if (prev.includes(mentionText)) return prev;
      return `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${mentionText}`.slice(0, LIVE_CHAT_MAX_LEN);
    });
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSend || sending || !liveSessionId) return;

    const now = Date.now();
    if (now - lastSentRef.current < LIVE_CHAT_RATE_MS) {
      setError('Slow down a second');
      return;
    }

    const text = draft.replace(/\s+/g, ' ').trim();
    if (!text) return;

    setSending(true);
    setError(null);
    try {
      await sendLiveChatMessage({
        fid,
        username: user?.username,
        displayName: user?.displayName,
        pfp: user?.pfp,
        text,
        sessionId: liveSessionId,
      });
      lastSentRef.current = now;
      setDraft('');
      stickToBottomRef.current = true;
    } catch {
      setError('Could not send');
    } finally {
      setSending(false);
    }
  };

  const emptyCopy = liveSessionId ? 'No messages yet. Say hi.' : 'Chat opens when we go live';
  const placeholder = !isRealFid(fid)
    ? 'Open in Farcaster to chat'
    : liveSessionId
      ? 'Say something…'
      : 'Chat opens when we go live';

  const chatCollapsed = minimized;

  return (
    <div
      className={
        fill
          ? chatCollapsed
            ? 'flex-none mt-3 rounded-2xl border border-white/10 bg-black/40 overflow-hidden mb-[max(0.5rem,env(safe-area-inset-bottom))]'
            : 'flex-1 min-h-0 flex flex-col overflow-hidden border-t border-white/10 bg-black/40 pb-[max(0.5rem,env(safe-area-inset-bottom))]'
          : 'mt-3 rounded-2xl border border-white/10 bg-black/35 overflow-hidden'
      }
    >
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">Live chat</p>
        <button
          type="button"
          onClick={() => setMinimized(!minimized)}
          className="text-white/40 hover:text-white/70 touch-manipulation text-xs px-1 py-1"
          aria-label={minimized ? 'Show chat' : 'Hide chat'}
        >
          {minimized ? '▲ Show' : '▼ Hide'}
        </button>
      </div>
      {!chatCollapsed && <div
        ref={listRef}
        className={
          fill
            ? 'flex-1 min-h-0 overflow-y-auto px-3 pt-1 pb-3 space-y-2 hide-scrollbar'
            : 'h-44 overflow-y-auto px-3 pt-1 pb-3 space-y-2 hide-scrollbar'
        }
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {visibleMessages.length === 0 ? (
          <p className="py-6 text-center text-xs text-white/35">{emptyCopy}</p>
        ) : (
          visibleMessages.map((message) => {
            const handle = handleOf(message);
            return (
              <div key={message.id} className="flex items-start gap-2">
                <ProfileAvatar src={message.pfp} alt={handle} size={22} className="mt-0.5 flex-shrink-0" />
                <p className="min-w-0 text-[13px] leading-snug text-white/85">
                  <button
                    type="button"
                    onClick={() => mention(handle)}
                    className="mr-1 font-semibold text-purple-200 touch-manipulation"
                  >
                    {handle}
                  </button>
                  <span className="break-words">{censorChatText(message.text)}</span>
                </p>
              </div>
            );
          })
        )}
      </div>}
      {!chatCollapsed && <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-white/10 p-2">
        <input
          type="text"
          value={draft}
          onChange={(event) => {
            setDraft(censorChatText(event.target.value).slice(0, LIVE_CHAT_MAX_LEN));
            if (error) setError(null);
          }}
          maxLength={LIVE_CHAT_MAX_LEN}
          disabled={!canSend || sending}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-xl bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:ring-1 focus:ring-purple-400/50 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!canSend || sending || !draft.trim()}
          className="rounded-xl bg-purple-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-40 touch-manipulation"
        >
          Send
        </button>
      </form>}
      {!chatCollapsed && error ? <p className="px-3 pb-2 text-[11px] text-red-300/80">{error}</p> : null}
    </div>
  );
}
