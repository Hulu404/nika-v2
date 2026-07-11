import Link from "next/link";
import { createServerComponentClient } from "@/lib/supabase";
import { planLabel, periodLabel, formatRub, formatDateRu, nextBillingDate } from "@/lib/format";

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ InvId?: string }>;
}) {
  const { InvId } = await searchParams;
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let payment: {
    plan: string;
    amount: number;
    billing_period: string;
    paid_at: string | null;
    created_at: string;
  } | null = null;

  if (InvId && user) {
    const { data } = await supabase
      .from("robokassa_payments")
      .select("plan, amount, billing_period, paid_at, created_at")
      .eq("inv_id", Number(InvId))
      .eq("user_id", user.id) // не отдаём чужие данные по угаданному InvId
      .eq("status", "paid")
      .single();
    payment = data;
  }

  const plan = payment ? planLabel(payment.plan) : "PRO";
  const period = payment ? periodLabel(payment.billing_period) : "Месяц";
  const amount = payment ? formatRub(payment.amount) : null;
  const nextDate = payment
    ? formatDateRu(nextBillingDate(new Date(payment.paid_at ?? payment.created_at), payment.billing_period))
    : null;

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#EFE7D7",
        backgroundImage:
          "radial-gradient(circle at 20% 0%, rgba(200,85,61,0.05), transparent 40%), radial-gradient(circle at 80% 100%, rgba(31,27,22,0.04), transparent 40%)",
        padding: "24px",
        fontFamily: "'Geist','Inter',-apple-system,sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "#FAF7F1",
          borderRadius: 32,
          boxShadow: "0 20px 60px rgba(31,27,22,0.08)",
          padding: "56px 24px 40px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#F4E4D6 0%,#E8B7A8 60%,#C8553D 130%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 0 6px rgba(200,85,61,0.08)",
            flexShrink: 0,
          }}
        >
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
            <path
              d="M7 15.5L12.5 21L23 9"
              stroke="#FFFCF6"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <span
          style={{
            marginTop: 18,
            display: "inline-flex",
            alignItems: "center",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontFamily: "'Geist Mono',monospace",
            fontSize: 10.5,
            fontWeight: 500,
            background: "#C8553D",
            color: "#FFFCF6",
            padding: "4px 10px",
            borderRadius: 4,
          }}
        >
          Подписка {plan}
        </span>

        <h1
          style={{
            margin: "16px 0 0",
            fontFamily: "'Fraunces',Georgia,serif",
            fontWeight: 500,
            fontSize: 30,
            lineHeight: 1.18,
            letterSpacing: "-0.01em",
            color: "#1F1B16",
            textAlign: "center",
          }}
        >
          Оплата прошла.
          <br />Я <em style={{ fontStyle: "italic", color: "#C8553D" }}>с тобой</em>.
        </h1>

        <p
          style={{
            margin: "12px 0 0",
            fontSize: 14.5,
            lineHeight: 1.55,
            color: "#5C534A",
            textAlign: "center",
            maxWidth: 300,
          }}
        >
          НИКА теперь помнит дольше и не забудет о тебе. Все возможности {plan} уже открыты.
        </p>

        {payment && (
          <div
            style={{
              marginTop: 28,
              width: "100%",
              background: "#FFFCF6",
              border: "1px solid #E5DDD0",
              borderRadius: 16,
              padding: "6px 18px",
            }}
          >
            <Row label="План" value={`${period} · ${plan}`} />
            <Row label="Списано сегодня" value={amount!} />
            <Row label="Следующее списание" value={nextDate!} last />
          </div>
        )}

        <Link
          href="/"
          style={{
            marginTop: 28,
            width: "100%",
            height: 54,
            background: "#1F1B16",
            color: "#FAF7F1",
            border: "none",
            borderRadius: 999,
            fontSize: 15,
            fontWeight: 500,
            letterSpacing: "0.005em",
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textDecoration: "none",
            boxSizing: "border-box",
          }}
        >
          Продолжить
        </Link>

        <p
          style={{
            margin: "16px 0 0",
            fontSize: 12,
            lineHeight: 1.5,
            color: "#9A9085",
            textAlign: "center",
            maxWidth: 280,
          }}
        >
          Чек отправлен на почту. Управлять подпиской можно в любой момент в настройках профиля.
        </p>
      </div>
    </main>
  );
}

function Row({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "14px 0",
        borderBottom: last ? "none" : "1px solid #EFE9DD",
      }}
    >
      <span style={{ fontSize: 13.5, color: "#5C534A" }}>{label}</span>
      <span style={{ fontSize: 13.5, fontWeight: 500, color: "#1F1B16" }}>{value}</span>
    </div>
  );
}
