import type { Bot } from "grammy";
import { afterEach, expect, it, vi } from "vitest";
import { startTeamPolling } from "./dev-polling";

afterEach(() => vi.unstubAllEnvs());
function stub(url: string) {
  const start = vi.fn().mockResolvedValue(undefined);
  const getWebhookInfo = vi.fn().mockResolvedValue({ url });
  const bot = { api: { getWebhookInfo }, start } as unknown as Bot;
  return { bot, start, getWebhookInfo };
}

it.each(["https://www.mynika.online/api/telegram/team-webhook", "https://deployment.test/api/telegram/team-webhook"])("не запускает polling при production-webhook %s", async (url) => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://deployment.test");
  const { bot, start } = stub(url);
  await expect(startTeamPolling(bot)).rejects.toThrow("боевой бот");
  expect(start).not.toHaveBeenCalled();
});

it("при сбое проверки не удаляет webhook", async () => {
  const { bot, start, getWebhookInfo } = stub("");
  getWebhookInfo.mockRejectedValue(new Error("network unavailable"));
  await expect(startTeamPolling(bot)).rejects.toThrow("network unavailable");
  expect(start).not.toHaveBeenCalled();
});

it("тестового бота запускает с командами и кнопками", async () => {
  const { bot, start } = stub("");
  const onStart = vi.fn();
  await startTeamPolling(bot, { onStart });
  expect(start).toHaveBeenCalledWith({ onStart, allowed_updates: ["message", "callback_query"] });
});
