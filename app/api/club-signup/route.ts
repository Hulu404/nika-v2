import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { countPaidSeats, isSoldOut } from "@/lib/clubs/seats";
import { sessionForSignup } from "@/lib/clubs/sessions";
import { normalizeTelegramUsername } from "@/lib/coffeerun/telegram-username";

export const runtime = "edge";

/** Префикс deep-link занятия клуба: t.me/<bot>?start=st_<token>. */
const START_PREFIX = "st_";

const LEVELS = ["first", "sometimes", "regular"] as const;
const MATS = ["own", "studio"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zа-я]{2,}$/i;

/** 32 hex-символа: payload deep-link ограничен 64 символами. */
function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** «yes»/«no» из радиокнопок формы → boolean; прочее — null. */
function yesNo(v: unknown): boolean | null {
  if (v === "yes" || v === true) return true;
  if (v === "no" || v === false) return false;
  return null;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function db() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

/**
 * Состояние продажи для лендинга: GET /api/club-signup?club=stretch&date=…
 * → { price, soldOut }. Сколько мест осталось, не отдаём — на странице только
 * «ограничено». Без кеша: распродажа должна дойти до страницы сразу.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const session = sessionForSignup({
    club: url.searchParams.get("club"),
    date: url.searchParams.get("date"),
  });
  const headers = { "Cache-Control": "no-store" };
  if (!session) return NextResponse.json({ error: "No upcoming session" }, { status: 404, headers });
  const supabase = db();
  if (!supabase) return NextResponse.json({ error: "Server misconfigured" }, { status: 500, headers });

  const soldOut = isSoldOut(await countPaidSeats(supabase, session), session);
  return NextResponse.json({ price: session.priceRub, soldOut }, { headers });
}

/**
 * Заявка на занятие клуба (лендинг /stretch). По образцу /api/coffeerun-signup,
 * но с оплатой: строка ложится в club_signups со статусом pending, а ответ
 * несёт ссылку в бот, где человек оплачивает счёт ЮKassa.
 *
 * Цена и дата берутся из lib/clubs/sessions.ts, не из браузера.
 *
 * Все места оплачены (capacity в sessions.ts) — заявка ложится со статусом
 * waitlist: лист ожидания следующего занятия клуба. Ссылка в бот всё равно
 * отдаётся: по ней бот узнаёт чат, чтобы потом позвать человека.
 *
 * Ответ: { ok: true, confirmUrl, paid, waitlist } — paid=true, если этот ник уже
 * оплатил это занятие (повторная форма ничего не ломает).
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const clean = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
  const name = clean(body.name);
  const email = clean(body.email);
  const tgUsername = normalizeTelegramUsername(
    typeof body.telegram === "string" ? body.telegram : null,
  );
  const level = oneOf(body.level, LEVELS);
  const mat = oneOf(body.mat, MATS);
  const towel = yesNo(body.towel);
  const water = yesNo(body.water);

  const invalid: string[] = [];
  if (name.length < 2) invalid.push("name");
  if (!tgUsername) invalid.push("telegram");
  if (!EMAIL_RE.test(email)) invalid.push("email");
  if (!level) invalid.push("level");
  if (!mat) invalid.push("mat");
  if (towel === null) invalid.push("towel");
  if (water === null) invalid.push("water");
  if (body.consent !== true) invalid.push("consent");
  if (invalid.length > 0) {
    return NextResponse.json({ error: "Invalid fields", fields: invalid }, { status: 422 });
  }

  const session = sessionForSignup({
    club: typeof body.club === "string" ? body.club.trim().slice(0, 50) : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(body.event_date ?? "")) ? String(body.event_date) : null,
  });
  if (!session) {
    return NextResponse.json({ error: "No upcoming session" }, { status: 404 });
  }

  const supabase = db();
  if (!supabase) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // Повторная форма тем же ником на то же занятие обновляет заявку, а не плодит
  // строки и токены: человек мог потерять первую кнопку.
  const { data: existingRows, error: readError } = await supabase
    .from("club_signups")
    .select("id, confirm_token, payment_status")
    .eq("club", session.club)
    .eq("event_date", session.date)
    .eq("event_time", session.time)
    .eq("tg_username", tgUsername)
    .limit(1);
  if (readError) {
    console.error("club_signups read error:", readError.message);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const existing = (
    existingRows as { id: string; confirm_token: string; payment_status: string }[] | null
  )?.[0];
  const paid = existing?.payment_status === "paid";
  // Оплатившему место уже принадлежит; остальным — смотрим, остались ли места.
  const waitlist = !paid && isSoldOut(await countPaidSeats(supabase, session), session);
  const token = existing?.confirm_token ?? mintToken();
  const now = new Date().toISOString();

  const fields = {
    club: session.club,
    format: session.format,
    spot: session.spot,
    event_date: session.date,
    event_time: session.time,
    source: clean(body.source || session.club, 100),
    name,
    tg_username: tgUsername,
    email,
    level,
    mat,
    towel,
    water,
    consent_at: now,
    confirm_token: token,
    updated_at: now,
    // Сумму и статус оплаченной заявки не трогаем: деньги уже списаны.
    ...(paid
      ? {}
      : { amount_rub: session.priceRub, payment_status: waitlist ? "waitlist" : "pending" }),
  };

  const { error } = existing
    ? await supabase.from("club_signups").update(fields).eq("id", existing.id)
    : await supabase.from("club_signups").insert(fields);
  if (error) {
    console.error("club_signups write error:", error.message);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const confirmUrl = botUsername ? `https://t.me/${botUsername}?start=${START_PREFIX}${token}` : null;

  return NextResponse.json({ ok: true, confirmUrl, paid, waitlist }, { status: 200 });
}
