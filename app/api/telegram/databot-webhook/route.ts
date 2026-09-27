import type { Update } from "grammy/types";
import { handleUpdate } from "@/lib/databot/bot";
import { databotConfigured } from "@/lib/databot/config";
import { tgAdmin } from "@/lib/telegram/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Приём апдейтов бота данных команды. Образец — team-webhook:
 *
 *   • свой секрет DATABOT_WEBHOOK_SECRET; неверный → 401, тело не читаем;
 *   • дедуп по паре (bot, update_id) с bot = 'data': у каждого бота своя
 *     нумерация апдейтов, и по общему ключу апдейт одного бота выбросил бы
 *     апдейт другого как повтор;
 *   • всегда 200, кроме неверного секрета (401) и нечитаемого тела (400): на
 *     любой другой ответ Telegram повторяет апдейт, и одна упавшая команда
 *     превратилась бы в поток повторов.
 */
const BOT_KEY = "data";

export async function POST(req: Request) {
  const secret = process.env.DATABOT_WEBHOOK_SECRET;
  const provided = req.headers.get("x-telegram-bot-api-secret-token");
  if (!secret || provided !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Секрет верный, а токена нет — окружение недонастроено. Очередь у Telegram
  // копить незачем: 200 и строка в лог.
  if (!databotConfigured()) {
    console.error("[databot-webhook] апдейт пришёл, а DATABOT_TOKEN не задан");
    return new Response("OK", { status: 200 });
  }

  let update: Update;
  try {
    update = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const updateId = update?.update_id;
  if (typeof updateId === "number") {
    try {
      const { error } = await tgAdmin()
        .from("processed_updates")
        .insert({ update_id: updateId, bot: BOT_KEY });
      if (error) {
        // 23505 — апдейт уже видели.
        if (error.code === "23505") return new Response("OK", { status: 200 });
        // Иная ошибка не должна лишать человека ответа: шумим и обрабатываем.
        console.error("[databot-webhook] processed_updates insert:", error.message);
      }
    } catch (err) {
      console.error("[databot-webhook] processed_updates:", err instanceof Error ? err.message : String(err));
    }
  }

  try {
    await handleUpdate(update);
  } catch (err) {
    console.error("[databot-webhook] handleUpdate:", err instanceof Error ? err.message : String(err));
  }

  return new Response("OK", { status: 200 });
}
