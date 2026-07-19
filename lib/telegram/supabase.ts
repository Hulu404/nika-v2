import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Сервисный Supabase-клиент для бота (обходит RLS). Ленивый, БЕЗ "server-only" —
 * этот модуль импортируется и webhook-роутом, и dev-скриптом polling (обычный
 * node/tsx), где "server-only" бросил бы исключение.
 *
 * Тип SupabaseClient (без Database-дженерика) намеренно — часть таблиц бота
 * служебные и не описаны в types/database.ts.
 */
let _client: SupabaseClient | null = null;

export function tgAdmin(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase env (URL / SERVICE_ROLE_KEY) не задан для telegram");
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
