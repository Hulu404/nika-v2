import { createServerComponentClient } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordConsents, requestMeta } from "@/lib/consents";
import { getPublicOrigin } from "@/lib/public-origin";
import { badRequest, readJson, serverError } from "@/lib/v2/http";
import { PASSWORD_MIN, isEmail } from "@/lib/v2/validate";

export const runtime = "nodejs";

/**
 * Регистрация из новой версии. Отметки оферты и согласия ПДН обязательны.
 * Сессия ставится в cookie этим же ответом. Если в Supabase включено
 * подтверждение почты, сессии нет: отметки едут в user_metadata и попадают
 * в журнал в /auth/callback.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return badRequest();
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!isEmail(email)) return badRequest("email");
  if (password.length < PASSWORD_MIN || password.length > 72) return badRequest("password");
  if (body.acceptOffer !== true || body.acceptPd !== true) return badRequest("consents");

  const meta = requestMeta(req);
  if (!(await checkRateLimit(`v2:register:${meta.ip ?? "unknown"}`, 10, 3600))) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    const supabase = await createServerComponentClient();
    const origin = getPublicOrigin(req);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=/start`,
        data: { pending_consents: { offer: true, pd: true, at: new Date().toISOString() } },
      },
    });
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      if (code === "user_already_exists" || code === "email_exists" || /already registered/i.test(error.message)) {
        return Response.json({ error: "exists" }, { status: 409 });
      }
      if (code === "weak_password") return badRequest("password");
      return serverError("register", error);
    }
    // Supabase не сообщает «почта занята», если включено подтверждение: отдаёт пользователя без identities
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return Response.json({ error: "exists" }, { status: 409 });
    }
    if (!data.session || !data.user) return Response.json({ ok: true, confirm: true });

    const cerr = await recordConsents(
      data.user.id,
      [
        { type: "offer", granted: true },
        { type: "pd", granted: true },
      ],
      { ...meta, source: "signup" },
    );
    if (cerr) console.error("[api/v2/register] consents:", cerr);
    return Response.json({ ok: true, confirm: false });
  } catch (err) {
    return serverError("register", err);
  }
}
