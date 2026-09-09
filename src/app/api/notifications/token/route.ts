import { notificationDetailsSchema } from '@farcaster/miniapp-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { setUserNotificationDetails } from '~/lib/kv';

const requestSchema = z.object({
  fid: z.number().int().positive(),
  notificationDetails: notificationDetailsSchema,
});

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, errors: parsed.error.errors }, { status: 400 });
  }

  await setUserNotificationDetails(parsed.data.fid, parsed.data.notificationDetails);
  return NextResponse.json({ success: true });
}
