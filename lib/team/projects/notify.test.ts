import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../databot/data/memory-store";
import { sendAssignedReminders } from "../../databot/assigned-reminders";
import type { AssignedTask } from "../../databot/task-list";
import type { TeamMember } from "../access";
import { currentSlot, founderDigestText } from "../founders/digest";
import { syncTeamTaskMembers } from "../tasks";
import { configureLabels, projectPrefix } from "./labels";
import { MemoryMembershipStore } from "./members";
import { DEFAULT_PROJECTS, MemoryProjectStore, NIKA, RESCAN } from "./projects";

const msk = (local: string) => new Date(`${local}+03:00`);
const member = (chat_id: number, username: string): TeamMember => ({
  chat_id, username, display_name: username, role: "member", joined_at: "2026-10-01T00:00:00Z", added_by: null, last_seen_at: null, digest_opt_in: true,
});
const VIKA = 4;
const SALMA = 7;

describe("метки проекта в уведомлениях", () => {
  beforeEach(async () => {
    vi.stubEnv("TEAM_FOUNDER_IDS", "9");
    const memberships = new MemoryMembershipStore();
    await memberships.add({ project_id: NIKA, chat_id: VIKA }, new Date());
    await memberships.add({ project_id: RESCAN, chat_id: VIKA }, new Date());
    await memberships.add({ project_id: NIKA, chat_id: SALMA }, new Date());
    configureLabels({ projects: new MemoryProjectStore(), memberships });
  });
  afterEach(() => {
    configureLabels(null);
    vi.unstubAllEnvs();
  });

  it("человеку в нескольких проектах — метка, в одном — без метки", async () => {
    expect(await projectPrefix(VIKA, RESCAN)).toBe("🔬 RESCAN · ");
    expect(await projectPrefix(VIKA, NIKA)).toBe("🏃 NIKA · ");
    expect(await projectPrefix(VIKA, null)).toBe("🏃 NIKA · ");
    expect(await projectPrefix(SALMA, NIKA)).toBe("");
    expect(await projectPrefix(9, RESCAN)).toBe("🔬 RESCAN · ");
  });

  it("напоминание о сроке: «🔬 RESCAN · Через 3 часа срок: …» и кнопка карточки в её проекте", async () => {
    const now = msk("2026-10-14T15:00");
    const store = new MemoryStore();
    store.clock = () => msk("2026-10-14T09:00");
    await syncTeamTaskMembers({ store }, now, [member(9, "dima"), member(VIKA, "vika"), member(SALMA, "salma")]);
    const due = msk("2026-10-14T17:30").toISOString();
    await store.importAssignedTasks(9, 1, [{ line: 1, username: "vika", what: "Макет пациента", due_at: due }], { projectId: RESCAN });
    await store.importAssignedTasks(9, 2, [{ line: 1, username: "salma", what: "Пейсеры", due_at: due }]);
    const sent: Array<{ chat: number; text: string; buttons: string[] }> = [];
    const api = { sendMessage: async (chat: number, text: string, other?: { reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } }) => {
      sent.push({ chat, text, buttons: (other?.reply_markup?.inline_keyboard ?? []).flat().map((b) => `${b.text}|${b.callback_data}`) });
      return {} as never;
    } };
    await sendAssignedReminders({ store, api: api as never, label: projectPrefix,
      cardButton: (t: AssignedTask) => ({ text: "Открыть задачу", callback_data: `tk:o:${t.id}:me:0` }) }, now);
    const toVika = sent.find((s) => s.chat === VIKA)!;
    expect(toVika.text.startsWith("🔬 RESCAN · ⏰ <b>Через 3 часа срок:")).toBe(true);
    expect(toVika.buttons).toContain("Открыть задачу|tk:o:1:me:0");
    const toSalma = sent.find((s) => s.chat === SALMA)!;
    expect(toSalma.text.startsWith("⏰ <b>Через 3 часа срок:")).toBe(true);
  });
});

describe("сводка фаундерам по проектам", () => {
  const slot = currentSlot(msk("2026-10-14T22:30"));
  const now = msk("2026-10-14T22:30");
  const task = (patch: Partial<AssignedTask>): AssignedTask => ({
    id: 1, line: 1, username: "vika", what: "x", due_at: null, source_chat_id: 1, source_message_id: 1, assignee_id: VIKA, assigned_by: 9,
    created_at: msk("2026-10-14T10:00").toISOString(), delivery_state: "sent", delivered_message_id: 1, status: "open",
    status_at: msk("2026-10-14T10:00").toISOString(), reminded_at: null, overdue_notified_at: null, ...patch,
  });

  it("блоки 🏃 NIKA (задачи, команда, соцсети) и 🔬 RESCAN (план развития, задачи)", () => {
    const team = [member(9, "dima"), member(VIKA, "vika")];
    const text = founderDigestText({
      slot, now, tasks: [], team, founders: [9], social: [],
      blocks: [
        { project: DEFAULT_PROJECTS[0], tasks: [task({ id: 1, what: "Пост в ТГК", status: "done", status_at: msk("2026-10-14T15:00").toISOString() })], team, extra: [] },
        { project: DEFAULT_PROJECTS[1], tasks: [task({ id: 2, what: "B1 каркас", status: "done", status_at: msk("2026-10-14T16:00").toISOString(), project_id: RESCAN })], team,
          extra: ["⏳ КТ1 · пт 16.10 · не выполнено условий: 4", "⚠️ Просрочено пунктов плана: 1"] },
      ],
    });
    const [nikaPart, rescanPart] = text.split("🔬 RESCAN");
    expect(text.startsWith("Сводка 22:30 · 14 октября\n\n🏃 NIKA\nЗадачи")).toBe(true);
    expect(nikaPart).toContain("✅ Выполнено: 1");
    expect(nikaPart).toContain("· @vika · Пост в ТГК");
    expect(nikaPart).toContain("Команда");
    expect(nikaPart).toContain("Соцсети");
    expect(rescanPart).toContain("⏳ КТ1 · пт 16.10 · не выполнено условий: 4");
    expect(rescanPart).toContain("· @vika · B1 каркас");
    expect(rescanPart).not.toContain("Команда");
    expect(rescanPart).not.toContain("Соцсети");
  });

  it("один проект — сводка как раньше, без названий проектов", () => {
    const text = founderDigestText({ slot, now, tasks: [], team: [member(9, "dima")], founders: [9], social: [], blocks: [{ project: DEFAULT_PROJECTS[0], tasks: [], team: [], extra: [] }] });
    expect(text).not.toContain("🏃 NIKA");
    expect(text).toContain("Соцсети");
  });
});
