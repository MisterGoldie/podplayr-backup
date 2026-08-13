'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export const PAGE_SIZE = 12;

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
 * Mounts items in batches as the user scrolls. Re-observes after each page so a
 * sentinel that is still on-screen (short first page) keeps loading.
 */
export function usePagedItems<T>(items: T[], options: UsePagedItemsOptions = {}) {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const resetKey = options.resetKey ?? '';
  const rootMargin = options.rootMargin ?? '600px 0px';
  const { scrollRoot, scrollRootRef } = options;

  const [visibleCount, setVisibleCount] = useState(() => Math.min(pageSize, items.length));
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [resolvedRoot, setResolvedRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setVisibleCount(Math.min(pageSize, items.length));
  }, [resetKey, items.length, pageSize]);

  useLayoutEffect(() => {
    setResolvedRoot(scrollRoot ?? scrollRootRef?.current ?? null);
  }, [scrollRoot, scrollRootRef, items.length, visibleCount]);

  const count = Math.min(visibleCount, items.length);
  const visibleItems = items.slice(0, count);
  const hasMore = count < items.length;

  useLayoutEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + pageSize, items.length));
        }
      },
      { root: resolvedRoot ?? undefined, rootMargin, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, items.length, pageSize, resolvedRoot, rootMargin, visibleCount]);

  return { visibleItems, hasMore, sentinelRef };
}
