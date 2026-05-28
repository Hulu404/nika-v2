import { NextResponse } from "next/server";
import { createServerComponentClient } from "@/lib/supabase";
import { createServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * Обработка перехода по магической ссылке: меняем code на сессию,
 * при первом входе заводим строку в таблице users, затем редиректим дальше.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  // Защита от open redirect — принимаем только относительные пути.
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/auth?error=missing_code`);
  }

  const supabase = await createServerComponentClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/auth?error=auth`);
  }

  // Первый вход: idempotent upsert строки пользователя. Service-role клиент
  // обходит RLS и гарантирует создание записи. Ошибка здесь не должна валить
  // вход — логируем и продолжаем.
  try {
    const admin = createServiceRoleClient();
    await admin
      .from("users")
      .upsert(
        { id: data.user.id, email: data.user.email ?? null },
        { onConflict: "id" },
      );
  } catch (err) {
    console.error("[auth/callback] users upsert failed:", err);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
