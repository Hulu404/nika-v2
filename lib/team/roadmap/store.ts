import { tgAdmin } from "../../telegram/supabase";

/**
 * План развития проекта (roadmap_items, миграция 060). Контрольная точка
 * (milestone), этап (stage) и пункт (item); пункт может быть условием
 * контрольной точки. Код (КТ1, B4) уникален в проекте — по нему сид
 * идемпотентен, по нему же пункт называют в разговоре.
 */

export type RoadmapKind = "milestone" | "stage" | "item";
export type RoadmapStatus = "planned" | "in_progress" | "done" | "blocked" | "dropped";

export interface RoadmapItem {
  id: number;
  project_id: string;
  kind: RoadmapKind;
  code: string | null;
  title: string;
  details: string | null;
  group: string | null;
  milestone_id: number | null;
  start_date: string | null;
  due_date: string | null;
  status: RoadmapStatus;
  owner_chat_id: number | null;
  sort: number;
  updated_by: number | null;
  updated_at: string;
}

export type NewRoadmapItem = Omit<RoadmapItem, "id" | "updated_at" | "updated_by" | "milestone_id"> & {
  /** Код контрольной точки, условием которой пункт является (для сида). */
  milestone_code?: string | null;
};

export type RoadmapPatch = Partial<Pick<RoadmapItem, "status" | "owner_chat_id" | "due_date" | "title" | "details">>;

export interface RoadmapStore {
  list(projectId: string): Promise<RoadmapItem[]>;
  get(id: number): Promise<RoadmapItem | null>;
  update(id: number, patch: RoadmapPatch, by: number, now: Date): Promise<RoadmapItem | null>;
  create(row: NewRoadmapItem, by: number, now: Date): Promise<RoadmapItem>;
  remove(id: number): Promise<boolean>;
  /**
   * Сид: пункты с кодом, которых ещё нет, — добавить; у существующих
   * заполнить пустого ответственного. Возвращает, сколько добавлено.
   */
  seed(projectId: string, rows: readonly NewRoadmapItem[], now: Date): Promise<number>;
}

const STATUSES: readonly RoadmapStatus[] = ["planned", "in_progress", "done", "blocked", "dropped"];
export const isRoadmapStatus = (s: unknown): s is RoadmapStatus => STATUSES.includes(s as RoadmapStatus);

/** Строку для вставки: без milestone_code, с milestone_id. */
const insertable = (r: NewRoadmapItem, milestoneId: number | null, now: Date, by: number | null) => {
  const { milestone_code: _code, ...rest } = r;
  return { ...rest, milestone_id: milestoneId, updated_by: by, updated_at: now.toISOString() };
};

export function supabaseRoadmapStore(): RoadmapStore {
  const t = () => tgAdmin().from("roadmap_items");
  const fail = (e: { message: string }) => new Error(`roadmap_items: ${e.message}`);
  const store: RoadmapStore = {
    async list(projectId) {
      const { data, error } = await t().select("*").eq("project_id", projectId).order("sort").order("id");
      if (error) throw fail(error);
      return (data ?? []) as RoadmapItem[];
    },
    async get(id) {
      const { data, error } = await t().select("*").eq("id", id).maybeSingle();
      if (error) throw fail(error);
      return (data as RoadmapItem | null) ?? null;
    },
    async update(id, patch, by, now) {
      const { data, error } = await t().update({ ...patch, updated_by: by, updated_at: now.toISOString() }).eq("id", id).select("*").maybeSingle();
      if (error) throw fail(error);
      return (data as RoadmapItem | null) ?? null;
    },
    async create(row, by, now) {
      const milestone = row.milestone_code ? (await store.list(row.project_id)).find((i) => i.kind === "milestone" && i.code === row.milestone_code) : null;
      const { data, error } = await t().insert(insertable(row, milestone?.id ?? null, now, by)).select("*").single();
      if (error) throw fail(error);
      return data as RoadmapItem;
    },
    async remove(id) {
      const { data, error } = await t().delete().eq("id", id).select("id");
      if (error) throw fail(error);
      return (data ?? []).length === 1;
    },
    async seed(projectId, rows, now) {
      return seedInto(store, projectId, rows, now, async (batch) => {
        const { error } = await t().upsert(batch, { onConflict: "project_id,code", ignoreDuplicates: true });
        if (error) throw fail(error);
      });
    },
  };
  return store;
}

/** Общая логика сида: сначала контрольные точки (на них ссылаются условия), потом остальное. */
async function seedInto(
  store: Pick<RoadmapStore, "list" | "update">,
  projectId: string,
  rows: readonly NewRoadmapItem[],
  now: Date,
  insert: (batch: Array<ReturnType<typeof insertable>>) => Promise<void>,
): Promise<number> {
  let existing = await store.list(projectId);
  const has = new Set(existing.map((i) => i.code));
  const fresh = rows.filter((r) => r.code && !has.has(r.code));
  const milestones = fresh.filter((r) => r.kind === "milestone");
  if (milestones.length) {
    await insert(milestones.map((r) => insertable(r, null, now, null)));
    existing = await store.list(projectId);
  }
  const byCode = new Map(existing.map((i) => [i.code, i] as const));
  const rest = fresh.filter((r) => r.kind !== "milestone");
  if (rest.length) await insert(rest.map((r) => insertable(r, r.milestone_code ? byCode.get(r.milestone_code)?.id ?? null : null, now, null)));
  // Ответственный, которого не было при первом сиде (человек ещё не писал боту), — заполнить.
  for (const r of rows) {
    const cur = byCode.get(r.code);
    if (cur && !cur.owner_chat_id && r.owner_chat_id) await store.update(cur.id, { owner_chat_id: r.owner_chat_id }, 0, now);
  }
  return fresh.length;
}

export class MemoryRoadmapStore implements RoadmapStore {
  items = new Map<number, RoadmapItem>();
  private seq = 0;
  async list(projectId: string) {
    return [...this.items.values()].filter((i) => i.project_id === projectId).sort((a, b) => a.sort - b.sort || a.id - b.id).map((i) => ({ ...i }));
  }
  async get(id: number) {
    const i = this.items.get(id);
    return i ? { ...i } : null;
  }
  async update(id: number, patch: RoadmapPatch, by: number, now: Date) {
    const i = this.items.get(id);
    if (!i) return null;
    Object.assign(i, patch, { updated_by: by, updated_at: now.toISOString() });
    return { ...i };
  }
  async create(row: NewRoadmapItem, by: number, now: Date) {
    const milestone = row.milestone_code ? [...this.items.values()].find((i) => i.project_id === row.project_id && i.kind === "milestone" && i.code === row.milestone_code) : null;
    const item = { id: ++this.seq, ...insertable(row, milestone?.id ?? null, now, by) } as RoadmapItem;
    this.items.set(item.id, item);
    return { ...item };
  }
  async remove(id: number) {
    return this.items.delete(id);
  }
  async seed(projectId: string, rows: readonly NewRoadmapItem[], now: Date) {
    return seedInto(this, projectId, rows, now, async (batch) => {
      for (const b of batch) {
        if ([...this.items.values()].some((i) => i.project_id === b.project_id && i.code === b.code)) continue;
        const item = { id: ++this.seq, ...b } as RoadmapItem;
        this.items.set(item.id, item);
      }
    });
  }
}
