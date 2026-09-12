/**
 * Farcaster keeps its splash screen up until `sdk.actions.ready()` is called.
 * A shared-NFT launch needs that window: the deep link can only be applied
 * after Demo mounts (and, on hosts that launch at homeUrl and pass the cast
 * URL through `sdk.context.location.embed`, only after that context lands).
 * Calling ready() before then uncovers HomeView or a blank page for a beat
 * and then swaps in the maximized player.
 *
 * Demo resolves this gate once the deep-link decision is made — either the
 * player is queued, or there was no deep link at all. The waiter is bounded
 * so a hung resolve can never strand the user on the splash.
 */

let settled = false;
let resolveSettled: (() => void) | null = null;

const settledPromise = new Promise<void>((resolve) => {
  resolveSettled = resolve;
});

export function markDeepLinkSettled(): void {
  if (settled) return;
  settled = true;
  resolveSettled?.();
}

export function waitForDeepLinkSettled(timeoutMs: number): Promise<void> {
  if (settled) return Promise.resolve();
  return Promise.race([
    settledPromise,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
