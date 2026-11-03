import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { createYooKassa, rub, YOOKASSA_API, yookassaConfig, type YkPayment } from "../lib/yookassa";

/**
 * Ручная проверка оплаты занятий на ТЕСТОВОМ магазине ЮKassa и запущенном
 * приложении (локально или на стенде) с тестовой базой.
 *
 *   npx tsx scripts/yookassa-smoke.ts http://localhost:3000
 *
 * Нужно в .env: YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY тестового магазина
 * (ключ начинается с test_) — те же, что у проверяемого приложения.
 * Тестовые карты: https://yookassa.ru/developers/payment-acceptance/testing-and-going-live/testing
 *
 * Сценарии:
 *   1. успешная оплата: форма → ссылка ЮKassa → оплатить тестовой картой →
 *      вебхук (скрипт шлёт его сам, как ЮKassa) → /paid «Оплачено»;
 *   2. повторный вебхук: тот же платёж ещё раз → already_paid, без изменений;
 *   3. поддельный вебхук: id несуществующего платежа → ignored;
 *   4. отмена: вторая заявка → оплатить картой с отказом (или закрыть оплату и
 *      дождаться отмены) → вебхук → canceled;
 *   5. возврат без оплаты: API ЮKassa отказывает в возврате неоплаченного платежа.
 * Овербукинг (оплата после истёкшего холда, когда мест нет) и гонки
 * проверяются автотестами: lib/clubs/payments.test.ts.
 *
 * ВНИМАНИЕ: создаёт заявки в базе приложения. Только тестовая база.
 */

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => rl.question(`\n${q}`);
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

async function signup(nick: string): Promise<{ redirectUrl: string; statusUrl: string; requestToken: string }> {
  const requestToken = token();
  const res = await fetch(`${base}/api/club-signup`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Тест Смоук", telegram: `@${nick}`, email: "smoke@example.com", level: "first", mat: "studio", towel: "no", water: "no",
      consent: true, quantity: 1, club: "stretch", source: "smoke", request_token: requestToken }),
  });
  const body = (await res.json()) as Record<string, string>;
  if (!res.ok || !body.redirectUrl) throw new Error(`club-signup: HTTP ${res.status} ${JSON.stringify(body)}`);
  return { redirectUrl: body.redirectUrl, statusUrl: body.statusUrl, requestToken };
}

async function webhook(event: string, id: string): Promise<unknown> {
  const res = await fetch(`${base}/api/yookassa/webhook`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "notification", event, object: { id, status: event.split(".")[1] } }),
  });
  return { http: res.status, ...(await res.json()) };
}

async function paymentIdFromRedirect(url: string): Promise<string> {
  const id = new URL(url).searchParams.get("orderId");
  if (!id) throw new Error(`не нашёл id платежа в ссылке ${url}`);
  return id;
}

async function main(): Promise<void> {
  const config = yookassaConfig();
  if (!config) throw new Error("нет YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY");
  if (!config.secretKey.startsWith("test_")) throw new Error("ключ не тестовый (test_…): скрипт только для тестового магазина");
  const yk = createYooKassa(config);
  const status = async (id: string) => (await yk.getPayment(id)).status;

  console.log(`Приложение: ${base}\nЮKassa: ${YOOKASSA_API}, магазин ${config.shopId}`);

  // 1. Успешная оплата.
  const ok = await signup(`smoke_ok_${Date.now() % 100000}`);
  const okId = await paymentIdFromRedirect(ok.redirectUrl);
  console.log(`\n1) Оплати тестовой картой: ${ok.redirectUrl}`);
  await ask("Оплатил? Enter…");
  console.log("   статус в API:", await status(okId));
  console.log("   вебхук payment.succeeded:", await webhook("payment.succeeded", okId));
  console.log(`   проверь страницу: ${ok.statusUrl} → «Оплачено»`);

  // 2. Повторный вебхук.
  console.log("\n2) повторный вебхук:", await webhook("payment.succeeded", okId), "— ждём outcome already_paid");

  // 3. Поддельный вебхук.
  console.log("\n3) поддельный вебхук:", await webhook("payment.succeeded", "2fffffff-000f-5000-9000-1fffffffffff"), "— ждём ignored");

  // 4. Отмена.
  const bad = await signup(`smoke_cancel_${Date.now() % 100000}`);
  const badId = await paymentIdFromRedirect(bad.redirectUrl);
  console.log(`\n4) Оплати картой с отказом (или закрой оплату): ${bad.redirectUrl}`);
  await ask("Платёж отменён в ЮKassa? Enter…");
  console.log("   статус в API:", await status(badId));
  console.log("   вебхук payment.canceled:", await webhook("payment.canceled", badId), "— ждём canceled");

  // 5. Возврат без оплаты: прямой запрос к API (защиту в коде обходим нарочно).
  const pending: YkPayment = await yk.createPayment({ amount: rub(100), description: "smoke: возврат без оплаты", returnUrl: `${base}/paid?o=smoke`, metadata: { smoke: "1" } }, `smoke-refund-${token()}`);
  const res = await fetch(`${YOOKASSA_API}/refunds`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${config.shopId}:${config.secretKey}`)}`, "Content-Type": "application/json", "Idempotence-Key": token() },
    body: JSON.stringify({ payment_id: pending.id, amount: pending.amount }),
  });
  console.log(`\n5) возврат неоплаченного платежа: HTTP ${res.status} (ждём 4xx)`, await res.text());
  try {
    await yk.refundPayment(pending, `refund-${pending.id}`);
    console.log("   ✗ клиент отправил возврат неоплаченного платежа");
  } catch (err) {
    console.log("   ✓ клиент не отправляет возврат:", err instanceof Error ? err.message : String(err));
  }
  rl.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  rl.close();
  process.exit(1);
});
