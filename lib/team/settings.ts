import { tgAdmin } from "../telegram/supabase";

/**
 * Настройки команды в team_settings (миграция 049): ключ — значение, меняются
 * из бота без деплоя.
 */

export interface SettingsStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | null, by: number | null, now: Date): Promise<void>;
}

export function supabaseSettingsStore(): SettingsStore {
  const t = () => tgAdmin().from("team_settings");
  return {
    async get(key) {
      const { data, error } = await t().select("value").eq("key", key).maybeSingle();
      if (error) throw new Error(`team_settings: ${error.message}`);
      return (data as { value: string | null } | null)?.value ?? null;
    },
    async set(key, value, by, now) {
      const { error } = await t().upsert({ key, value, updated_by: by, updated_at: now.toISOString() }, { onConflict: "key" });
      if (error) throw new Error(`team_settings: ${error.message}`);
    },
  };
}

export class MemorySettingsStore implements SettingsStore {
  values = new Map<string, string | null>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string | null) {
    this.values.set(key, value);
  }
}
