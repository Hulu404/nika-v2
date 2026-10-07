import { tgAdmin } from "../../telegram/supabase";

/**
 * Снимки подписчиков (social_snapshots), настройки (team_settings) и отметки
 * «уже сделали сегодня» (team_digests, тот же реестр, что у сводок «Пятницы»).
 * Миграция 049.
 */

export type Platform = "telegram" | "instagram";

export interface Snapshot {
  platform: Platform;
  followers: number;
  source: "auto" | "manual";
  taken_at: string;
  entered_by: number | null;
}

export interface SocialStore {
  addSnapshot(row: Omit<Snapshot, "taken_at">, now: Date): Promise<void>;
  latest(platform: Platform): Promise<Snapshot | null>;
  /** Последний снимок, сделанный не позже момента at. */
  latestAtOrBefore(platform: Platform, at: Date): Promise<Snapshot | null>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null, by: number, now: Date): Promise<void>;
  /** Занять разовое действие (kind, slot, день). false — уже делали. */
  claim(kind: string, slot: string, ymd: string): Promise<boolean>;
}

export function supabaseSocialStore(): SocialStore {
  const snaps = () => tgAdmin().from("social_snapshots");
  return {
    async addSnapshot(row, now) {
      const { error } = await snaps().insert({ ...row, taken_at: now.toISOString() });
      if (error) throw new Error(`social_snapshots: ${error.message}`);
    },
    async latest(platform) {
      const { data, error } = await snaps().select("platform, followers, source, taken_at, entered_by").eq("platform", platform)
        .order("taken_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(`social_snapshots: ${error.message}`);
      return (data as Snapshot | null) ?? null;
    },
    async latestAtOrBefore(platform, at) {
      const { data, error } = await snaps().select("platform, followers, source, taken_at, entered_by").eq("platform", platform).lte("taken_at", at.toISOString())
        .order("taken_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(`social_snapshots: ${error.message}`);
      return (data as Snapshot | null) ?? null;
    },
    async getSetting(key) {
      const { data, error } = await tgAdmin().from("team_settings").select("value").eq("key", key).maybeSingle();
      if (error) throw new Error(`team_settings: ${error.message}`);
      return ((data as { value: string | null } | null)?.value ?? null) || null;
    },
    async setSetting(key, value, by, now) {
      const { error } = await tgAdmin().from("team_settings")
        .upsert({ key, value, updated_by: by, updated_at: now.toISOString() }, { onConflict: "key" });
      if (error) throw new Error(`team_settings: ${error.message}`);
    },
    async claim(kind, slot, ymd) {
      const { error } = await tgAdmin().from("team_digests").insert({ kind, spot: slot, run_date: ymd, sent_to: 0 });
      if (!error) return true;
      if (error.code !== "23505") console.error("[founders] claim:", error.message);
      return false;
    },
  };
}

/** Для тестов. */
export class MemorySocialStore implements SocialStore {
  snapshots: Snapshot[] = [];
  settings = new Map<string, string>();
  claimed = new Set<string>();
  async addSnapshot(row: Omit<Snapshot, "taken_at">, now: Date) {
    this.snapshots.push({ ...row, taken_at: now.toISOString() });
  }
  private of(platform: Platform) {
    return this.snapshots.filter((s) => s.platform === platform).sort((a, b) => Date.parse(b.taken_at) - Date.parse(a.taken_at));
  }
  async latest(platform: Platform) {
    return this.of(platform)[0] ?? null;
  }
  async latestAtOrBefore(platform: Platform, at: Date) {
    return this.of(platform).find((s) => Date.parse(s.taken_at) <= at.getTime()) ?? null;
  }
  async getSetting(key: string) {
    return this.settings.get(key) ?? null;
  }
  async setSetting(key: string, value: string | null) {
    if (value === null) this.settings.delete(key);
    else this.settings.set(key, value);
  }
  async claim(kind: string, slot: string, ymd: string) {
    const k = `${kind}|${slot}|${ymd}`;
    if (this.claimed.has(k)) return false;
    this.claimed.add(k);
    return true;
  }
}
