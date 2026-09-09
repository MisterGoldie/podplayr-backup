import {
  SendNotificationRequest,
  sendNotificationResponseSchema,
} from "@farcaster/miniapp-sdk";
import { deleteUserNotificationDetails, getUserNotificationDetails } from "~/lib/kv";
import { getAppUrl } from "~/lib/miniapp";

export type SendFrameNotificationResult =
  | {
      state: "error";
      error: unknown;
    }
  | { state: "no_token" }
  | { state: "rate_limit" }
  | { state: "success" };

export async function sendFrameNotification({
  fid,
  title,
  body,
  notificationId,
  targetUrl,
}: {
  fid: number;
  title: string;
  body: string;
  notificationId?: string;
  targetUrl?: string;
}): Promise<SendFrameNotificationResult> {
  const notificationDetails = await getUserNotificationDetails(fid);
  if (!notificationDetails) {
    return { state: "no_token" };
  }

  const response = await fetch(notificationDetails.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      notificationId: (notificationId || crypto.randomUUID()).slice(0, 128),
      title: title.slice(0, 32),
      body: body.slice(0, 128),
      targetUrl: (targetUrl || getAppUrl()).slice(0, 1024),
      tokens: [notificationDetails.token],
    } satisfies SendNotificationRequest),
  });

  const responseJson = await response.json();

  if (response.status === 200) {
    const responseBody = sendNotificationResponseSchema.safeParse(responseJson);
    if (responseBody.success === false) {
      return { state: "error", error: responseBody.error.errors };
    }

    const invalid = responseBody.data.result.invalidTokens;
    if (invalid?.length) {
      await deleteUserNotificationDetails(fid);
    }

    if (responseBody.data.result.rateLimitedTokens.length) {
      return { state: "rate_limit" };
    }

    return { state: "success" };
  }

  return { state: "error", error: responseJson };
}
