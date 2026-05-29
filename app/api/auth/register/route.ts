import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * Регистрация без письма-подтверждения.
 * Используем admin API (service-role), который создаёт пользователя
 * с email_confirm: true — Supabase не шлёт никаких писем.
 */
export async function POST(request: Request) {
  const { email, password } = await request.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email и пароль обязательны." }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // подтверждаем сразу — без письма
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ userId: data.user.id });
}
