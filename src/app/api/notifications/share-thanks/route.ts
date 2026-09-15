import { createClient } from '@farcaster/quick-auth';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  SHARE_THANKS_TITLE,
  shareThanksBody,
  shareThanksProfileLabel,
} from '~/data/shareNotifications';
import { isNotificationStoreConfigured } from '~/lib/kv';
import { getNftUrl, getProfileUrl, getServerAppUrl } from '~/lib/miniapp';
import { sendFrameNotification } from '~/lib/notifs';

const quickAuth = createClient();

const requestSchema = z.object({
  token: z.string().min(1),
  kind: z.enum(['nft', 'profile']),
  castHash: z.string().regex(/^0x[a-fA-F0-9]{8,128}$/),
  username: z.string().max(120).optional(),
  fid: z.number().int().positive().optional(),
  contract: z.string().min(1).max(200).optional(),
  tokenId: z.string().min(1).max(200).optional(),
});

function hostnameFromRequest(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-host');
  const host = (forwarded || request.headers.get('host') || '').split(',')[0].trim();
  if (!host) return null;
  return host.split(':')[0].toLowerCase();
}

export async function POST(request: NextRequest) {
  if (!isNotificationStoreConfigured()) {
    return NextResponse.json({ success: true, sent: false, reason: 'not_configured' });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, errors: parsed.error.errors }, { status: 400 });
  }

  const domain = hostnameFromRequest(request);
  if (!domain) {
    return NextResponse.json({ success: false, error: 'Missing host' }, { status: 400 });
  }

  let sharerFid: number;
  try {
    const payload = await quickAuth.verifyJwt({ token: parsed.data.token, domain });
    const fid = typeof payload.sub === 'number' ? payload.sub : Number(payload.sub);
    if (!Number.isInteger(fid) || fid <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid fid' }, { status: 401 });
    }
    sharerFid = fid;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid Quick Auth token' }, { status: 401 });
  }

  const appUrl = await getServerAppUrl();
  const { kind, castHash, username, fid: sharedFid, contract, tokenId } = parsed.data;

  const label = kind === 'profile' ? shareThanksProfileLabel(username) : undefined;
  const targetUrl =
    kind === 'nft' && contract && tokenId
      ? getNftUrl(contract, tokenId, appUrl)
      : kind === 'profile' && sharedFid
        ? getProfileUrl(sharedFid, appUrl)
        : appUrl;

  const result = await sendFrameNotification({
    fid: sharerFid,
    title: SHARE_THANKS_TITLE,
    body: shareThanksBody(kind, label),
    notificationId: `share-thanks-${kind}-${castHash}`.slice(0, 128),
    targetUrl,
  });

  if (result.state === 'error') {
    return NextResponse.json({ success: false, sent: false }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    sent: result.state === 'success',
    reason: result.state === 'success' ? undefined : result.state,
  });
}
