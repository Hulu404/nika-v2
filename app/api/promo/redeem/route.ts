import { NextResponse, type NextRequest } from "next/server";
import { createServerComponentClient } from "@/lib/supabase";
import { createServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Авторизация: берём текущего пользователя через cookie
  const supabase = await createServerComponentClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { token?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const token = (body.token ?? "").toUpperCase().trim().slice(0, 32);
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  // Rate limit: 5 попыток в час на аккаунт
  const { data: rl } = await admin.rpc("check_rate_limit", {
    p_key: `promo_redeem:${user.id}`,
    p_limit: 5,
    p_window_seconds: 3600,
  });
  if (!rl) {
    return NextResponse.json(
      { error: "Слишком много попыток. Попробуй через час." },
      { status: 429 },
    );
  }

  // Вызываем атомарную RPC
  const { data, error } = await admin.rpc("redeem_promo_token", {
    p_token: token,
    p_user_id: user.id,
  });

  if (error) {
    console.error("[promo/redeem] rpc error:", error.message);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }

  const result = data as { status: string; grant_days?: number; period_end?: string };

  switch (result.status) {
    case "ok":
      return NextResponse.json({
        ok: true,
        grant_days: result.grant_days,
        period_end: result.period_end,
      });
    case "not_found":
      return NextResponse.json(
        { error: "Код не найден. Проверь правильность ввода." },
        { status: 404 },
      );
    case "already_redeemed":
      return NextResponse.json(
        { error: "Этот код уже был использован." },
        { status: 409 },
      );
    case "expired":
      return NextResponse.json(
        { error: "Срок действия кода истёк." },
        { status: 410 },
      );
    case "already_activated":
      return NextResponse.json(
        { error: "Промо уже активировано на этом аккаунте." },
        { status: 409 },
      );
    default:
      return NextResponse.json({ error: "Неизвестный статус" }, { status: 500 });
  }
}
