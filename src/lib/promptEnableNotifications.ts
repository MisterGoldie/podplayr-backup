let prompted = false;

/**
 * Farcaster issues notification tokens, not us. Call this after sdk.ready()
 * so returning users who added the app before webhookUrl existed get the
 * host's add/enable-notifications sheet without removing the app.
 */
export async function promptEnableMiniAppNotifications(): Promise<void> {
  if (prompted || typeof window === 'undefined') return;
  prompted = true;

  try {
    const { sdk } = await import('@farcaster/miniapp-sdk');
    if (!(await sdk.isInMiniApp())) return;

    const context = await sdk.context;
    if (context?.client?.notificationDetails?.token) return;

    const actions = sdk.actions as {
      addMiniApp?: () => Promise<{ notificationDetails?: { token?: string; url?: string } } | void>;
      addFrame?: () => Promise<{ notificationDetails?: { token?: string; url?: string } } | void>;
    };
    const add = actions.addMiniApp || actions.addFrame;
    if (!add) return;

    await add();
  } catch {
    // User rejected, or host has no add/enable sheet. We'll try again next visit.
    prompted = false;
  }
}
