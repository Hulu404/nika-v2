import { describe, expect, it } from "vitest";
import { isProdWebhook } from "./dev-guard";

describe("isProdWebhook — dev не стартует на боевом токене", () => {
  it("вебхука нет — можно polling", () => {
    expect(isProdWebhook("")).toBe(false);
  });

  it("вебхук на прод-домен — боевой", () => {
    expect(isProdWebhook("https://www.mynika.online/api/telegram/databot-webhook")).toBe(true);
    expect(isProdWebhook("https://mynika.online/api/telegram/databot-webhook")).toBe(true);
    expect(isProdWebhook("https://WWW.MYNIKA.ONLINE/x")).toBe(true);
  });

  it("вебхук на хост из NEXT_PUBLIC_APP_URL — боевой", () => {
    expect(isProdWebhook("https://nika.up.railway.app/api/x", "https://nika.up.railway.app")).toBe(true);
  });

  it("localhost в NEXT_PUBLIC_APP_URL не делает localhost боевым", () => {
    expect(isProdWebhook("http://localhost:3000/api/x", "http://localhost:3000")).toBe(false);
  });

  it("туннель на другой хост — не боевой", () => {
    expect(isProdWebhook("https://abc.ngrok.app/api/x", "https://www.mynika.online")).toBe(false);
  });

  it("нечитаемый адрес — считаем боевым", () => {
    expect(isProdWebhook("не адрес")).toBe(true);
  });
});
