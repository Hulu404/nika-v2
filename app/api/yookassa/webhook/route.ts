import { NextResponse } from "next/server";
import { supabaseClubOrders } from "@/lib/clubs/orders";
import { processPayment, type PaymentDeps } from "@/lib/clubs/payments";
import { publicOriginFromEnv } from "@/lib/public-origin";
import { tgAdmin } from "@/lib/telegram/supabase";
import { notifyClubOrder } from "@/lib/telegram/club-signup";
import { yookassaFromEnv } from "@/lib/yookassa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * HTTP-уведомления ЮKassa (кабинет → Интеграция → HTTP-уведомления):
 * payment.succeeded, payment.canceled.
 *
 * Телу запроса не доверяем: берём из него только id платежа и спрашиваем
 * статус у API ЮKassa (GET /payments/{id}) — подделанный запрос ничего не
 * изменит. Обработка идемпотентна (lib/clubs/payments.ts): повторная доставка
 * того же события ничего не ломает.
 *
 * 200 — обработано (или не наше); 500 — временный сбой (база, API, возврат),
 * ЮKassa повторит уведомление.
 */
export async function POST(req: Request) {
  let body: { event?: unknown; object?: { id?: unknown } };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const event = typeof body?.event === "string" ? body.event : "";
  const paymentId = typeof body?.object?.id === "string" ? body.object.id : "";
  if (!event.startsWith("payment.") || !/^[A-Za-z0-9_-]{1,64}$/.test(paymentId)) {
    // refund.* и чужие события — не наши: 200, чтобы ЮKassa не повторяла.
    return NextResponse.json({ ok: true, ignored: true });
  }

  const yk = yookassaFromEnv();
  if (!yk) {
    console.error("[yookassa-webhook] YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY не заданы");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  const deps: PaymentDeps = { orders: supabaseClubOrders(tgAdmin()), yk, origin: publicOriginFromEnv(), notify: notifyClubOrder };
  try {
    const { outcome, order } = await processPayment(deps, paymentId);
    console.log(`[yookassa-webhook] ${event} ${paymentId} → ${outcome}${order ? ` (заказ ${order.id})` : ""}`);
    return NextResponse.json({ ok: true, outcome });
  } catch (err) {
    const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 0;
    console.error(`[yookassa-webhook] ${event} ${paymentId}:`, err instanceof Error ? err.message : String(err));
    // Платежа нет в API (404) — подделка или чужой магазин: повторять бессмысленно.
    if (status === 404) return NextResponse.json({ ok: true, ignored: true });
    return NextResponse.json({ error: "Retry" }, { status: 500 });
  }
}
