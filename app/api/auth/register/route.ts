import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * Регистрация без email-подтверждения.
 * Используем admin API — создаёт пользователя сразу подтверждённым.
 * Требует SUPABASE_SERVICE_ROLE_KEY в .env.local
 */
export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email и пароль обязательны." }, { status: 400 });
    }

    const admin = createServiceRoleClient();

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      console.error("[register] createUser error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ userId: data.user.id });
  } catch (err) {
    console.error("[register] unexpected error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ошибка сервера" },
      { status: 500 },
    );
  }
}
