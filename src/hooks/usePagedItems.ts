'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export const PAGE_SIZE = 8;
/** Cap auto-fill so a tall viewport + on-screen sentinel cannot mount an entire 90+ NFT grid. */
const MAX_AUTO_FILL_PAGES = 2;

interface UsePagedItemsOptions {
  pageSize?: number;
  resetKey?: string | number;
  /** The overflow element that actually scrolls. Required for nested scroll views. */
  scrollRoot?: HTMLElement | null;
  scrollRootRef?: RefObject<HTMLElement | null>;
  /** Defaults to vertical prefetch. Use `0px 400px` for horizontal carousels. */
  rootMargin?: string;
}

/**
 * Mounts items in batches as the user scrolls.
 * Auto-fills only until the scroll root is scrollable (or a small page cap), then
 * loads more only when the sentinel intersects — without re-arming on every page
 * (that previously cascaded and mounted entire large collections).
 */
export function usePagedItems<T>(items: T[], options: UsePagedItemsOptions = {}) {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const resetKey = options.resetKey ?? '';
  const rootMargin = options.rootMargin ?? '80px 0px';
  const { scrollRoot, scrollRootRef } = options;

  const [visibleCount, setVisibleCount] = useState(() => Math.min(pageSize, items.length));
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [resolvedRoot, setResolvedRoot] = useState<HTMLElement | null>(null);
  const pageSizeRef = useRef(pageSize);
  const itemsLengthRef = useRef(items.length);
  const armedRef = useRef(true);
  pageSizeRef.current = pageSize;
  itemsLengthRef.current = items.length;

  useEffect(() => {
    setVisibleCount(Math.min(pageSize, items.length));
    armedRef.current = true;
  }, [resetKey, items.length, pageSize]);

  useLayoutEffect(() => {
    setResolvedRoot(scrollRoot ?? scrollRootRef?.current ?? null);
  }, [scrollRoot, scrollRootRef, items.length, visibleCount]);

  const count = Math.min(visibleCount, items.length);
  const visibleItems = items.slice(0, count);
  const hasMore = count < items.length;
  const maxAutoFill = pageSize * MAX_AUTO_FILL_PAGES;

  // Fill a short first paint without dumping the whole collection into the DOM.
  useLayoutEffect(() => {
    if (!hasMore || visibleCount >= maxAutoFill) return;
    const root = resolvedRoot;
    const needsFill = !root || root.scrollHeight <= root.clientHeight + 8;
    if (!needsFill) return;
    const id = requestAnimationFrame(() => {
      setVisibleCount((prev) => Math.min(prev + pageSize, items.length, maxAutoFill));
    });
    return () => cancelAnimationFrame(id);
  }, [hasMore, visibleCount, pageSize, items.length, resolvedRoot, maxAutoFill]);

  // Re-arm only after the sentinel leaves view, so a stuck-on-screen sentinel
  // cannot cascade-load every page.
  useLayoutEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (!entry.isIntersecting) {
          armedRef.current = true;
          return;
        }
        if (!armedRef.current) return;
        armedRef.current = false;
        setVisibleCount((prev) => {
          const len = itemsLengthRef.current;
          const ps = pageSizeRef.current;
          if (prev >= len) return prev;
          return Math.min(prev + ps, len);
        });
      },
      { root: resolvedRoot ?? undefined, rootMargin, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, resolvedRoot, rootMargin, resetKey]);

  return { visibleItems, hasMore, sentinelRef };
}
