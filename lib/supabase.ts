import { createBrowserClient, createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Клиент для браузера (Client Components). Использует anon-ключ и работает
 * в контексте RLS текущего пользователя.
 */
export function createClientComponentClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/**
 * Клиент для серверных компонентов и route handlers. Читает/обновляет сессию
 * через cookies, работает в контексте RLS текущего пользователя.
 *
 * `next/headers` подгружается динамически, чтобы этот модуль оставался
 * безопасным для импорта из Client Components (там нужен только браузерный
 * клиент выше). Поэтому функция асинхронная: `await createServerComponentClient()`.
 */
export async function createServerComponentClient() {
  const { cookies } = await import("next/headers");
  const cookieStore = cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Вызвано из Server Component, где запись cookies запрещена —
          // обновление сессии берёт на себя middleware.
        }
      },
    },
  });
}
