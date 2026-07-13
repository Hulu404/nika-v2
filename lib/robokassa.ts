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
 * Фискализация (54-ФЗ). Боевой магазин Robokassa с включённой фискализацией
 * ОБЯЗАТЕЛЬНО требует параметр Receipt (чек) — без него страница оплаты
 * возвращает ошибку. По умолчанию включена; отключить можно
 * ROBOKASSA_FISCALIZATION=0 (для магазина без фискализации).
 *   SNO — система налогообложения магазина (УСН «доходы» → usn_income).
 *   TAX — ставка НДС в позиции чека (на УСН НДС нет → none).
 */
const FISCALIZATION = process.env.ROBOKASSA_FISCALIZATION !== "0";
const SNO = process.env.ROBOKASSA_SNO || "usn_income";
const TAX = process.env.ROBOKASSA_TAX || "none";

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

/**
 * Фискальный чек в двух видах: `json` — сырой JSON для ПОДПИСИ, `encoded` —
 * url-encoded JSON для URL.
 *
 * ВАЖНО (иначе ошибка 29 «неверная подпись»): в строку подписи (MD5) Receipt
 * входит СЫРЫМ JSON, а в URL кладётся url-encoded. Robokassa на своей стороне
 * декодирует параметр обратно в сырой JSON и считает MD5 именно по нему —
 * поэтому подписывать нужно неэкранированный JSON. (Проверено по рабочей
 * реализации kvalood/Robokassa: md5("...:$receipt:$pass1"), где $receipt —
 * json_encode без urlencode; в форму — urlencode($receipt).)
 *
 * Возвращает null, если фискализация выключена (ROBOKASSA_FISCALIZATION=0).
 */
function buildReceipt(
  amount: number,
  description: string,
): { json: string; encoded: string } | null {
  if (!FISCALIZATION) return null;
  const receipt = {
    sno: SNO,
    items: [
      {
        name: description.slice(0, 128), // Robokassa: имя позиции ≤ 128 символов
        quantity: 1,
        sum: Number(amount), // одна позиция → сумма строки = сумме заказа (OutSum)
        payment_method: "full_payment",
        payment_object: "service",
        tax: TAX,
      },
    ],
  };
  const json = JSON.stringify(receipt);
  return { json, encoded: encodeURIComponent(json) };
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
  const receipt = buildReceipt(amount, description);

  // Порядок по докам Robokassa: MerchantLogin:OutSum:InvId[:Receipt]:Пароль#1[:Shp_*]
  // Receipt (если включён) идёт строго перед Паролем #1 и — сырым JSON, не url-encoded.
  const signatureBase = [
    MERCHANT_LOGIN,
    outSum,
    String(invId),
    ...(receipt ? [receipt.json] : []),
    PASSWORD_1,
    shpStr,
  ]
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

  let finalUrl = url.toString();
  // В URL Receipt идёт url-encoded (в подписи — сырой JSON, см. buildReceipt).
  // Дописываем вручную, чтобы контролировать кодирование (URLSearchParams
  // закодировал бы пробел как `+`; encodeURIComponent даёт %20 — оба валидны,
  // но так однозначнее, и Robokassa корректно декодирует обратно в JSON).
  if (receipt) finalUrl += `&Receipt=${receipt.encoded}`;

  return finalUrl;
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
