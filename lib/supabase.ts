import { cookies } from "next/headers";
import { createBrowserClient, createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Клиент для браузера (Client Components). Использует anon-ключ и работает
 * в контексте RLS текущего пользователя.
 *
 * Внимание: этот модуль также инициализирует серверный клиент через
 * next/headers, поэтому импортировать его в Client Component можно только если
 * сборка не тянет серверную часть. Если понадобится использовать браузерный
 * клиент в "use client"-компоненте и Next пожалуется на next/headers — вынести
 * createClientComponentClient в отдельный файл lib/supabase-client.ts.
 */
export function createClientComponentClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/**
 * Клиент для серверных компонентов/route handlers. Читает и обновляет сессию
 * через cookies. Работает в контексте RLS текущего пользователя.
 */
export function createServerComponentClient() {
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
