import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { supabaseClubOrders, type ClubOrder } from "@/lib/clubs/orders";
import { botStartUrl, isHoldActive, refreshOrder, ticketsLabel } from "@/lib/clubs/payments";
import { sessionOfSignup, type ClubSession } from "@/lib/clubs/sessions";
import { publicOriginFromEnv } from "@/lib/public-origin";
import { notifyClubOrder } from "@/lib/telegram/club-signup";
import { tgAdmin } from "@/lib/telegram/supabase";
import { yookassaFromEnv } from "@/lib/yookassa";
import { AutoRefresh } from "./auto-refresh";

/**
 * /paid?o=<token> — сюда ЮKassa возвращает человека после оплаты занятия.
 * Показывает статус заказа (оплачено / ждём подтверждения / не оплачено),
 * детали занятия и кнопку «Открыть бота» (t.me/<бот>?start=st_<token>).
 * Пока заказ ждёт оплаты, страница сверяет статус с API ЮKassa на каждом
 * запросе и сама обновляется.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Оплата занятия · NIKA",
  robots: { index: false, follow: false },
};

const C = { bg: "#FAFAF8", card: "#FFFFFF", ink: "#1A1A18", ink2: "#55534F", line: "rgba(20,20,18,.1)", accent: "#A9432F", ok: "#3F6B35" };
const page: CSSProperties = { minHeight: "100svh", background: C.bg, color: C.ink, display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 16px" };
const card: CSSProperties = { width: "100%", maxWidth: 520, background: C.card, borderRadius: 24, padding: "32px 24px", boxShadow: "0 24px 60px -32px rgba(20,20,18,.35)", border: `1px solid ${C.line}` };
const btn = (dark: boolean): CSSProperties => ({
  display: "flex", alignItems: "center", justifyContent: "center", height: 56, borderRadius: 999, textDecoration: "none", fontSize: 15,
  marginTop: 12, ...(dark ? { background: C.ink, color: "#fff" } : { border: `1px solid ${C.line}`, color: C.ink }),
});

type View = { kicker: string; color: string; title: string; text: string; pending?: boolean };

function viewOf(order: ClubOrder | null, now: Date): View {
  if (!order) return { kicker: "Заказ не найден", color: C.accent, title: "Не нашли этот заказ", text: "Ссылка могла устареть. Записаться можно на странице занятия." };
  switch (order.payment_status) {
    case "paid":
      return { kicker: "Оплачено", color: C.ok, title: "Всё супер, заявка оплачена", text: "Открой бота NIKA — он пришлёт подтверждение и напомнит о занятии." };
    case "refunded_overbooked":
      return { kicker: "Мест не осталось", color: C.accent, title: "Пока шла оплата, места выкупили", text: "Деньги вернули автоматически, они придут на карту в течение нескольких дней. Прости, что так вышло." };
    case "refunded":
      return { kicker: "Возврат", color: C.accent, title: "Заказ отменён", text: "Деньги вернули. Если что-то не так, напиши в поддержку через бота." };
    case "waitlist":
      return { kicker: "Лист ожидания", color: C.accent, title: "Ты в листе ожидания", text: "Все места выкуплены. Открой бота, чтобы он смог тебе написать, когда откроем запись." };
    case "pending_payment":
      if (isHoldActive(order, now)) {
        return { kicker: "Ждём подтверждения", color: C.ink2, title: "Ждём подтверждения оплаты", text: "Обычно это занимает минуту, страница обновится сама. Если оплата не прошла, вернись к оплате.", pending: true };
      }
      break;
  }
  return { kicker: "Не оплачено", color: C.accent, title: "Оплата не прошла", text: "Платёж отменён или время на оплату истекло. Открой бота — он пришлёт новую ссылку, если места ещё есть." };
}

function Details({ order, session }: { order: ClubOrder; session: ClubSession }) {
  const row = (label: string, value: ReactNode) => (
    <div style={{ display: "flex", gap: 12, padding: "10px 0", borderTop: `1px solid ${C.line}`, fontSize: 15 }}>
      <span style={{ width: 92, flex: "none", color: C.ink2 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <div style={{ marginTop: 24 }}>
      {row("Занятие", session.title)}
      {row("Когда", `${session.dateLabel}, ${session.weekday}, ${session.time} (сбор с ${session.gatherAt})`)}
      {row("Где", `${session.place}, ${session.metro}`)}
      {row("Заказ", `${ticketsLabel(order.quantity)}${order.is_gift && order.gift_recipient ? ` в подарок: ${order.gift_recipient}` : ""} · ${order.amount_rub} ₽`)}
    </div>
  );
}

export default async function PaidPage({ searchParams }: { searchParams: { o?: string | string[] } }) {
  const raw = typeof searchParams.o === "string" ? searchParams.o : "";
  const token = /^[A-Za-z0-9_-]{16,64}$/.test(raw) ? raw : null;
  const orders = supabaseClubOrders(tgAdmin());
  let order: ClubOrder | null = null;
  if (token) {
    order = await orders.byToken(token).catch((err) => {
      console.error("[paid]", err instanceof Error ? err.message : String(err));
      return null;
    });
    // Ждёт оплаты — сверяем с ЮKassa прямо сейчас (вебхук мог ещё не дойти).
    if (order) order = await refreshOrder({ orders, yk: yookassaFromEnv(), origin: publicOriginFromEnv(), notify: notifyClubOrder }, order);
  }
  const session = order ? sessionOfSignup(order) : null;
  const view = viewOf(order, new Date());
  const bot = order ? botStartUrl(order.confirm_token) : null;
  const site = publicOriginFromEnv() ?? "";

  return (
    <main style={page}>
      {view.pending ? <AutoRefresh /> : null}
      <div style={card}>
        <div style={{ fontSize: 12, letterSpacing: ".16em", textTransform: "uppercase", color: view.color }}>{view.kicker}</div>
        <h1 style={{ fontSize: 28, lineHeight: 1.2, margin: "12px 0 8px", fontWeight: 400 }}>{view.title}</h1>
        <p style={{ margin: 0, color: C.ink2, fontSize: 15, lineHeight: 1.55 }}>{view.text}</p>
        {order && session ? <Details order={order} session={session} /> : null}
        {bot && order?.payment_status !== "refunded_overbooked" ? <a href={bot} style={btn(true)}>Открыть бота</a> : null}
        {view.pending && order?.yk_confirmation_url ? <a href={order.yk_confirmation_url} style={btn(false)}>Вернуться к оплате</a> : null}
        {!order || order.payment_status === "refunded_overbooked" ? (
          <a href={`${site}${session?.landing ?? "/stretch"}`} style={btn(!order)}>На страницу занятия</a>
        ) : null}
      </div>
    </main>
  );
}
