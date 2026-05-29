import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Этот роут больше не используется.
 * Регистрация идёт напрямую через supabase.auth.signUp на клиенте.
 * Email-подтверждение должно быть отключено в Supabase Dashboard:
 *   Authentication → Providers → Email → "Confirm email" → OFF
 */
export async function POST() {
  return NextResponse.json({ error: "Not used" }, { status: 404 });
}
