import {
  ParseWebhookEvent,
  parseWebhookEvent,
  verifyAppKeyWithNeynar,
} from "@farcaster/miniapp-node";
import { NextRequest } from "next/server";
import {
  deleteUserNotificationDetails,
  isNotificationStoreConfigured,
  setUserNotificationDetails,
} from "~/lib/kv";
import { sendFrameNotification } from "~/lib/notifs";

function ensureNeynarApiKey() {
  if (!process.env.NEYNAR_API_KEY && process.env.NEXT_PUBLIC_NEYNAR_API_KEY) {
    process.env.NEYNAR_API_KEY = process.env.NEXT_PUBLIC_NEYNAR_API_KEY;
  }
}

export async function POST(request: NextRequest) {
  ensureNeynarApiKey();

  const requestJson = await request.json();

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
      default:
        return Response.json(
          { success: false, error: "Invalid webhook" },
          { status: 400 }
        );
    }
  }

  if (!data) {
    return Response.json({ success: false, error: "Invalid webhook" }, { status: 400 });
  }

  const fid = data.fid;
  const event = data.event;

  if (!isNotificationStoreConfigured()) {
    return Response.json({
      success: true,
      message: "Webhook received, notifications disabled (Redis not configured)",
    });
  }

  try {
    switch (event.event) {
      case "miniapp_added":
        if (event.notificationDetails) {
          await setUserNotificationDetails(fid, event.notificationDetails);
          await sendFrameNotification({
            fid,
            title: "Welcome to PODPLAYR",
            body: "Mini app is now added to your client",
          });
        } else {
          await deleteUserNotificationDetails(fid);
        }
        break;

      case "miniapp_removed":
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
    console.error("Error handling webhook:", error);
    return Response.json(
      {
        success: false,
        error: "Internal server error processing notification",
      },
      { status: 500 }
    );
  }
}
