import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * Публичный клиент (anon key) — для использования в браузере и в RLS-контексте
 * пользователя.
 */
export const supabase = createClient(url, anonKey);

/**
 * Серверный клиент с service-ролью. Обходит RLS — использовать ТОЛЬКО на сервере
 * (route handlers, server actions), никогда не отдавать в браузер.
 */
export function createServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? "";
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
