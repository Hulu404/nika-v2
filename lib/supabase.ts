import { createBrowserClient, createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const newBrowserClient = () =>
  createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);

/** Общий инстанс на вкладку. Заполняется при первом вызове в браузере. */
let _browserClient: ReturnType<typeof newBrowserClient> | null = null;

/**
 * Клиент для браузера (Client Components). Использует anon-ключ и работает
 * в контексте RLS текущего пользователя.
 *
 * Ленивый singleton: на вкладку должен жить ровно один GoTrueClient. Несколько
 * независимых инстансов заводят каждый свой таймер авто-рефреша и наперегонки
 * тратят один и тот же ротируемый refresh-токен — проигравший получает
 * "Invalid Refresh Token: Refresh Token Not Found" и выкидывает пользователя
 * (плюс "Multiple GoTrueClient instances detected" в консоли).
 *
 * Имя и сигнатура прежние, так что `useState(() => createClientComponentClient())`
 * в компонентах продолжает работать — просто получает общий инстанс.
 */
export function createClientComponentClient() {
  // SSR: клиентские компоненты рендерятся и на сервере. Там кэшировать нельзя —
  // модульная переменная переживает запросы, и один пользователь получил бы
  // клиент другого. Отдаём одноразовый инстанс (без сессии и авто-рефреша).
  if (typeof window === "undefined") return newBrowserClient();

  if (_browserClient) return _browserClient;
  _browserClient = newBrowserClient();
  return _browserClient;
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
