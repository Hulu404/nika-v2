import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { countPaidSeats, hasEnoughSeats, isSoldOut, seatsLeftToShow } from "@/lib/clubs/seats";
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
 * → { price, soldOut, left, available }. available — лимит выбора билетов;
 * left — остаток для промоблоков, только когда мест мало (SHOW_SEATS_LEFT_AT).
 * Без кеша: распродажа должна дойти до страницы сразу.
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

  const paid = await countPaidSeats(supabase, session);
  if (!Number.isFinite(paid)) return NextResponse.json({ error: "Availability unavailable" }, { status: 503, headers });
  return NextResponse.json(
    { price: session.priceRub, soldOut: isSoldOut(paid, session), left: seatsLeftToShow(paid, session), available: Math.max(0, session.capacity - paid) },
    { headers },
  );
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
 * request_token — ключ отдельного заказа. Повтор с тем же ключом возвращает
 * неизменный заказ; старые формы без ключа находят прежнюю заявку по нику.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
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
  const quantity = body.quantity === undefined ? 1 : body.quantity;
  const isGift = body.is_gift === true;
  const giftRecipient = isGift ? clean(body.gift_recipient) : null;
  // Случайный ключ заказа: повтор запроса возвращает тот же заказ, новая
  // покупка (даже с тем же Telegram) получает отдельный ключ и счёт.
  const requestToken = body.request_token;

  const invalid: string[] = [];
  if (name.length < 2) invalid.push("name");
  if (!tgUsername) invalid.push("telegram");
  if (!EMAIL_RE.test(email)) invalid.push("email");
  if (!isGift) {
    if (!level) invalid.push("level");
    if (!mat) invalid.push("mat");
    if (towel === null) invalid.push("towel");
    if (water === null) invalid.push("water");
  }
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 16) invalid.push("quantity");
  if (body.is_gift !== undefined && typeof body.is_gift !== "boolean") invalid.push("is_gift");
  if (isGift && (typeof body.gift_recipient !== "string" || !giftRecipient || giftRecipient.length < 2)) invalid.push("gift_recipient");
  if (requestToken !== undefined && (typeof requestToken !== "string" || !/^[a-f0-9]{32}$/.test(requestToken))) invalid.push("request_token");
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
  const ticketCount = quantity as number;
  if (ticketCount > session.capacity) {
    return NextResponse.json({ error: "Invalid fields", fields: ["quantity"] }, { status: 422 });
  }

  const supabase = db();
  if (!supabase) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // Новая форма ищет только свой заказ. Для старой формы сохраняем поиск по нику.
  const { data: existingRows, error: readError } = await supabase
    .from("club_signups")
    .select("id, confirm_token, payment_status, quantity, amount_rub, is_gift, confirmed_at")
    .eq("club", session.club)
    .eq("event_date", session.date)
    .eq("event_time", session.time)
    .eq(requestToken ? "confirm_token" : "tg_username", requestToken || tgUsername)
    .limit(1);
  if (readError) {
    console.error("club_signups read error:", readError.message);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const existing = (
    existingRows as { id: string; confirm_token: string; payment_status: string; quantity: number; amount_rub: number; is_gift: boolean; confirmed_at: string | null }[] | null
  )?.[0];
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const responseFor = (order: { confirm_token: string; payment_status: string; quantity: number; amount_rub: number; is_gift: boolean }) => NextResponse.json({
    ok: true,
    confirmUrl: botUsername ? `https://t.me/${botUsername}?start=${START_PREFIX}${order.confirm_token}` : null,
    paid: order.payment_status === "paid", waitlist: order.payment_status === "waitlist",
    quantity: order.quantity, amount: order.amount_rub, isGift: order.is_gift,
  });
  // Выставленный или оплаченный счёт нельзя переписать повторной формой.
  if (existing) return responseFor(existing);
  const occupied = await countPaidSeats(supabase, session);
  if (!Number.isFinite(occupied)) return NextResponse.json({ error: "Availability unavailable" }, { status: 503 });
  const waitlist = isSoldOut(occupied, session);
  if (!waitlist && !hasEnoughSeats(occupied, session, ticketCount)) {
    return NextResponse.json({ error: "Not enough seats", available: Math.max(0, session.capacity - occupied) }, { status: 409 });
  }
  const token = (requestToken as string | undefined) ?? mintToken();
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
    level: isGift ? null : level,
    mat: isGift ? null : mat,
    towel: isGift ? null : towel,
    water: isGift ? null : water,
    quantity: ticketCount,
    is_gift: isGift,
    gift_recipient: giftRecipient,
    consent_at: now,
    confirm_token: token,
    updated_at: now,
    amount_rub: session.priceRub * ticketCount,
    payment_status: waitlist ? "waitlist" : "pending",
  };

  const { error } = await supabase.from("club_signups").insert(fields);
  if (error) {
    // Два одинаковых сетевых повтора могли одновременно пройти чтение.
    if (error.code === "23505" && requestToken) {
      const { data: retry } = await supabase.from("club_signups")
        .select("confirm_token, payment_status, quantity, amount_rub, is_gift")
        .eq("confirm_token", requestToken).maybeSingle();
      if (retry) return responseFor(retry);
    }
    console.error("club_signups write error:", error.message);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return responseFor({ confirm_token: token, payment_status: waitlist ? "waitlist" : "pending", quantity: ticketCount, amount_rub: session.priceRub * ticketCount, is_gift: isGift });
}
