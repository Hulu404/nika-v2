import { NextResponse } from "next/server";
import { buildPaymentUrl, isRobokassaPlan, ROBOKASSA_PLANS } from "@/lib/robokassa";
import { createServerComponentClient } from "@/lib/supabase";
import { createServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * Создание платежа Robokassa.
 * 1. Проверяем сессию (cookie-клиент, контекст RLS пользователя).
 * 2. Заводим заказ в robokassa_payments через service-role (RLS не пускает
 *    пользователя на запись — платежи пишет только сервер).
 * 3. Возвращаем ссылку на оплату с подписью на Пароле #1.
 */
export async function POST(request: Request) {
  try {
    const { plan } = await request.json();

    if (!isRobokassaPlan(plan)) {
      return NextResponse.json({ error: "Неизвестный тариф." }, { status: 400 });
    }

    const supabase = await createServerComponentClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
    }

    const { amount, description } = ROBOKASSA_PLANS[plan];

    const admin = createServiceRoleClient();
    const { data: payment, error } = await admin
      .from("robokassa_payments")
      .insert({ user_id: user.id, plan, amount, status: "pending" })
      .select("inv_id")
      .single();

    if (error || !payment) {
      console.error("[robokassa/create-payment] insert error:", error?.message);
      return NextResponse.json({ error: "Не удалось создать платёж." }, { status: 500 });
    }

    const paymentUrl = buildPaymentUrl({
      invId: payment.inv_id,
      amount,
      description,
      shp: { uid: user.id, plan },
    });

    return NextResponse.json({ paymentUrl });
  } catch (err) {
    console.error("[robokassa/create-payment] unexpected error:", err);
    return NextResponse.json({ error: "Ошибка сервера." }, { status: 500 });
  }
}
