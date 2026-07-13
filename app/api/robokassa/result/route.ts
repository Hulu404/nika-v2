import { isRobokassaPlan, ROBOKASSA_PLANS, verifyResultSignature } from "@/lib/robokassa";
import { createServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * Result URL — server-to-server уведомление Robokassa об оплате.
 * ВАЖНО: этот роут не под auth-middleware (Robokassa не логинится) — он и не
 * попадает под matcher middleware.ts.
 *
 * Пока Robokassa не получит в ответ `OK{InvId}`, она ретраит запрос, поэтому
 * обработка идемпотентна: повторный вызов по уже оплаченному заказу просто
 * снова отвечает OK, ничего не меняя.
 *
 * Источник истины об оплате — именно этот роут, а не redirect на /payment/success.
 */
/**
 * Robokassa может слать Result и POST-ом (formData), и GET-ом (query) —
 * зависит от «Метод отсылки данных по Result URL» в кабинете. Поддерживаем оба.
 * Возвращаем ещё и «сырой» текст тела — на случай, если Content-Type не
 * form-urlencoded и formData() ничего не разобрал: тогда парсим тело сами.
 */
async function readParams(request: Request): Promise<URLSearchParams> {
  if (request.method === "GET") return new URL(request.url).searchParams;

  const raw = await request.text();
  // Основной путь: тело в формате application/x-www-form-urlencoded.
  const params = new URLSearchParams(raw);
  // Подстраховка: если Robokassa прислала параметры в query даже на POST —
  // дольём их (не перетирая то, что уже есть в теле).
  const query = new URL(request.url).searchParams;
  for (const [key, value] of query.entries()) {
    if (!params.has(key)) params.set(key, value);
  }
  return params;
}

async function handleResult(request: Request) {
  const params = await readParams(request);
  const outSum = params.get("OutSum") ?? "";
  const invId = params.get("InvId") ?? "";
  const signature = params.get("SignatureValue") ?? "";
  const uid = params.get("Shp_uid") ?? "";
  const plan = params.get("Shp_plan") ?? "";

  // Диагностика: что реально прислала Robokassa. Подпись маскируем.
  console.log(
    "[robokassa/result] method=%s ct=%s keys=%o InvId=%s OutSum=%s plan=%s uid=%s",
    request.method,
    request.headers.get("content-type") ?? "",
    [...params.keys()],
    invId,
    outSum,
    plan,
    uid,
  );

  const valid = verifyResultSignature({
    outSum,
    invId,
    signature,
    shp: { plan, uid },
  });

  if (!valid || !isRobokassaPlan(plan)) {
    console.warn("[robokassa/result] bad signature or plan", {
      invId,
      plan,
      valid,
      hasSignature: signature !== "",
    });
    return new Response("bad sign", { status: 400 });
  }

  const admin = createServiceRoleClient();

  const { data: existing } = await admin
    .from("robokassa_payments")
    .select("status, user_id")
    .eq("inv_id", Number(invId))
    .single();

  // Обрабатываем только переход pending → paid. Всё остальное (paid, failed,
  // отсутствие заказа) не трогаем — но Robokassa всё равно должна получить OK,
  // чтобы прекратить ретраи по уже закрытому заказу.
  if (existing?.status === "pending" && existing.user_id === uid) {
    const now = new Date();
    const { months, subscriptionPlan } = ROBOKASSA_PLANS[plan];
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + months);

    await admin
      .from("robokassa_payments")
      .update({ status: "paid", paid_at: now.toISOString() })
      .eq("inv_id", Number(invId));

    // Активируем подписку: флаг is_pro + запись в subscriptions.
    await admin.from("users").update({ is_pro: true }).eq("id", uid);

    // upsert подписки. У пользователя одна активная запись подписки; при
    // повторной оплате продлеваем период и обновляем план.
    const { data: sub } = await admin
      .from("subscriptions")
      .select("id")
      .eq("user_id", uid)
      .maybeSingle();

    if (sub) {
      await admin
        .from("subscriptions")
        .update({
          plan: subscriptionPlan,
          status: "active",
          current_period_end: periodEnd.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", sub.id);
    } else {
      await admin.from("subscriptions").insert({
        user_id: uid,
        plan: subscriptionPlan,
        status: "active",
        current_period_end: periodEnd.toISOString(),
      });
    }
  }

  return new Response(`OK${invId}`, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

// Robokassa шлёт Result GET-ом или POST-ом (см. настройку метода в кабинете) —
// поддерживаем оба.
export const GET = handleResult;
export const POST = handleResult;
