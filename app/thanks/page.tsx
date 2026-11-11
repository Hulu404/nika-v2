import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { supabaseDonations, type Donation } from "@/lib/donations/store";
import { processDonationPayment } from "@/lib/donations/process";
import { publicOriginFromEnv } from "@/lib/public-origin";
import { notifyDonation } from "@/lib/telegram/donations";
import { PAYMENT_FAILED_TEXT, THANKS_PAGE, THANKS_PAGE_PENDING } from "@/lib/telegram/donation-copy";
import { tgAdmin } from "@/lib/telegram/supabase";
import { yookassaFromEnv } from "@/lib/yookassa";
import { AutoRefresh } from "../paid/auto-refresh";

/**
 * /thanks?d=<id доната> — сюда ЮKassa возвращает человека после оплаты
 * поддержки клуба. Пока платёж ждёт подтверждения, страница сверяет его с API
 * ЮKassa (вебхук мог ещё не дойти) и сама обновляется. Кнопка — в бот, там
 * расписание. Личных данных на странице нет.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${THANKS_PAGE.title} · NIKA`,
  robots: { index: false, follow: false },
};

const C = { bg: "#FAFAF8", card: "#FFFFFF", ink: "#1A1A18", ink2: "#55534F", line: "rgba(20,20,18,.1)" };
const page: CSSProperties = { minHeight: "100svh", background: C.bg, color: C.ink, display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 16px" };
const card: CSSProperties = { width: "100%", maxWidth: 520, background: C.card, borderRadius: 24, padding: "32px 24px", boxShadow: "0 24px 60px -32px rgba(20,20,18,.35)", border: `1px solid ${C.line}` };
const btn: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", height: 56, borderRadius: 999, textDecoration: "none",
  fontSize: 15, marginTop: 24, background: C.ink, color: "#fff",
};

async function loadDonation(id: string): Promise<Donation | null> {
  const store = supabaseDonations(tgAdmin());
  let donation = await store.byId(id).catch((err) => {
    console.error("[thanks]", err instanceof Error ? err.message : String(err));
    return null;
  });
  const yk = yookassaFromEnv();
  if (donation?.payment_status === "pending_payment" && donation.yk_payment_id && yk) {
    try {
      const payment = await yk.getPayment(donation.yk_payment_id);
      const res = await processDonationPayment({ store, yk, origin: publicOriginFromEnv(), notify: notifyDonation }, payment);
      donation = res.donation ?? donation;
    } catch (err) {
      console.error("[thanks] сверка:", err instanceof Error ? err.message : String(err));
    }
  }
  return donation;
}

export default async function ThanksPage({ searchParams }: { searchParams: { d?: string | string[] } }) {
  const raw = typeof searchParams.d === "string" ? searchParams.d : "";
  const id = /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
  const donation = id ? await loadDonation(id) : null;
  const pending = donation?.payment_status === "pending_payment";
  const failed = donation?.payment_status === "canceled";
  const view = pending ? THANKS_PAGE_PENDING : failed ? { title: PAYMENT_FAILED_TEXT.split(".")[0], text: PAYMENT_FAILED_TEXT } : THANKS_PAGE;
  const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");

  return (
    <main style={page}>
      {pending ? <AutoRefresh /> : null}
      <div style={card}>
        <h1 style={{ fontSize: 28, lineHeight: 1.2, margin: "0 0 8px", fontWeight: 400 }}>{view.title}</h1>
        <p style={{ margin: 0, color: C.ink2, fontSize: 15, lineHeight: 1.55 }}>{view.text}</p>
        {username ? <a href={`https://t.me/${username}`} style={btn}>{THANKS_PAGE.button}</a> : null}
      </div>
    </main>
  );
}
