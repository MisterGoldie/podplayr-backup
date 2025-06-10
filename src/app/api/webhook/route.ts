import {
  ParseWebhookEvent,
  parseWebhookEvent,
  verifyAppKeyWithNeynar,
} from "@farcaster/frame-node";
import { NextRequest } from "next/server";
import {
  deleteUserNotificationDetails,
  setUserNotificationDetails,
} from "~/lib/kv";
import { sendFrameNotification } from "~/lib/notifs";

export async function POST(request: NextRequest) {
  // Verify Vercel webhook signature
  const signature = request.headers.get('x-vercel-signature');
  const webhookSecret = process.env.VERCEL_WEBHOOK_SECRET;
  
  if (!signature || !webhookSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Compare signatures
  const rawBody = await request.text();
  const hmac = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature256 = await crypto.subtle.sign(
    'HMAC',
    hmac,
    new TextEncoder().encode(rawBody)
  );
  const computedSignature = Array.from(new Uint8Array(signature256))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (computedSignature !== signature) {
    return new Response('Invalid signature', { status: 401 });
  }

  // Check if Redis is configured
  const isRedisConfigured = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;

  const requestJson = JSON.parse(rawBody);

  let data;
  try {
    data = await parseWebhookEvent(requestJson, verifyAppKeyWithNeynar);
  } catch (e: unknown) {
    const error = e as ParseWebhookEvent.ErrorType;

    switch (error.name) {
      case "VerifyJsonFarcasterSignature.InvalidDataError":
      case "VerifyJsonFarcasterSignature.InvalidEventDataError":
        return Response.json(
          { success: false, error: error.message },
          { status: 400 }
        );
      case "VerifyJsonFarcasterSignature.InvalidAppKeyError":
        return Response.json(
          { success: false, error: error.message },
          { status: 401 }
        );
      case "VerifyJsonFarcasterSignature.VerifyAppKeyError":
        return Response.json(
          { success: false, error: error.message },
          { status: 500 }
        );
    }
  }

  const fid = data.fid;
  const event = data.event;

  // If Redis isn't configured, just acknowledge the webhook
  if (!isRedisConfigured) {
    console.log('Redis not configured - skipping notification operations');
    return Response.json({ 
      success: true, 
      message: 'Webhook received, notifications disabled (Redis not configured)' 
    });
  }

  try {
    switch (event.event) {
      case "frame_added":
        if (event.notificationDetails) {
          await setUserNotificationDetails(fid, event.notificationDetails);
          await sendFrameNotification({
            fid,
            title: "Welcome to Frames v2",
            body: "Frame is now added to your client",
          });
        } else {
          await deleteUserNotificationDetails(fid);
        }
        break;

      case "frame_removed":
        await deleteUserNotificationDetails(fid);
        break;

      case "notifications_enabled":
        await setUserNotificationDetails(fid, event.notificationDetails);
        await sendFrameNotification({
          fid,
          title: "Ding ding ding",
          body: "Notifications are now enabled",
        });
        break;

      case "notifications_disabled":
        await deleteUserNotificationDetails(fid);
        break;
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error handling webhook:', error);
    return Response.json({ 
      success: false, 
      error: 'Internal server error processing notification' 
    }, { status: 500 });
  }
}
