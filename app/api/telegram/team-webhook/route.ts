import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getTeamBot } from "@/lib/team/bot";
import { teamBotConfigured } from "@/lib/team/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Приём апдейтов внутреннего бота команды. Устроен как основной вебхук
 * (app/api/telegram/webhook), с двумя отличиями:
 *
 *   • свой секрет TEAM_WEBHOOK_SECRET — общий секрет означал бы, что апдейты
 *     одного бота принимает роут другого;
 *   • дедуп по паре (bot, update_id), а не по одному update_id: нумерация
 *     апдейтов у каждого бота своя, с нуля, и по общему ключу апдейт №7
 *     командного бота встретил бы в таблице №7 основного и был бы МОЛЧА
 *     выброшен как повтор. Составной ключ заводит миграция 035.
 *
 * Как и там, всегда отвечаем 200 (кроме неверного секрета): на не-200 Telegram
 * ретраит, и одна упавшая команда превратилась бы в поток повторов.
 */
const BOT_KEY = "team";

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

export async function POST(req: Request) {
  const secret = process.env.TEAM_WEBHOOK_SECRET;
  const provided = req.headers.get("x-telegram-bot-api-secret-token");
  if (!secret || provided !== secret) {
    // Тело не читаем и не обрабатываем.
    return new Response("Unauthorized", { status: 401 });
  }

  // Секрет верный, а бота нет — окружение недонастроено. Это не повод копить
  // очередь у Telegram: отвечаем 200 и шумим в лог.
  if (!teamBotConfigured()) {
    console.error("[team-webhook] апдейт пришёл, а TEAM_BOT_TOKEN не задан");
    return new Response("OK", { status: 200 });
  }

  let update: { update_id?: number } & Record<string, unknown>;
  try {
    update = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const updateId = update.update_id;
  if (typeof updateId === "number") {
    const { error } = await db()
      .from("processed_updates")
      .insert({ update_id: updateId, bot: BOT_KEY });
    if (error) {
      // 23505 — unique violation → апдейт уже видели, выходим.
      if (error.code === "23505") return new Response("OK", { status: 200 });
      // Иная ошибка (например, миграция 035 ещё не применена и столбца bot
      // нет) не должна лишать команду ответа: шумим и обрабатываем дальше.
      console.error("[team-webhook] processed_updates insert:", error.message);
    }
  }

  try {
    const bot = getTeamBot();
    if (!bot.isInited()) await bot.init();
    await bot.handleUpdate(update as Parameters<typeof bot.handleUpdate>[0]);
  } catch (err) {
    console.error("[team-webhook] handleUpdate:", err instanceof Error ? err.message : String(err));
  }

  return new Response("OK", { status: 200 });
}
