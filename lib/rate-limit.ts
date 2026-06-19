import "server-only";
import { createServiceRoleClient } from "@/lib/supabase-server";

/**
 * Серверный rate limiting через Postgres (функция check_rate_limit, см.
 * supabase/migrations/007_rate_limits.sql). Счётчики живут в таблице
 * rate_limits, к которой имеет доступ только service-role.
 *
 * Зовём через service-role клиент намеренно: функция закрыта для anon/
 * authenticated, ключ лимита формируется на сервере, поэтому пользователь не
 * может подделать чужой счётчик.
 *
 * @param key            идентификатор лимита, например `chat:<userId>`
 * @param limit          максимум запросов за окно
 * @param windowSeconds  длина окна в секундах
 * @returns true — запрос в пределах лимита; false — лимит исчерпан
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    // Fail-open: если лимитер недоступен, не блокируем легитимных пользователей.
    // Лимитер — backstop против abuse, а не единственная защита; падение БД не
    // должно ронять чат. Логируем, чтобы заметить проблему.
    console.error("[rate-limit] check_rate_limit rpc failed:", error.message);
    return true;
  }

  return data === true;
}
