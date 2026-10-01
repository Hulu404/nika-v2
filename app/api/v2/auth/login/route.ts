import { createServerComponentClient } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/consents";
import { badRequest, readJson, serverError } from "@/lib/v2/http";
import { isEmail } from "@/lib/v2/validate";

export const runtime = "nodejs";

/** Вход по почте и паролю. Сессия ставится в cookie этим же ответом. */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return badRequest();
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!isEmail(email) || !password) return badRequest("credentials");

  const { ip } = requestMeta(req);
  if (!(await checkRateLimit(`v2:login:${ip ?? "unknown"}:${email}`, 10, 600))) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    const supabase = await createServerComponentClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      if (code === "email_not_confirmed") return Response.json({ error: "unconfirmed" }, { status: 403 });
      if (code === "invalid_credentials" || error.status === 400) {
        return Response.json({ error: "invalid" }, { status: 401 });
      }
      return serverError("login", error);
    }
    return Response.json({ ok: true });
  } catch (err) {
    return serverError("login", err);
  }
}
