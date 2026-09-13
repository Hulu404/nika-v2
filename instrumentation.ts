/**
 * Стартовый хук Next (experimental.instrumentationHook). Выполняется один раз
 * на процесс сервера — здесь всё, что должно жить ровно столько же, сколько
 * живёт приложение: «работает сайт = работает бот в Telegram».
 *
 * Что делает:
 *   1. регистрирует вебхук Telegram (раньше это был разовый ручной curl —
 *      и однажды бот из-за этого молчал);
 *   2. поднимает тикер напоминаний за сутки до кофе-рана, чтобы рассылка не
 *      зависела от внешнего планировщика (на Railway vercel.json cron не работает);
 *   3. тем же тикером зовёт на новые забеги — по понедельникам с 10:00 МСК.
 *
 * ТОЛЬКО в production и только в nodejs-рантайме. В dev не трогаем ничего:
 * локальный `npm run bot:dev` работает на polling, а polling и вебхук
 * взаимоисключающи — установка вебхука из dev-сборки увела бы апдейты на прод.
 */

/** Как часто проверяем, не пора ли рассылать. Окно — «накануне, с 10:00 МСК». */
const REMINDER_TICK_MS = 15 * 60 * 1000;

/**
 * Приглашения на новый забег. Окно — «понедельник с 10:00 МСК», проверка внутри
 * самой рассылки, поэтому тикер зовёт её безусловно и в остальные дни получает
 * пустой проход.
 *
 * Дедуп держит таблица coffee_run_invites, а не память процесса: тикер делает
 * первый проход сразу при старте, то есть на каждом деплое, — с памятью
 * понедельничный релиз разослал бы приглашение повторно.
 */
async function tickInvites(): Promise<void> {
  try {
    const { dispatchCoffeeRunInvites } = await import("./lib/coffeerun/invite-dispatch");
    const res = await dispatchCoffeeRunInvites();
    if (res.sent) {
      console.log(
        "[coffeerun-invite] отправлено:",
        res.sent,
        "забеги",
        res.runs?.map((r) => `${r.spot}/${r.date}`).join(", "),
      );
    }
  } catch (err) {
    console.error(
      "[coffeerun-invite] тик упал:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function tickReminders(): Promise<void> {
  try {
    const { dispatchCoffeeRunReminders } = await import("./lib/coffeerun/reminder-dispatch");
    const res = await dispatchCoffeeRunReminders();
    // Логируем только когда реально что-то отправили — иначе тикер зашумит логи.
    if (res.sent) console.log("[coffeerun-reminder] отправлено:", res.sent, "забеги", res.runDates?.join(", "));
  } catch (err) {
    console.error(
      "[coffeerun-reminder] тик упал:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;

  const { ensureWebhook } = await import("./lib/telegram/ensure-webhook");
  const res = await ensureWebhook();
  console.log(`[telegram] webhook: ${res.status}${res.detail ? ` — ${res.detail}` : ""}`);

  // Первый проход сразу после старта: если деплой пришёлся на окно рассылки,
  // напоминание уйдёт не через 15 минут, а тут же.
  void tickReminders();
  void tickInvites();
  const timer = setInterval(() => {
    void tickReminders();
    void tickInvites();
  }, REMINDER_TICK_MS);
  // Не держим процесс живым только ради тикера.
  timer.unref?.();
  // Явный след в логах: молчание бота однажды уже прошло незамеченным именно
  // потому, что о незапущенном слушателе нигде не было сказано.
  console.log(
    `[coffeerun] тикер запущен, интервал ${REMINDER_TICK_MS / 60000} мин ` +
      "(напоминания накануне + приглашения по понедельникам)",
  );
}
