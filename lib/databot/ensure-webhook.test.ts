import { afterEach, describe, expect, it, vi } from "vitest";
import { DATABOT_ALLOWED_UPDATES, ensureDatabotWebhook } from "./ensure-webhook";

afterEach(() => vi.unstubAllEnvs());

describe("ensureDatabotWebhook", () => {
  it("без DATABOT_TOKEN — absent, в Telegram не ходим", async () => {
    vi.stubEnv("DATABOT_TOKEN", "");
    await expect(ensureDatabotWebhook()).resolves.toEqual({ status: "absent" });
  });

  it("allowed_updates ровно из ТЗ: my_chat_member нужен, чтобы выйти из группы", () => {
    expect([...DATABOT_ALLOWED_UPDATES]).toEqual(["message", "edited_message", "callback_query", "my_chat_member"]);
  });
});
