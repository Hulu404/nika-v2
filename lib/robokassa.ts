import "server-only";
import crypto from "node:crypto";
import type { RobokassaPlan } from "@/types/app";

/**
 * Интеграция с Robokassa. Подпись по алгоритму MD5, Shp_-параметры
 * сортируются по ключу (требование Robokassa).
 *
 * Схема потока: create-payment создаёт заказ в robokassa_payments (pending),
 * строит ссылку с подписью на Пароле #1; после оплаты Robokassa делает
 * server-to-server POST на Result URL, где мы сверяем подпись Паролем #2.
 * Источник истины об оплате — Result URL, не redirect на success.
 */

const MERCHANT_LOGIN = process.env.ROBOKASSA_MERCHANT_LOGIN!;
const PASSWORD_1 = process.env.ROBOKASSA_PASSWORD_1!;
const PASSWORD_2 = process.env.ROBOKASSA_PASSWORD_2!;
const IS_TEST = process.env.ROBOKASSA_IS_TEST === "1";

/**
 * Тарифы: цена в рублях, срок продления подписки в месяцах и соответствующий
 * план в public.subscriptions. Цены совпадают с экраном /upgrade
 * (см. components/UpgradeContent.tsx).
 */
export const ROBOKASSA_PLANS: Record<
  RobokassaPlan,
  { amount: number; months: number; subscriptionPlan: "monthly" | "yearly"; description: string }
> = {
  monthly: {
    amount: 299,
    months: 1,
    subscriptionPlan: "monthly",
    description: "Подписка НИКА PRO — месяц",
  },
  halfyear: {
    amount: 1490,
    months: 6,
    subscriptionPlan: "yearly",
    description: "Подписка НИКА PRO — 6 месяцев",
  },
  // PRO: стартовая цена первой недели 1 ₽. Автопродление 249 ₽/мес пока НЕ
  // реализовано (Robokassa Recurring не подключён) — см. открытый вопрос в PR.
  // months=1 здесь это интерим-грант доступа за первый платёж, а не срок триала.
  pro: {
    amount: 1,
    months: 1,
    subscriptionPlan: "monthly",
    description: "Подписка НИКА PRO (первая неделя 1 ₽)",
  },
};

export function isRobokassaPlan(value: unknown): value is RobokassaPlan {
  return value === "monthly" || value === "halfyear" || value === "pro";
}

function md5(input: string): string {
  return crypto.createHash("md5").update(input, "utf8").digest("hex");
}

/** Строка Shp_-параметров, отсортированных по ключу: `Shp_a=1:Shp_b=2`. */
function shpString(shp: Record<string, string>): string {
  return Object.keys(shp)
    .sort()
    .map((key) => `Shp_${key}=${shp[key]}`)
    .join(":");
}

/** Ссылка на оплату с подписью на Пароле #1. */
export function buildPaymentUrl(params: {
  invId: number;
  amount: number;
  description: string;
  shp: Record<string, string>; // например { uid: userId, plan: 'monthly' }
}): string {
  const { invId, amount, description, shp } = params;
  const outSum = amount.toFixed(2);
  const shpStr = shpString(shp);

  const signatureBase = [MERCHANT_LOGIN, outSum, invId, PASSWORD_1, shpStr]
    .filter(Boolean)
    .join(":");
  const signature = md5(signatureBase);

  const url = new URL("https://auth.robokassa.ru/Merchant/Index.aspx");
  url.searchParams.set("MerchantLogin", MERCHANT_LOGIN);
  url.searchParams.set("OutSum", outSum);
  url.searchParams.set("InvId", String(invId));
  url.searchParams.set("Description", description);
  url.searchParams.set("SignatureValue", signature);
  url.searchParams.set("Culture", "ru");
  if (IS_TEST) url.searchParams.set("IsTest", "1");

  for (const [key, value] of Object.entries(shp)) {
    url.searchParams.set(`Shp_${key}`, value);
  }

  return url.toString();
}

/** Проверка подписи Result URL на Пароле #2 (регистр не важен). */
export function verifyResultSignature(params: {
  outSum: string;
  invId: string;
  signature: string;
  shp: Record<string, string>;
}): boolean {
  const { outSum, invId, signature, shp } = params;
  const shpStr = shpString(shp);
  const base = [outSum, invId, PASSWORD_2, shpStr].filter(Boolean).join(":");
  const expected = md5(base);
  return expected.toLowerCase() === signature.toLowerCase();
}
