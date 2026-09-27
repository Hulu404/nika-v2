import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIT_RAW_TEXT_MAX, auditParams, buildAuditEntry, recordAudit } from "./audit";
import { MemoryStore } from "./data/memory-store";
import type { AuditEntry, Intent } from "./types";

// Выдуманный chat_id: репозиторий публичный.
const CHAT = 700001;

function intent(patch: Partial<Intent> = {}): Intent {
  return { report: "run.card", section: "run", action: "card", params: {}, source: "button", ...patch };
}

function entry(patch: Partial<AuditEntry> = {}): AuditEntry {
  return { chat_id: CHAT, zone: "events", report: "run.card", params: {}, source: "text", ok: true, ...patch };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("auditParams", () => {
  it("оставляет только белый список ключей", () => {
    const got = auditParams(
      intent({
        params: { spot: "luzhniki", date: "2026-10-03", target: "700002", token: "abc", text: "Имя Фамилия", page: "2" },
      }),
    );
    expect(got).toEqual({ spot: "luzhniki", date: "2026-10-03", page: "2" });
  });

  it("form: true у ответа на шаг формы", () => {
    expect(auditParams(intent({ report: "run.plan.set", form: true, source: "text" }))).toEqual({ form: true });
    expect(auditParams(intent())).toEqual({});
  });
});

describe("recordAudit", () => {
  it("raw_text пишет только у unknown и режет до лимита", async () => {
    const store = new MemoryStore();
    await recordAudit(store, entry({ report: "unknown", raw_text: "я".repeat(AUDIT_RAW_TEXT_MAX + 50) }));
    await recordAudit(store, entry({ report: "run.card", raw_text: "сколько на субботу" }));
    expect(store.audit[0].raw_text).toHaveLength(AUDIT_RAW_TEXT_MAX);
    expect(store.audit[1].raw_text).toBeNull();
  });

  it("сбой writeAudit не бросает и не пишет chat_id в лог", async () => {
    const store = new MemoryStore();
    vi.spyOn(store, "writeAudit").mockRejectedValue(new Error("boom"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordAudit(store, entry())).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain(String(CHAT));
  });
});

describe("buildAuditEntry", () => {
  it("собирает строку из разбора и считает задержку", () => {
    const e = buildAuditEntry({
      chatId: CHAT,
      zone: "smm",
      intent: intent({ report: "tr.code", params: { code: "IGST-0310", period: "30d", target: "1" }, source: "text" }),
      ok: true,
      startedAt: 1_000,
      now: 1_250,
    });
    expect(e).toEqual({
      chat_id: CHAT,
      zone: "smm",
      report: "tr.code",
      params: { code: "IGST-0310", period: "30d" },
      source: "text",
      ok: true,
      error: null,
      latency_ms: 250,
      raw_text: null,
    });
  });

  it("report перекрывает intent, без intent — пустые params и source null", () => {
    const stale = buildAuditEntry({
      chatId: CHAT,
      zone: "council",
      intent: intent(),
      report: "stale",
      ok: false,
      startedAt: 5,
      now: 5,
    });
    expect(stale.report).toBe("stale");
    const none = buildAuditEntry({ chatId: CHAT, zone: null, intent: null, report: "no_member", ok: false, startedAt: 0, now: 3 });
    expect(none).toMatchObject({ report: "no_member", params: {}, source: null, zone: null, latency_ms: 3 });
  });

  it("raw_text переносит из intent, а до базы доходит только у unknown", async () => {
    const store = new MemoryStore();
    const unknown = buildAuditEntry({
      chatId: CHAT,
      zone: "events",
      intent: intent({ report: "unknown", section: null, action: "unknown", source: "text", rawText: "что-то непонятное" }),
      ok: true,
      error: "not_understood",
      startedAt: 0,
      now: 1,
    });
    expect(unknown.raw_text).toBe("что-то непонятное");
    expect(unknown.error).toBe("not_understood");
    await recordAudit(store, unknown);
    expect(store.audit[0].raw_text).toBe("что-то непонятное");
  });
});
