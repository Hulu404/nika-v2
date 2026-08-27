import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { nextRun } from "@/lib/coffeerun/run";
import { normalizeTelegramUsername } from "@/lib/coffeerun/telegram-username";

export const runtime = "edge";

/** 32 hex-символа: payload deep-link ограничен 64 символами, «cr_» + 32 влезает. */
function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Заявка на кофе-ран. Контакт строго телеграм: по нику бот находит заявку, а
 * confirm_token в ответе превращается в кнопку «Подтвердить в Telegram».
 *
 * Ответ: { ok: true, confirmUrl } — ссылка t.me/<bot>?start=cr_<token>.
 * Если NEXT_PUBLIC_TELEGRAM_BOT_USERNAME не задан, confirmUrl = null: заявка всё
 * равно сохранена, лендинг просто не покажет кнопку.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, telegram, contact, email, source, run_date } = body as Record<string, string>;

  // contact — совместимость со старой (закешированной) версией страницы.
  const tgUsername = normalizeTelegramUsername(telegram ?? contact);

  if (!name || !email) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 422 });
  }
  if (!tgUsername) {
    return NextResponse.json(
      { error: "Invalid telegram username", field: "telegram" },
      { status: 422 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Дата забега: из формы, если пришла валидная YYYY-MM-DD, иначе — ближайший
  // будущий забег из lib/coffeerun/run (а не default столбца: так API остаётся
  // верным даже когда закешированный лендинг присылает прошлую дату).
  const runDate = /^\d{4}-\d{2}-\d{2}$/.test(String(run_date || ""))
    ? String(run_date)
    : nextRun().date;

  const clean = (v: string, max = 200) => String(v).trim().slice(0, max);

  // Повторная отправка формы тем же ником на тот же забег — не плодим строки и,
  // главное, не плодим токены: человек мог потерять первую кнопку.
  const { data: existingRows } = await supabase
    .from("coffee_run_signups")
    .select("id, confirm_token")
    .eq("tg_username", tgUsername)
    .eq("run_date", runDate)
    .order("created_at", { ascending: false })
    .limit(1);

  const existing = (existingRows as { id: string; confirm_token: string | null }[] | null)?.[0];
  const token = existing?.confirm_token ?? mintToken();

  const fields = {
    name: clean(name),
    contact: `@${tgUsername}`, // столбец из первой версии формы — сохраняем совместимость
    tg_username: tgUsername,
    email: clean(email),
    source: clean(source || "coffeerunsurfsport", 100),
    run_date: runDate,
    confirm_token: token,
  };

  const { error } = existing
    ? await supabase.from("coffee_run_signups").update(fields).eq("id", existing.id)
    : await supabase.from("coffee_run_signups").insert(fields);

  if (error) {
    console.error("coffee_run_signups write error:", error.message);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const confirmUrl = botUsername ? `https://t.me/${botUsername}?start=cr_${token}` : null;

  return NextResponse.json({ ok: true, confirmUrl }, { status: 200 });
}
