import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../data/memory-store";
import type { ProSummary } from "../data/pro";
import type { ProductSummary } from "../data/product";
import { parseIntent } from "../intent";
import type { SectionRequest } from "../section";
import { createSummaryHandlers, proDetails, productDetails } from "./summaries";

const now = new Date("2026-10-01T00:30:00Z");
const pro: ProSummary = {
  proNow: 4, proPaid: 2, proPromo: 1, proManual: 1, paymentsCount: 2, paymentsSum: 598.5,
  paymentsByPlan: { monthly: { count: 2, sum: 598.5 } }, redeemedByCode: [], redeemedToPaid: 0, expiring7d: 1,
};
const product: ProductSummary = {
  signups: 3, onboarded: 2, tgLinked: 1, byChannel: { none: 3 }, active7d: 7,
  sprintsStarted: 1, sprintsActive: 2, sprintsClosed: 0, nudgeSent: 0, nudgeClicked: 0, nsm: null,
};
function setup(section: "pro" | "prd", params: Record<string, string> = {}) {
  const fetchPro = vi.fn(async () => pro);
  const fetchProduct = vi.fn(async () => product);
  const req: SectionRequest = {
    subject: { chatId: 1, zone: "council", isOwner: false },
    member: { chat_id: 1, username: null, display_name: null, zone: "council", is_owner: false,
      invited_by: null, joined_at: now.toISOString(), last_seen_at: null, is_active: true, removed_at: null },
    intent: { report: section === "pro" ? "pro.summary" : "prd.summary", section, action: "list", source: "command", params },
    store: new MemoryStore(), effects: { setCommands: async () => {} }, now, botUsername: "test",
  };
  return { req, fetchPro, fetchProduct, handle: createSummaryHandlers({ fetchPro, fetchProduct })[section] };
}

describe("сводки совета", () => {
  it("месяц по умолчанию начинается в московскую полночь", async () => {
    const t = setup("pro");
    const result = await t.handle(t.req);
    expect(t.fetchPro).toHaveBeenCalledWith(new Date("2026-09-30T21:00:00Z"), now);
    expect(result.kind).toBe("screens");
    if (result.kind !== "screens") return;
    expect(result.screens[0].text).toContain("598,50 ₽");
    expect(result.screens[0].text).toContain("PRO сейчас: 4");
    expect(result.screens[0].buttons?.flat().map((b) => b.data)).toContain("d:pro:summary:pw");
  });

  it.each(["pro", "prd"] as const)("%s: не читает БД без доступа", async (section) => {
    const t = setup(section);
    t.req.subject.zone = "smm";
    expect(await t.handle(t.req)).toEqual({ kind: "forbidden" });
    expect(t.fetchPro).not.toHaveBeenCalled();
    expect(t.fetchProduct).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([{ period: "bad" }, { page: "0" }, { page: "1.5" }])("не читает БД с неверными параметрами %j", async (params) => {
    const t = setup("pro", params);
    expect(await t.handle(t.req)).toEqual({ kind: "stale" });
    expect(t.fetchPro).not.toHaveBeenCalled();
  });

  it("не подменяет отсутствие метрики нулём, остальные нули показывает", () => {
    expect(productDetails(product).join("\n")).toContain("Возврат после пропуска: нет данных");
    expect(productDetails({ ...product, nsm: 0 }).join("\n")).toContain("Возврат после пропуска: 0");
    expect(productDetails(product).join("\n")).toContain("отправлены 0, переходы 0");
  });

  it("экранирует названия из БД, включая неизвестные планы и каналы", () => {
    expect(proDetails({ ...pro, redeemedByCode: [{ code: "<code>", label: "A&B", count: 2 }] }).join("\n"))
      .toContain("&lt;code&gt; (A&amp;B)");
    expect(productDetails({ ...product, byChannel: { constructor: 1, "<b>": 2 } }).join("\n"))
      .toContain("&lt;b&gt;");
  });

  it("длинный список не теряется, страницы и кнопки укладываются в лимиты Telegram", async () => {
    const t = setup("pro");
    t.fetchPro.mockResolvedValue({ ...pro, redeemedByCode: Array.from({ length: 40 }, (_, i) => ({
      code: `CODE${i}`, label: "&".repeat(120), count: i,
    })) });
    const texts: string[] = [];
    for (let page = 1; page <= 50; page++) {
      t.req.intent.params = { period: "7d", page: String(page) };
      const result = await t.handle(t.req);
      expect(result.kind).toBe("screens");
      if (result.kind !== "screens") return;
      const screen = result.screens[0];
      texts.push(screen.text);
      expect(screen.text.length).toBeLessThanOrEqual(4096);
      const buttons = screen.buttons!.flat();
      for (const button of buttons) {
        expect(Buffer.byteLength(button.data)).toBeLessThanOrEqual(64);
        expect(parseIntent({ callbackData: button.data }).kind).toBe("intent");
      }
      if (!buttons.some((button) => button.text === "Ещё")) break;
    }
    expect(texts.join("\n")).toContain("CODE39");
    expect(texts.join("\n").match(/CODE\d+/g)).toHaveLength(40);
  });

  it.each(["d:pro:summary", "d:prd:summary:bad", "d:pro:summary:tm:0", "d:prd:summary:pw:1:extra"])("отсекает битую кнопку %s", (data) => {
    expect(parseIntent({ callbackData: data }).kind).toBe("stale");
  });
});
