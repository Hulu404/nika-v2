import { InlineKeyboard } from "grammy";
import { tgAdmin } from "./supabase";
import { nextRun, runWhenWhere, type CoffeeRun } from "../coffeerun/run";
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
 * участника и деталями ближайшего забега.
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
  run_date: string | null;
}

const TABLE = "coffee_run_signups";
const COLUMNS = "id, name, email, tg_username, confirmed_at, run_date";

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
  signup: Pick<CoffeeRunSignup, "name" | "email" | "tg_username">,
  run: CoffeeRun,
  actualUsername: string | null,
  repeat = false,
): string {
  const username = actualUsername ?? signup.tg_username;
  const lines: string[] = [];

  lines.push(repeat ? "Ты уже в списке — всё на месте." : "Заявка на кофе-ран найдена.");
  lines.push("");
  lines.push(`Имя: ${signup.name}`);
  if (username) lines.push(`Telegram: ${formatTelegramUsername(username)}`);
  lines.push(`E-mail: ${signup.email}`);

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
  lines.push(`${run.distance} в разговорном темпе, с пейсерами. Кофе на финише.`);

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
 * Неподтверждённая заявка на ближайший забег по нику. Берём самую свежую:
 * если человек заполнил форму дважды, актуальна последняя.
 */
async function findUnconfirmedByUsername(
  username: string,
  runDate: string,
): Promise<CoffeeRunSignup | null> {
  const { data, error } = await tgAdmin()
    .from(TABLE)
    .select(COLUMNS)
    .eq("tg_username", username)
    .eq("run_date", runDate)
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
  const run = nextRun();

  await markConfirmed(signup, chatId, actual);
  await ctx.reply(confirmationText(signup, run, actual, repeat), {
    reply_markup: runKeyboard(run, { support: true }),
  });
}

/** Ссылка на лендинг — единственное, куда можно отправить «потерявшегося». */
function landingUrl(): string | null {
  const site = publicOriginFromEnv();
  // Без хвостового слэша: с ним Next отвечает 308 на этот же адрес.
  return site ? `${site}/coffeerunsurfsport` : null;
}

export function landingKeyboard(): InlineKeyboard | undefined {
  const url = landingUrl();
  return url ? new InlineKeyboard().url("Записаться на кофе-ран", url) : undefined;
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

  const signup = await findUnconfirmedByUsername(username, nextRun().date);
  if (!signup) return false;

  await confirmAndReply(ctx, signup, chatId);
  return true;
}
