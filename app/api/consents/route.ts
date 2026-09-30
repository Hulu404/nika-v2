import { createServerComponentClient } from "@/lib/supabase";
import { getConsentStates, recordConsents, requestMeta } from "@/lib/consents";
import { CONSENT_TYPES, isConsentType, type ConsentType } from "@/lib/legal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCES = new Set(["signup", "health_gate", "profile", "cookie_banner"]);

/** Текущее состояние согласий пользователя. */
export async function GET() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const states = await getConsentStates(supabase, user.id, CONSENT_TYPES);
  return Response.json({ consents: states });
}

/**
 * Записывает согласие или отзыв. Тело: { entries: [{ type, granted }], source }.
 * Версию документа, IP и user-agent ставит сервер.
 */
export async function POST(req: Request) {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { entries?: unknown; source?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const source = typeof body.source === "string" && SOURCES.has(body.source) ? body.source : null;
  const raw = Array.isArray(body.entries) ? body.entries : [];
  const entries: { type: ConsentType; granted: boolean }[] = [];
  for (const e of raw.slice(0, 4)) {
    const item = e as { type?: unknown; granted?: unknown };
    if (!isConsentType(item.type) || typeof item.granted !== "boolean") {
      return Response.json({ error: "Invalid entry" }, { status: 400 });
    }
    entries.push({ type: item.type, granted: item.granted });
  }
  if (!source || entries.length === 0) return Response.json({ error: "Invalid body" }, { status: 400 });

  const err = await recordConsents(user.id, entries, { ...requestMeta(req), source });
  if (err) {
    console.error("[consents] insert failed:", err);
    return Response.json({ error: "DB error" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
