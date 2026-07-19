import type { StorageAdapter } from "grammy";
import { tgAdmin } from "./supabase";

/**
 * StorageAdapter для grammY-сессий поверх Supabase (таблица public.tg_sessions).
 * Заменяет in-memory сессию: при webhook каждый апдейт приходит в новый инстанс
 * роута, поэтому состояние чата (текущий сценарий, история) держим в БД.
 * Клиент — общий сервисный из ./supabase (обходит RLS, без "server-only").
 */
const db = tgAdmin;

export function supabaseSessionStorage<T>(): StorageAdapter<T> {
  return {
    async read(key: string): Promise<T | undefined> {
      const { data } = await db()
        .from("tg_sessions")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      return (data?.value as T | undefined) ?? undefined;
    },
    async write(key: string, value: T): Promise<void> {
      await db()
        .from("tg_sessions")
        .upsert(
          { key, value, updated_at: new Date().toISOString() },
          { onConflict: "key" },
        );
    },
    async delete(key: string): Promise<void> {
      await db().from("tg_sessions").delete().eq("key", key);
    },
  };
}
