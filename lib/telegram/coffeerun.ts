import { InlineKeyboard } from "grammy";
import { tgAdmin } from "./supabase";
import { formatPace, normalizePace } from "../coffeerun/pace";
import { runForSignup, runWhenWhere, upcomingRuns, type CoffeeRun } from "../coffeerun/run";
import { normalizeTelegramUsername, formatTelegramUsername } from "../coffeerun/telegram-username";
import { publicOriginFromEnv } from "../public-origin";
import { SUPPORT_LABEL, SUPPORT_URL } from "./cta";
import type { BotContext } from "./bot";

/**
 * Подтверждение записи на кофе-ран.
 *
 * Заявка приходит с лендинга (POST /api/coffeerun-signup) и живёт неподтверждённой,
 * пока человек не нажмёт «Подтвердить в Telegram». Кнопка ведёт на
 * t.me/<bot>?start=cr_<token>, бот находит заявку и отвечает в личку данными
 * участника и деталями его забега.
 *
 * Забегов несколько и они от разных спотов, поэтому бот отвечает деталями
 * ИМЕННО той заявки, которую нашёл (spot + run_date в строке), а не ближайшего
 * забега вообще: иначе человек с Лужников получил бы адрес Усачёвой.
 *
 * Два пути входа:
 *   1) deep-link с токеном — основной: токен из браузера автора заявки, подделать
 *      нельзя, поэтому подтверждаем даже если ник в форме набран с опечаткой
 *      (реальный ник при этом перезаписываем — он и есть правда);
 *   2) просто /start — запасной: ищем заявку по нику того, кто пишет боту.
 *      Работает, если человек нашёл бота поиском, а не по кнопке.
 *
 * В обе стороны идёт ТОЛЬКО ответ на действие пользователя (он сам открыл бота),
 * поэтому opt-in из tg_bindings здесь не нужен — гейт про бот-инициированные
 * рассылки, а не про ответ на /start.
 */
export const COFFEE_RUN_START_PREFIX = "cr_";

export interface CoffeeRunSignup {
  id: string;
  name: string;
  email: string;
  tg_username: string | null;
  confirmed_at: string | null;
  /** Слаг спота заявки: с какого лендинга пришёл человек (см. lib/coffeerun/run). */
  spot: string | null;
  run_date: string | null;
  /** Выбранный темп, мин/км (см. lib/coffeerun/pace). null — заявка без выбора. */
  pace: string | null;
}

const TABLE = "coffee_run_signups";
const COLUMNS = "id, name, email, tg_username, confirmed_at, spot, run_date, pace";

/** Токен из payload `/start cr_<token>`; null, если payload не наш. */
export function parseCoffeeRunToken(payload: string): string | null {
  const trimmed = payload.trim();
  if (!trimmed.startsWith(COFFEE_RUN_START_PREFIX)) return null;
  const token = trimmed.slice(COFFEE_RUN_START_PREFIX.length);
  return /^[a-f0-9]{16,64}$/i.test(token) ? token : null;
}

/**
 * Текст подтверждения. Чистая функция — вся формулировка в одном месте и
 * покрыта тестами.
 *
 * @param actualUsername ник того, кто открыл бота (может отличаться от заявки)
 * @param repeat         повторное подтверждение — не пугаем «зарегистрировали дважды»
 */
export function confirmationText(
  signup: Pick<CoffeeRunSignup, "name" | "email" | "tg_username" | "pace">,
  run: CoffeeRun,
  actualUsername: string | null,
  repeat = false,
): string {
  const username = actualUsername ?? signup.tg_username;
  // Через канон, а не как есть: в старых строках темпа нет вовсе, и печатать
  // в личку то, чего мы не узнаём, бот не должен.
  const pace = normalizePace(signup.pace);
  const lines: string[] = [];

  lines.push(repeat ? "Ты уже в списке — всё на месте." : "Заявка на кофе-ран найдена.");
  lines.push("");
  lines.push(`Имя: ${signup.name}`);
  if (username) lines.push(`Telegram: ${formatTelegramUsername(username)}`);
  lines.push(`E-mail: ${signup.email}`);
  // Спот отдельной строкой: у забегов разные адреса и разные дни, и человек
  // должен видеть свой сразу, а не вычитывать его из абзаца ниже.
  lines.push(`Забег: ${run.spotName}, ${run.dateLabel} (${run.weekday})`);
  // Темп — такой же факт заявки, как имя и почта: человек видит, в какой он
  // группе, и может написать нам, если передумал.
  if (pace) lines.push(`Темп: ${formatPace(pace)}`);

  // Ник в форме разошёлся с реальным — говорим прямо, какой оставили.
  if (actualUsername && signup.tg_username && actualUsername !== signup.tg_username) {
    lines.push("");
    lines.push(
      `В заявке был указан ${formatTelegramUsername(signup.tg_username)} — ` +
        `оставила актуальный ${formatTelegramUsername(actualUsername)}.`,
    );
  }

  lines.push("");
  lines.push(`Вы успешно зарегистрированы! Ждём вас на пробежке ${runWhenWhere(run)}.`);
  // Без выбора темпа остаётся прежняя формулировка: обещать группу, которую
  // человек не выбирал, нельзя.
  lines.push(
    pace
      ? `${run.distance} с пейсерами, твоя группа — ${formatPace(pace)}. Кофе на финише.`
      : `${run.distance} в разговорном темпе, с пейсерами. Кофе на финише.`,
  );

  return lines.join("\n");
}

/**
 * Напоминание за сутки. Отдельный текст, а не копия подтверждения: человек уже
 * знает, что записан, ему нужны время, место и «не проспи».
 *
 * Обращаемся по имени из заявки — оно точно есть (форма его требует).
 */
export function reminderText(signup: Pick<CoffeeRunSignup, "name">, run: CoffeeRun): string {
  return [
    `${signup.name}, завтра бежим!`,
    "",
    `Твой забег: ${run.spotName}.`,
    `Кофе-ран — ${runWhenWhere(run)}.`,
    `${run.distance} в разговорном темпе, с пейсерами. Кофе на финише.`,
    "",
    "Приходи за 15 минут до старта: успеем познакомиться и размяться.",
  ].join("\n");
}

/**
 * Кнопки под сообщениями о забеге: маршрут до спота и сайт НИКИ.
 *
 * `support` добавляет кнопку живой поддержки. Включаем её в подтверждении
 * записи: это момент, когда у человека возникают вопросы («а можно с другом?»,
 * «я опоздаю»), и ему нужен человек, а не бот.
 */
export function runKeyboard(
  run: CoffeeRun,
  opts: { support?: boolean } = {},
): InlineKeyboard {
  const kb = new InlineKeyboard().url("Как добраться", run.mapUrl);
  const site = publicOriginFromEnv();
  if (site) kb.row().url("Открыть НИКУ", site);
  if (opts.support) kb.row().url(SUPPORT_LABEL, SUPPORT_URL);
  return kb;
}

/** Заявка по одноразовому токену. */
async function findByToken(token: string): Promise<CoffeeRunSignup | null> {
  const { data, error } = await tgAdmin()
    .from(TABLE)
    .select(COLUMNS)
    .eq("confirm_token", token)
    .maybeSingle();
  if (error) {
    console.error("[coffeerun] findByToken:", error.message);
    return null;
  }
  return (data as CoffeeRunSignup | null) ?? null;
}

/**
 * Неподтверждённая заявка по нику — на любой из ещё не прошедших забегов.
 * Ищем сразу по всем будущим датам, а не по ближайшей: человек мог записаться
 * на Лужники, пока ближайшим числится забег на Усачёвой, и по одной дате его
 * заявка бы не нашлась. Берём самую свежую: если форм было несколько,
 * актуальна последняя.
 */
async function findUnconfirmedByUsername(
  username: string,
  runDates: string[],
): Promise<CoffeeRunSignup | null> {
  if (runDates.length === 0) return null;

  const { data, error } = await tgAdmin()
    .from(TABLE)
    .select(COLUMNS)
    .eq("tg_username", username)
    .in("run_date", runDates)
    .is("confirmed_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[coffeerun] findUnconfirmedByUsername:", error.message);
    return null;
  }
  return ((data as CoffeeRunSignup[] | null) ?? [])[0] ?? null;
}

/**
 * Фиксирует подтверждение. confirmed_at не переписываем — важна первая отметка.
 * chat_id сохраняем всегда: по нему бот сможет напомнить о забеге накануне.
 */
async function markConfirmed(
  signup: CoffeeRunSignup,
  chatId: number,
  actualUsername: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { tg_chat_id: chatId };
  if (!signup.confirmed_at) patch.confirmed_at = new Date().toISOString();
  if (actualUsername) patch.tg_username = actualUsername;

  const { error } = await tgAdmin().from(TABLE).update(patch).eq("id", signup.id);
  if (error) console.error("[coffeerun] markConfirmed:", error.message);
}

/** Общий хвост обоих путей: записать подтверждение и ответить участнику. */
async function confirmAndReply(
  ctx: BotContext,
  signup: CoffeeRunSignup,
  chatId: number,
): Promise<void> {
  const actual = normalizeTelegramUsername(ctx.from?.username ?? null);
  const repeat = signup.confirmed_at !== null;
  // Забег — из самой заявки: подтверждаем то, на что человек записался.
  const run = runForSignup(signup);

  // runForSignup никогда не падает — при незнакомом споте он откатывается на
  // забег по дате или на ближайший. Тихо это делать нельзя: человек получит
  // адрес чужого спота, и без записи в логе причину потом не найти.
  if (signup.spot && signup.spot !== run.spot) {
    console.error(
      `[coffeerun] спот заявки ${signup.id} — «${signup.spot}», ` +
        `но забег разрешился в «${run.spot}»: спот отсутствует в COFFEE_RUNS?`,
    );
  }

  await markConfirmed(signup, chatId, actual);
  await ctx.reply(confirmationText(signup, run, actual, repeat), {
    reply_markup: runKeyboard(run, { support: true }),
  });
}

/** Ссылка на лендинг забега — единственное, куда можно отправить «потерявшегося». */
function landingUrl(run: CoffeeRun): string | null {
  const site = publicOriginFromEnv();
  // Без хвостового слэша: с ним Next отвечает 308 на этот же адрес.
  return site ? `${site}${run.landing}` : null;
}

/**
 * Кнопки «записаться» — по одной на каждый будущий забег. Спотов несколько, и
 * отправлять всех на одну страницу значит терять тех, кому ближе другой спот.
 * Пока забег один, подпись остаётся прежней: уточнять спот не с чем.
 */
export function landingKeyboard(): InlineKeyboard | undefined {
  const runs = upcomingRuns();
  const kb = new InlineKeyboard();
  let added = 0;

  for (const run of runs) {
    const url = landingUrl(run);
    if (!url) continue;
    if (added > 0) kb.row();
    kb.url(runs.length > 1 ? `Кофе-ран · ${run.spotName}` : "Записаться на кофе-ран", url);
    added++;
  }

  return added > 0 ? kb : undefined;
}

/**
 * Путь 1: /start cr_<token> с лендинга.
 * Токен невалиден/не найден → не выдумываем регистрацию, зовём на лендинг.
 */
export async function handleCoffeeRunStart(ctx: BotContext, payload: string): Promise<void> {
  const chatId = ctx.from?.id;
  if (chatId === undefined) return;

  const token = parseCoffeeRunToken(payload);
  const signup = token ? await findByToken(token) : null;

  if (!signup) {
    await ctx.reply(
      "Не нашла заявку по этой ссылке — возможно, она устарела. " +
        "Заполни форму на странице кофе-рана ещё раз, и я подтвержу участие.",
      { reply_markup: landingKeyboard() },
    );
    return;
  }

  await confirmAndReply(ctx, signup, chatId);
}

/**
 * Путь 2: обычный /start без токена. Возвращает true, если заявка нашлась и
 * подтверждена — тогда вызывающий не показывает своё обычное приветствие.
 */
export async function handleCoffeeRunByUsername(ctx: BotContext): Promise<boolean> {
  const chatId = ctx.from?.id;
  const username = normalizeTelegramUsername(ctx.from?.username ?? null);
  if (chatId === undefined || !username) return false;

  const signup = await findUnconfirmedByUsername(
    username,
    upcomingRuns().map((r) => r.date),
  );
  if (!signup) return false;

  await confirmAndReply(ctx, signup, chatId);
  return true;
}
