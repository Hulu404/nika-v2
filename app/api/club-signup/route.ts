import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { ORDER_COLUMNS, supabaseClubOrders, type ClubOrder } from "@/lib/clubs/orders";
import { countTakenSeats, isSoldOut, seatsLeftToShow } from "@/lib/clubs/seats";
import { sessionForSignup } from "@/lib/clubs/sessions";
import { handleSignup, type SignupDeps } from "@/lib/clubs/signup";
import { getPublicOrigin } from "@/lib/public-origin";
import { yookassaFromEnv } from "@/lib/yookassa";

export const runtime = "edge";

function db(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

/**
 * Состояние продажи для лендинга: GET /api/club-signup?club=stretch&date=…
 * → { price, soldOut, left, available }. Места заняты оплаченными заказами и
 * активными холдами (20 минут на оплату). Без кеша: распродажа должна дойти до
 * страницы сразу.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const headers = { "Cache-Control": "no-store" };
  const supabase = db();
  if (!supabase) return NextResponse.json({ error: "Server misconfigured" }, { status: 500, headers });
  const promoCode = url.searchParams.get("promo")?.trim().toUpperCase();
  if (promoCode) {
    const { data, error } = await supabase.from("club_promo_codes")
      .select("code,discount_percent,usage_limit,reserved_uses,redeemed_uses,active,expires_at").eq("code", promoCode).maybeSingle();
    if (error) return NextResponse.json({ error: "Promo validation unavailable" }, { status: 503, headers });
    const row = data as { code: string; discount_percent: number; usage_limit: number; reserved_uses: number; redeemed_uses: number; active: boolean; expires_at: string | null } | null;
    if (!row || !row.active || (row.expires_at && Date.parse(row.expires_at) <= Date.now()) || row.reserved_uses + row.redeemed_uses >= row.usage_limit) {
      return NextResponse.json({ error: "Промокод недействителен или лимит использований исчерпан" }, { status: 404, headers });
    }
    return NextResponse.json({ code: row.code, discountPercent: row.discount_percent }, { headers });
  }
  const session = sessionForSignup({ club: url.searchParams.get("club"), date: url.searchParams.get("date") });
  if (!session) return NextResponse.json({ error: "No upcoming session" }, { status: 404, headers });
  const taken = await countTakenSeats(supabase, session);
  if (!Number.isFinite(taken)) return NextResponse.json({ error: "Availability unavailable" }, { status: 503, headers });
  return NextResponse.json(
    { price: session.priceRub, soldOut: isSoldOut(taken, session), left: seatsLeftToShow(taken, session), available: Math.max(0, session.capacity - taken) },
    { headers },
  );
}

/** Заявка с лендинга занятия → холд мест и платёж ЮKassa (lib/clubs/signup.ts). */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const supabase = db();
  if (!supabase) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  try {
    const res = await handleSignup(body, supabaseSignupDeps(supabase, getPublicOrigin(req)));
    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    console.error("[club-signup]", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}

function supabaseSignupDeps(supabase: SupabaseClient, origin: string): SignupDeps {
  const table = () => supabase.from("club_signups");
  const ofSession = (s: { club: string; date: string; time: string }) =>
    table().select(ORDER_COLUMNS).eq("club", s.club).eq("event_date", s.date).eq("event_time", s.time);
  const first = (data: unknown) => ((data as ClubOrder[] | null) ?? [])[0] ?? null;
  return {
    orders: supabaseClubOrders(supabase),
    yk: yookassaFromEnv(),
    origin,
    botUsername: process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? null,
    taken: (session) => countTakenSeats(supabase, session),
    async findByKey(session, key) {
      const q = "token" in key ? ofSession(session).eq("confirm_token", key.token) : ofSession(session).eq("tg_username", key.username);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(1);
      if (error) throw new Error(`club_signups read: ${error.message}`);
      return first(data);
    },
    async findSamePending(session, q) {
      let query = ofSession(session)
        .eq("tg_username", q.username).eq("quantity", q.quantity).eq("is_gift", q.isGift)
        .eq("payment_status", "pending_payment").gt("hold_expires_at", new Date().toISOString());
      query = q.promoCode ? query.eq("promo_code", q.promoCode) : query.is("promo_code", null);
      const { data, error } = await query
        .order("created_at", { ascending: false }).limit(1);
      if (error) throw new Error(`club_signups read: ${error.message}`);
      return first(data);
    },
    async lookupPromo(code) {
      const { data, error } = await supabase.from("club_promo_codes")
        .select("code,discount_percent,usage_limit,reserved_uses,redeemed_uses,active,expires_at").eq("code", code).maybeSingle();
      if (error) throw new Error(`club_promo_codes read: ${error.message}`);
      const row = data as { code: string; discount_percent: number; usage_limit: number; reserved_uses: number; redeemed_uses: number; active: boolean; expires_at: string | null } | null;
      // Повтор уже созданного заказа должен найти тот же код и платёж даже
      // если его единственное применение сейчас зарезервировано этим заказом.
      // Доступность новой попытки атомарно проверяет insert trigger в БД.
      if (!row) return null;
      return { code: row.code, discountPercent: row.discount_percent };
    },
    async insert(fields) {
      const { error } = await table().insert(fields);
      if (!error) return "ok";
      if (error.code === "23505") return "duplicate";
      if (error.code === "P0001" && String(error.message).includes("promo")) return "invalid_promo";
      throw new Error(`club_signups write: ${error.message}`);
    },
  };
}
