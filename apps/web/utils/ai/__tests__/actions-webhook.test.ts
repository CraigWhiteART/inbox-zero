import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActionType } from "@/generated/prisma/enums";
import { runActionFunction } from "@/utils/ai/actions";
import type { EmailForAction } from "@/utils/ai/types";
import type { ExecutedRule } from "@/generated/prisma/client";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("test");

// Mock dependencies
vi.mock("@/utils/webhook", () => ({
  callWebhook: vi.fn(),
}));

vi.mock("@/utils/prisma", () => ({
  default: {
    executedAction: {
      findFirst: vi.fn(),
    },
  },
}));

describe("Webhook action with draft response", () => {
  let mockClient: any;
  let mockEmail: EmailForAction;
  let mockExecutedRule: ExecutedRule;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {};

    mockEmail = {
      id: "msg-123",
      threadId: "thread-456",
      headers: {
        subject: "Test Subject",
        from: "sender@example.com",
        to: "recipient@example.com",
        cc: "cc@example.com",
        bcc: "bcc@example.com",
        date: "2024-01-01",
        "message-id": "<test-message-id@example.com>",
      },
      textPlain: "Test email body",
      textHtml: "<p>Test email body</p>",
      attachments: [],
    };

    mockExecutedRule = {
      id: "exec-rule-123",
      ruleId: "rule-456",
      reason: "Test rule reason",
      automated: true,
      createdAt: new Date("2024-01-01T10:00:00.000Z"),
      updatedAt: new Date("2024-01-01T10:00:00.000Z"),
      messageId: "msg-123",
      threadId: "thread-456",
      emailAccountId: "account-789",
      status: "APPLIED",
      matchMetadata: null,
    };
  });

  it("should include draft response in webhook payload when draft action exists", async () => {
    const { callWebhook } = await import("@/utils/webhook");
    const prisma = (await import("@/utils/prisma")).default;

    // Mock the draft action query
    vi.mocked(prisma.executedAction.findFirst).mockResolvedValue({
      id: "action-draft-123",
      createdAt: new Date(),
      updatedAt: new Date(),
      type: ActionType.DRAFT_EMAIL,
      executedRuleId: mockExecutedRule.id,
      content: "Thank you for your email. I'll review and get back to you.",
      subject: "Re: Test Subject",
      to: "sender@example.com",
      cc: null,
      bcc: null,
      label: null,
      labelId: null,
      url: null,
      folderName: null,
      folderId: null,
      draftId: "draft-123",
      wasDraftSent: null,
    });

    const webhookAction = {
      id: "action-webhook-123",
      type: ActionType.CALL_WEBHOOK,
      url: "https://example.com/webhook",
    };

    await runActionFunction({
      client: mockClient,
      email: mockEmail,
      action: webhookAction,
      userEmail: "user@example.com",
      userId: "user-123",
      emailAccountId: "account-789",
      executedRule: mockExecutedRule,
      logger,
    });

    // Verify callWebhook was called with the correct payload
    expect(callWebhook).toHaveBeenCalledWith(
      "user-123",
      "https://example.com/webhook",
      expect.objectContaining({
        email: expect.objectContaining({
          threadId: "thread-456",
          messageId: "msg-123",
        }),
        executedRule: expect.objectContaining({
          id: "exec-rule-123",
          ruleId: "rule-456",
        }),
        aiDraftResponse: {
          content: "Thank you for your email. I'll review and get back to you.",
          subject: "Re: Test Subject",
          to: "sender@example.com",
          cc: null,
          bcc: null,
        },
      }),
    );
  });

  it("should not include draft response when no draft action exists", async () => {
    const { callWebhook } = await import("@/utils/webhook");
    const prisma = (await import("@/utils/prisma")).default;

    // Mock no draft action found
    vi.mocked(prisma.executedAction.findFirst).mockResolvedValue(null);

    const webhookAction = {
      id: "action-webhook-123",
      type: ActionType.CALL_WEBHOOK,
      url: "https://example.com/webhook",
    };

    await runActionFunction({
      client: mockClient,
      email: mockEmail,
      action: webhookAction,
      userEmail: "user@example.com",
      userId: "user-123",
      emailAccountId: "account-789",
      executedRule: mockExecutedRule,
      logger,
    });

    // Verify callWebhook was called without aiDraftResponse
    expect(callWebhook).toHaveBeenCalledWith(
      "user-123",
      "https://example.com/webhook",
      expect.objectContaining({
        email: expect.objectContaining({
          threadId: "thread-456",
          messageId: "msg-123",
        }),
        executedRule: expect.objectContaining({
          id: "exec-rule-123",
          ruleId: "rule-456",
        }),
      }),
    );

    // Verify aiDraftResponse is not in the payload
    const callArgs = vi.mocked(callWebhook).mock.calls[0];
    expect(callArgs[2]).not.toHaveProperty("aiDraftResponse");
  });
});
