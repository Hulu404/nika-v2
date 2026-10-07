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

/**
 * «Пятница» пишет сама: сводка дня в 8:00 МСК и вопрос о явке через 3 часа
 * после ивента клуба. Окно проверяет сама, дедуп держат таблицы team_digests
 * и team_event_asks (тикер делает первый проход на каждом деплое).
 */
async function tickTeamDigests(): Promise<void> {
  try {
    const { dispatchTeamDigests } = await import("./lib/team/digest");
    const res = await dispatchTeamDigests();
    if (res.sent?.length) {
      console.log("[team-digest] отправлено:", res.sent.join(", "), "получателей", res.recipients);
    }
  } catch (err) {
    console.error("[team-digest] тик упал:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * «Пятница» фаундерам: снимок Telegram-канала и вопрос про Instagram в
 * 21:00 МСК, сводка в 10:00 и 22:30. Окна и дедуп — в lib/team/founders/.
 */
async function tickFounderReports(): Promise<void> {
  try {
    const { dispatchFounderReports } = await import("./lib/team/founders/dispatch");
    const res = await dispatchFounderReports();
    if (res.done?.length) console.log("[founders] сделано:", res.done.join(", "));
  } catch (err) {
    console.error("[founders] тик упал:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Уборка бота данных: старые приглашения, raw_text журнала старше 30 дней,
 * журнал старше 180, брошенные формы. Раз в сутки, первый проход после 04:00
 * МСК — окно и отметку «сегодня убрано» проверяет сама. Без DATABOT_TOKEN
 * возвращает absent и ничего не трогает.
 */
async function tickDatabotCleanup(): Promise<void> {
  try {
    const { runDatabotCleanup } = await import("./lib/databot/cleanup");
    const res = await runDatabotCleanup();
    if (res.status === "done") console.log(`[databot] уборка: ${res.detail ?? "готово"}`);
  } catch (err) {
    console.error("[databot] уборка упала:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Напоминания по задачам команды из /assign: за сутки (или за три часа) до
 * срока и одно сообщение о просрочке. Окно и тихие часы проверяет сама, дедуп —
 * отметки в databot_assigned_tasks. Без DATABOT_TOKEN — пустой проход.
 */
async function tickDatabotTaskReminders(): Promise<void> {
  try {
    const { dispatchAssignedReminders } = await import("./lib/databot/assigned-reminders");
    const res = await dispatchAssignedReminders();
    if (res.reminders || res.overdue) {
      console.log(`[databot] задачи: напоминаний ${res.reminders ?? 0}, просрочек ${res.overdue ?? 0}`);
    }
  } catch (err) {
    console.error("[databot] напоминания по задачам упали:", err instanceof Error ? err.message : String(err));
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

  // Внутренний бот команды — тем же правилом «работает сайт = работает бот».
  // Без TEAM_BOT_TOKEN тихо пропускается: в окружении, где его нет, второго
  // бота просто не существует, и падать из-за этого приложению незачем.
  const { ensureTeamWebhook } = await import("./lib/team/ensure-webhook");
  const team = await ensureTeamWebhook();
  console.log(`[team] webhook: ${team.status}${team.detail ? ` — ${team.detail}` : ""}`);

  // Бот данных команды — то же правило. Без DATABOT_TOKEN ни строки в логе:
  // бота в этом окружении просто нет. Сбой регистрации приложение не роняет.
  try {
    const { ensureDatabotWebhook } = await import("./lib/databot/ensure-webhook");
    const data = await ensureDatabotWebhook();
    if (data.status === "registered") console.log("[databot] webhook: registered");
    else if (data.status !== "absent") console.error(`[databot] webhook: ${data.status} — ${data.detail ?? ""}`);
  } catch (err) {
    console.error("[databot] webhook: failed —", err instanceof Error ? err.message : String(err));
  }

  // Первый проход сразу после старта: если деплой пришёлся на окно рассылки,
  // напоминание уйдёт не через 15 минут, а тут же.
  void tickReminders();
  void tickInvites();
  void tickTeamDigests();
  void tickFounderReports();
  void tickDatabotCleanup();
  void tickDatabotTaskReminders();
  const timer = setInterval(() => {
    void tickReminders();
    void tickInvites();
    void tickTeamDigests();
    void tickFounderReports();
    void tickDatabotCleanup();
    void tickDatabotTaskReminders();
  }, REMINDER_TICK_MS);
  // Не держим процесс живым только ради тикера.
  timer.unref?.();
  // Явный след в логах: молчание бота однажды уже прошло незамеченным именно
  // потому, что о незапущенном слушателе нигде не было сказано.
  console.log(
    `[coffeerun] тикер запущен, интервал ${REMINDER_TICK_MS / 60000} мин ` +
      "(напоминания накануне + приглашения по понедельникам + сводки команде + сроки задач)",
  );
}
