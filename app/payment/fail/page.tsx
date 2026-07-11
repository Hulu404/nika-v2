import Link from "next/link";
import { createServerComponentClient } from "@/lib/supabase";
import { createServiceRoleClient } from "@/lib/supabase-server";

export default async function PaymentFailPage({
  searchParams,
}: {
  searchParams: Promise<{ InvId?: string }>;
}) {
  const { InvId } = await searchParams;
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (InvId && user) {
    // помечаем как failed только свой pending-платёж — Result URL сюда не стучится,
    // это единственная точка, где мы узнаём о неуспехе.
    // RLS не даёт юзеру писать в robokassa_payments (только SELECT), поэтому
    // апдейт идёт через service-role, но строго по своему pending (guard ниже).
    const admin = createServiceRoleClient();
    await admin
      .from("robokassa_payments")
      .update({ status: "failed" })
      .eq("inv_id", Number(InvId))
      .eq("user_id", user.id)
      .eq("status", "pending");
  }

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
          minHeight: 560,
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
            background: "#F4E4D6",
            border: "1.5px solid rgba(176,57,42,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
            <path
              d="M6.5 6.5L19.5 19.5M19.5 6.5L6.5 19.5"
              stroke="#B0392A"
              strokeWidth="2.4"
              strokeLinecap="round"
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
            background: "#B0392A",
            color: "#FFFCF6",
            padding: "4px 10px",
            borderRadius: 4,
          }}
        >
          Ошибка оплаты
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
          Не получилось
          <br />
          <em style={{ fontStyle: "italic", color: "#C8553D" }}>списать</em> оплату
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
          Банк отклонил платёж. Доступ к PRO приостановлен, но все твои данные и настройки сохранены.
        </p>

        {/*
          Блок с кодом ошибки — намеренно НЕ выводим статичный/выдуманный код.
          Robokassa на Fail URL причину отказа не передаёт. Если позже подключите
          Robokassa OpState API и будете сохранять причину в БД, можно
          раскомментировать и подставить реальный reasonCode:

          {reasonCode && (
            <div style={{ marginTop: 22, display: 'inline-flex', alignItems: 'center', gap: 8,
              background: '#FFFCF6', border: '1px solid #E5DDD0', borderRadius: 10, padding: '9px 14px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#B0392A', flexShrink: 0 }} />
              <span style={{ fontFamily: "'Geist Mono',monospace", fontSize: 12, color: '#5C534A' }}>
                Код ошибки: {reasonCode}
              </span>
            </div>
          )}
        */}

        <div style={{ marginTop: "auto", width: "100%", paddingTop: 24 }}>
          <Link
            href="/upgrade"
            style={{
              width: "100%",
              height: 54,
              background: "#1F1B16",
              color: "#FAF7F1",
              border: "none",
              borderRadius: 999,
              fontSize: 15,
              fontWeight: 500,
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textDecoration: "none",
              boxSizing: "border-box",
            }}
          >
            Попробовать снова
          </Link>
          <a
            href="mailto:ceo@mynika.online"
            style={{
              marginTop: 10,
              width: "100%",
              height: 50,
              background: "transparent",
              color: "#1F1B16",
              border: "1.5px solid #1F1B16",
              borderRadius: 999,
              fontSize: 14.5,
              fontWeight: 500,
              fontFamily: "inherit",
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textDecoration: "none",
            }}
          >
            Обратиться в поддержку
          </a>
          <a
            href="https://t.me/meine_nika"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              marginTop: 10,
              width: "100%",
              height: 50,
              background: "transparent",
              color: "#1F1B16",
              border: "1.5px solid #1F1B16",
              borderRadius: 999,
              fontSize: 14.5,
              fontWeight: 500,
              fontFamily: "inherit",
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textDecoration: "none",
            }}
          >
            Написать в Telegram
          </a>
        </div>
      </div>
    </main>
  );
}
