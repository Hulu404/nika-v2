import { createServiceRoleClient } from "@/lib/supabase-server";
import { getConsentStates } from "@/lib/consents";
import { getAuthed, unauthorized, badRequest, readJson } from "@/lib/v2/http";

export const runtime = "nodejs";

/**
 * Продуктовые события приложения в analytics_events. Только из белого списка и только
 * со структурными параметрами (без личных данных). Пишутся, только если человек
 * согласился на аналитические cookie (как Метрика и Amplitude по Политике).
 */
const EVENTS: Record<string, Record<string, readonly string[]>> = {
  upsell_view: { placement: ["today", "profile"], variant: ["a", "b"] },
  upsell_click: { placement: ["today", "profile"], variant: ["a", "b"] },
};

export async function POST(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const body = await readJson(req);
  const event = typeof body?.event === "string" ? body.event : "";
  const schema = EVENTS[event];
  if (!schema) return badRequest("event");

  const src = (body?.props ?? {}) as Record<string, unknown>;
  const props: Record<string, string> = {};
  for (const [k, allowed] of Object.entries(schema)) {
    const v = src[k];
    if (typeof v !== "string" || !allowed.includes(v)) return badRequest("props");
    props[k] = v;
  }

  const consent = (await getConsentStates(authed.supabase, authed.user.id, ["cookies_analytics"])).cookies_analytics;
  if (!consent.granted) return Response.json({ ok: true, skipped: "no_consent" });

  const { error } = await createServiceRoleClient()
    .from("analytics_events")
    .insert({ event, user_id: authed.user.id, props, platform: "web", path: "/" });
  if (error) console.error("[api/v2/event]", error.message);
  return Response.json({ ok: true });
}
