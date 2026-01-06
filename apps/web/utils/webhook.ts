import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { sleep } from "@/utils/sleep";
import type { ExecutedRule } from "@/generated/prisma/client";

const logger = createScopedLogger("webhook");

type WebhookPayload = {
  email: {
    threadId: string;
    messageId: string;
    subject: string;
    from: string;
    cc?: string;
    bcc?: string;
    headerMessageId: string;
  };
  executedRule: Pick<
    ExecutedRule,
    "id" | "ruleId" | "reason" | "automated" | "createdAt"
  >;
};

export const callWebhook = async (
  userId: string,
  url: string,
  payload: WebhookPayload,
) => {
  if (!url) throw new Error("Webhook URL is required");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { webhookSecret: true },
  });
  if (!user) throw new Error("User not found");

  try {
    await Promise.race([
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": user.webhookSecret || "",
        },
        body: JSON.stringify(payload),
      }),
      sleep(1000),
    ]);

    logger.info("Webhook called", { url });
  } catch (error) {
    logger.error("Webhook call failed", { error, url });
    // Don't throw the error since we want to continue execution
    logger.info("Continuing after webhook timeout/error");
  }
};

/**
 * Call webhook and return the response content for use as context in AI draft generation
 */
export const callWebhookForContext = async (
  userId: string,
  url: string,
  payload: WebhookPayload,
): Promise<string | null> => {
  if (!url) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { webhookSecret: true },
  });
  if (!user) return null;

  try {
    const response = await Promise.race<Response | null>([
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": user.webhookSecret || "",
        },
        body: JSON.stringify(payload),
      }),
      sleep(5000).then(() => null), // 5 second timeout for context fetch
    ]);

    if (!response) {
      logger.warn("Webhook timeout for context", { url });
      return null;
    }

    if (!response.ok) {
      logger.warn("Webhook returned non-OK status for context", {
        url,
        status: response.status,
      });
      return null;
    }

    const responseText = await response.text();
    logger.info("Webhook context fetched", { url, responseLength: responseText.length });
    
    // Limit response size to prevent excessive context (max 10KB)
    return responseText.substring(0, 10000);
  } catch (error) {
    logger.error("Webhook call for context failed", { error, url });
    return null;
  }
};
