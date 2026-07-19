import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { createServerComponentClient } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * Верификация ссылки из письма (token_hash). Используется флоу сброса пароля
 * (type=recovery): по валидному токену Supabase создаёт сессию, и мы ведём
 * пользователя на /reset-password, где он задаёт новый пароль.
 *
 * ВАЖНО: token_hash — секрет из письма, его нельзя логировать.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // Открытый редирект недопустим: принимаем только внутренние пути.
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/today";

  if (token_hash && type) {
    const supabase = await createServerComponentClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      // При recovery next = /reset-password (см. шаблон письма в дашборде).
      redirect(next);
    }
  }

  // Ссылка протухла/использована/битая — мягкое состояние без тех-деталей.
  redirect("/forgot-password?state=expired");
}
