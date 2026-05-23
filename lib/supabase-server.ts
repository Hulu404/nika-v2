import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

/**
 * Админ-клиент с service-role ключом. ОБХОДИТ RLS.
 * Только для доверенных серверных операций: вебхуки оплат ЮKassa,
 * обновление pro-статуса пользователя и т.п.
 *
 * `import "server-only"` гарантирует, что модуль никогда не попадёт в
 * клиентский бандл.
 */
export function createServiceRoleClient() {
  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
