import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getBot } from "@/lib/telegram/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Сервисный клиент для идемпотентности по update_id (обходит RLS). Ленивый.
// Тип SupabaseClient (без Database-дженерика) намеренно — таблица processed_updates
// не заведена в types/database.ts (служебная, доступ только сервисной ролью).
let _db: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (_db) return _db;
  _db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _db;
}

/**
 * Приём апдейтов Telegram (webhook). Telegram шлёт POST-ом; на не-200 он ретраит,
 * поэтому мы всегда отвечаем 200 (кроме неверного секрета — там 401).
 *
 * Секрет вебхука сверяем по заголовку X-Telegram-Bot-Api-Secret-Token.
 * Идемпотентность — по update_id через таблицу processed_updates.
 */
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const provided = req.headers.get("x-telegram-bot-api-secret-token");
  if (!secret || provided !== secret) {
    // Тело не читаем и не обрабатываем.
    return new Response("Unauthorized", { status: 401 });
  }

  let update: { update_id?: number } & Record<string, unknown>;
  try {
    update = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // ── Идемпотентность: не обрабатываем один update_id дважды ──────────────────
  const updateId = update.update_id;
  if (typeof updateId === "number") {
    const { error } = await db().from("processed_updates").insert({ update_id: updateId });
    if (error) {
      // 23505 — unique violation → апдейт уже виден, выходим без повторной обработки.
      if (error.code === "23505") {
        return new Response("OK", { status: 200 });
      }
      // Иная ошибка записи не должна ронять ответ — логируем без секретов и продолжаем.
      console.error("[tg-webhook] processed_updates insert:", error.message);
    }
  }

  // ── Передаём апдейт в grammY. Ошибки внутри не превращаем в не-200 ───────────
  try {
    const bot = getBot();
    if (!bot.isInited()) await bot.init();
    await bot.handleUpdate(update as Parameters<typeof bot.handleUpdate>[0]);
  } catch (err) {
    console.error("[tg-webhook] handleUpdate:", err instanceof Error ? err.message : String(err));
  }

  return new Response("OK", { status: 200 });
}
