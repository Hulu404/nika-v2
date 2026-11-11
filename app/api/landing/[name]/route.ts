import { isLandingName } from "@/lib/landings/events";
import { LANDING_CACHE_CONTROL, renderLanding } from "@/lib/landings/render";

/**
 * Лендинги событий (/coffeerunsurfsport, /coffeerunsurfcave, /coffeerunluzhniki,
 * /stretch, /read). Сюда их переписывает next.config.mjs, адрес в браузере не
 * меняется. HTML лежит в landings/<имя>.html, дату, время и адрес сервер
 * подставляет из lib/coffeerun/run.ts и lib/clubs/sessions.ts на каждый запрос.
 *
 * nodejs, а не edge: шаблон читается с диска. force-dynamic: иначе Next
 * собрал бы страницу один раз при сборке и перестал бы переключать событие,
 * когда прошлое закончилось.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(_request: Request, { params }: { params: { name: string } }) {
  const html = isLandingName(params.name) ? renderLanding(params.name) : null;
  if (!html) return new Response("Not found", { status: 404 });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Сюда не доходит сессия Supabase (маршрут вне матчера middleware.ts),
      // поэтому Set-Cookie в ответе не бывает и публичный кэш безопасен.
      // Если cookies здесь когда-нибудь появятся, нужен no-store, как в
      // rewriteLanding в middleware.ts.
      "Cache-Control": LANDING_CACHE_CONTROL,
    },
  });
}
