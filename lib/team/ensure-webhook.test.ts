import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWebhookInfo: vi.fn(), setWebhook: vi.fn(), setMyCommands: vi.fn(),
  init: vi.fn(), listTeam: vi.fn(), setTeamCommands: vi.fn(),
}));
vi.mock("./bot", () => ({
  getTeamBot: () => ({
    api: mocks, isInited: () => false, init: mocks.init,
  }),
  TEAM_COMMANDS: [{ command: "start", description: "Меню" }],
  setTeamCommands: mocks.setTeamCommands,
}));
vi.mock("./access", () => ({ listTeam: mocks.listTeam }));

import { ensureTeamWebhook } from "./ensure-webhook";
import { __resetWebhookGuard, healAfterRejection, noteRejectedSecret, rejectedRecently } from "./webhook-guard";

const target = "https://example.test/api/telegram/team-webhook";
beforeEach(() => {
  vi.resetAllMocks();
  __resetWebhookGuard();
  vi.stubEnv("TEAM_BOT_TOKEN", "123:test");
  vi.stubEnv("TEAM_WEBHOOK_SECRET", "server-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
  mocks.getWebhookInfo.mockResolvedValue({ url: target, pending_update_count: 0, allowed_updates: ["message", "callback_query"] });
  mocks.listTeam.mockResolvedValue([]);
  mocks.setMyCommands.mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("team webhook registration and recovery", () => {
  it("на старте обновляет секрет даже при том же адресе, сохраняет очередь", async () => {
    expect((await ensureTeamWebhook()).status).toBe("registered");
    expect(mocks.setWebhook).toHaveBeenCalledWith(target, {
      secret_token: "server-secret", allowed_updates: ["message", "callback_query"], drop_pending_updates: false,
    });
  });

  it.each(["TEAM_BOT_TOKEN", "TEAM_WEBHOOK_SECRET", "NEXT_PUBLIC_APP_URL"])("без %s не обращается к Telegram", async (key) => {
    vi.stubEnv(key, "");
    expect((await ensureTeamWebhook(true)).status).toBe("skipped");
    expect(mocks.getWebhookInfo).not.toHaveBeenCalled();
    expect(mocks.setWebhook).not.toHaveBeenCalled();
  });

  it("здоровый webhook не перерегистрирует и не обновляет меню", async () => {
    expect((await ensureTeamWebhook(true)).status).toBe("healthy");
    expect(mocks.setWebhook).not.toHaveBeenCalled();
    expect(mocks.listTeam).not.toHaveBeenCalled();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it.each(["", "https://other.test/api/telegram/team-webhook"])("восстанавливает потерянный или чужой адрес: %s", async (url) => {
    mocks.getWebhookInfo.mockResolvedValue({ url, pending_update_count: 4 });
    expect((await ensureTeamWebhook(true)).status).toBe("registered");
    expect(mocks.setWebhook).toHaveBeenCalledWith(target, expect.objectContaining({ drop_pending_updates: false }));
    expect(mocks.listTeam).not.toHaveBeenCalled();
    expect(mocks.setMyCommands).not.toHaveBeenCalled();
  });

  it("восстанавливает секрет при 401 и очереди, если апдейты отклонял этот экземпляр", async () => {
    mocks.getWebhookInfo.mockResolvedValue({ url: target, pending_update_count: 4, last_error_message: "Wrong response from the webhook: 401 Unauthorized" });
    noteRejectedSecret();
    expect((await ensureTeamWebhook(true)).status).toBe("registered");
    expect(mocks.setWebhook).toHaveBeenCalledWith(target, expect.objectContaining({ secret_token: "server-secret", drop_pending_updates: false }));
  });

  it("401 с очередью, но этот экземпляр апдейтов не отклонял — вебхук не перетягивает", async () => {
    mocks.getWebhookInfo.mockResolvedValue({ url: target, pending_update_count: 4, last_error_message: "Wrong response from the webhook: 401 Unauthorized" });
    const res = await ensureTeamWebhook(true);
    expect(res.status).toBe("failed");
    expect(mocks.setWebhook).not.toHaveBeenCalled();
  });

  it("отказ в роуте: перерегистрация сразу, но не чаще раза в 30 секунд", async () => {
    const heal = vi.fn(async () => {});
    expect(healAfterRejection(heal, 1_000_000)).toBe(true);
    expect(healAfterRejection(heal, 1_010_000)).toBe(false);
    expect(healAfterRejection(heal, 1_031_000)).toBe(true);
    expect(heal).toHaveBeenCalledTimes(2);
    noteRejectedSecret(2_000_000);
    expect(rejectedRecently(2_000_000 + 9 * 60_000)).toBe(true);
    expect(rejectedRecently(2_000_000 + 11 * 60_000)).toBe(false);
  });

  it("старый 401 без очереди не вызывает повторную регистрацию", async () => {
    mocks.getWebhookInfo.mockResolvedValue({ url: target, pending_update_count: 0, last_error_message: "401 Unauthorized" });
    expect((await ensureTeamWebhook(true)).status).toBe("healthy");
    expect(mocks.setWebhook).not.toHaveBeenCalled();
  });

  it("возвращает подписку на кнопки", async () => {
    mocks.getWebhookInfo.mockResolvedValue({ url: target, pending_update_count: 0, allowed_updates: ["message"] });
    expect((await ensureTeamWebhook(true)).status).toBe("registered");
  });

  it.each([undefined, []])("подписку на все стандартные события сохраняет: %j", async (allowed_updates) => {
    mocks.getWebhookInfo.mockResolvedValue({ url: target, pending_update_count: 0, allowed_updates });
    expect((await ensureTeamWebhook(true)).status).toBe("healthy");
    expect(mocks.setWebhook).not.toHaveBeenCalled();
  });

  it("сбой меню не выдаёт за сбой установленного webhook", async () => {
    mocks.listTeam.mockRejectedValue(new Error("database unavailable"));
    expect((await ensureTeamWebhook()).status).toBe("registered");
    expect(console.warn).toHaveBeenCalledWith("[team] sync member commands:", "database unavailable");
  });

  it("ошибки 500 с очередью сообщает, не маскирует перерегистрацией", async () => {
    mocks.getWebhookInfo.mockResolvedValue({ url: target, pending_update_count: 4, last_error_message: "500 Internal Server Error" });
    expect(await ensureTeamWebhook(true)).toEqual({ status: "failed", detail: expect.stringContaining("500 Internal Server Error") });
    expect(mocks.setWebhook).not.toHaveBeenCalled();
  });

  it("ошибку Telegram возвращает вызывающему тикеру", async () => {
    mocks.getWebhookInfo.mockRejectedValue(new Error("Telegram unavailable"));
    expect(await ensureTeamWebhook(true)).toEqual({ status: "failed", detail: "Telegram unavailable" });
  });

  it("не сообщает об успешном восстановлении при отказе setWebhook", async () => {
    mocks.getWebhookInfo.mockResolvedValue({ url: "", pending_update_count: 4 });
    mocks.setWebhook.mockRejectedValue(new Error("registration failed"));
    expect(await ensureTeamWebhook(true)).toEqual({ status: "failed", detail: "registration failed" });
  });
});
