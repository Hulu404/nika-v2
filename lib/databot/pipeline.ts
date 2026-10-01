import { InputFile, type Context, type Keyboard, type MiddlewareFn } from "grammy";
import { databotTaskConfig } from "./config";
import { handleTaskUpdate } from "./task-handler";
import { handleAssignedUpdate } from "./assigned-handler";
import type { InlineKeyboardMarkup, ReplyKeyboardRemove } from "grammy/types";
import { audienceOf, can, isEnvOwner, zoneCan } from "./access";
import { buildAuditEntry, recordAudit } from "./audit";
import {
  CANCEL_TEXT,
  DB_DOWN_TEXT,
  FORM_EXPIRED_TEXT,
  PEOPLE_WINDOW_TEXT,
  NOT_READY_TEXT,
  OWNER_PROTECTED_TEXT,
  RATE_LIMIT_TEXT,
  STALE_TEXT,
  STRANGER_TEXT,
  UNKNOWN_TEXT,
  forbiddenText,
  itemForbiddenText,
  helpText,
  inviteExpiredText,
  menuText,
  welcomeText,
} from "./copy";
import { classifyDbError } from "./data/errors";
import type { DatabotStore } from "./data/store";
import { FORM_ROUTE, formExpired } from "./form";
import { messageToKbHtml } from "./kb-html";
import { interimTextRoute } from "./router/interim";
import { welcomeKbArticle } from "./sections/kb";
import { SECTION_HANDLERS } from "./handlers";
import { parseIntent } from "./intent";
import { REMOVE_KEYBOARD, commandsFor, menuButtons, replyKeyboard, setChatCommands } from "./menu";
import type { DatabotEffects, SectionOutcome } from "./section";
import { SECTION_COMMAND, SECTION_HOME_REPORT, SECTION_READY, allowedSections, visibleSections } from "./sections";
import { mskToday } from "./time";
import type { AnyReport, Intent, MemberRow, ReportId, Screen, Section, Subject } from "./types";

/**
 * Конвейер апдейта бота данных — единственное место, где решается, что делать
 * с апдейтом. Порядок держится здесь, а не размазан по экранам:
 *
 *   0. бот сам вошёл в чужую группу или канал → выходит, больше ничего;
 *   1. нажатие кнопки гасится сразу, до любых проверок;
 *   2. только настроенный командный чат отдаём учёту задач; отчёты — из лички;
 *   3. лимит — раньше всего остального, включая /start;
 *   4. членство — одна выборка по chat_id, без кеша; чужой получает одну фразу;
 *   5. разбор запроса → Intent;
 *   6. зона — после разбора и ДО любого обращения к данным отчёта;
 *   7. валидаторы — внутри разбора (intent.ts): те же, что будут у текста;
 *   8. обработчик раздела;
 *   9. журнал — на КАЖДЫЙ ответ, одной функцией.
 */

export const RATE_LIMIT = { limit: 30, windowSeconds: 60 } as const;

/** Статусы, при которых бот числится участником чата. */
const PRESENT_STATUSES = new Set(["member", "administrator", "restricted"]);

export interface PipelineDeps {
  store: DatabotStore;
  /** Часы — подменяются в тестах (срок приглашения, «последний визит»). */
  now?: () => Date;
}

type ReplyMarkup = Keyboard | ReplyKeyboardRemove;

export function createPipeline(deps: PipelineDeps): MiddlewareFn<Context> {
  const now = deps.now ?? (() => new Date());
  return (ctx) => runPipeline(ctx, deps.store, now);
}

async function runPipeline(ctx: Context, store: DatabotStore, clock: () => Date): Promise<void> {
  const startedAt = Date.now();

  // Шаг 0. Бота добавили в чужую группу, супергруппу или канал — уходим. Собственный
  // выход (left) и блокировка в личке (kicked) приходят сюда же — без ответа.
  const membership = ctx.myChatMember;
  if (membership) {
    const { chat, new_chat_member } = membership;
    if (chat.type !== "private" && PRESENT_STATUSES.has(new_chat_member.status) &&
        !((chat.type === "group" || chat.type === "supergroup") && chat.id === databotTaskConfig()?.chatId)) {
      await leave(ctx, chat.id);
    }
    return;
  }

  // Шаг 1. Индикатор загрузки на кнопке гасим сразу — как lib/team/bot.ts.
  if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});

  if (await handleAssignedUpdate(ctx, store, clock())) return;
  if (await handleTaskUpdate(ctx, store)) return;

  // Шаг 2. Личка для отчётов; учёт задач настроенной группы уже обработан.
  const chat = ctx.chat;
  if (!chat) return;
  if (chat.type !== "private") {
    if (chat.type === "group" || chat.type === "supergroup") await leave(ctx, chat.id);
    return;
  }

  const chatId = chat.id;
  const now = clock();
  const audit = (args: { zone: Subject["zone"] | null; intent: Intent | null; report?: AnyReport; ok: boolean; error?: string | null }) =>
    recordAudit(store, buildAuditEntry({ chatId, startedAt, ...args }));

  // Шаг 3. Лимит.
  if (!(await store.checkRateLimit(`databot:${chatId}`, RATE_LIMIT.limit, RATE_LIMIT.windowSeconds))) {
    await send(ctx, { text: RATE_LIMIT_TEXT });
    await audit({ zone: null, intent: null, report: "rate_limited", ok: false, error: "rate_limited" });
    return;
  }

  const parsed = parseIntent({
    text: ctx.message?.text ?? null,
    callbackData: ctx.callbackQuery ? (ctx.callbackQuery.data ?? "") : null,
  });
  const parsedIntent = parsed.kind === "intent" ? parsed.intent : null;

  // Шаг 4. Членство.
  const isOwner = isEnvOwner(chatId);
  const profile = {
    username: ctx.from?.username ?? null,
    display_name: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || null,
  };

  let member: MemberRow | null;
  let joined = false;
  try {
    member = await store.findActiveMember(chatId);
    if (!member) {
      const entry = await admit(store, chatId, isOwner, parsedIntent, profile, now);
      if (entry.kind === "refused") {
        await send(ctx, { text: entry.text }, REMOVE_KEYBOARD);
        await audit({ zone: null, intent: parsedIntent, report: "no_member", ok: true, error: entry.error });
        return;
      }
      member = entry.member;
      joined = true;
    }
  } catch (err) {
    // База не ответила: это не «чужой» и не ноль.
    logError("members", err);
    await send(ctx, { text: DB_DOWN_TEXT });
    await audit({ zone: null, intent: parsedIntent, report: parsedIntent?.report ?? "no_member", ok: false, error: classifyDbError(err) });
    return;
  }

  if (!joined) await store.touchMember(chatId, { ...profile, is_owner: isOwner }, now);

  // Владелец из env всегда в совете, что бы ни лежало в строке.
  const subject: Subject = { chatId, zone: isOwner ? "council" : member.zone, isOwner };
  const visible = visibleSections(subject);
  const keyboard = replyKeyboard(visible);
  const effects: DatabotEffects = { setCommands: (id, zone) => setChatCommands(ctx.api, id, zone) };

  if (joined) {
    await effects.setCommands(chatId, subject.zone);
    await send(ctx, { text: welcomeText(subject.zone, visible) }, keyboard);
    // Статья «Кто за что отвечает», если она уже есть в справочнике и видна
    // зоне. Сбой справочника вход не портит: человек уже внутри.
    try {
      const article = await welcomeKbArticle({
        subject,
        member,
        intent: { report: "kb.article", section: "kb", action: "art", params: {}, source: "command" },
        store,
        effects,
        now,
        botUsername: ctx.me.username,
      });
      if (article) await send(ctx, article);
    } catch (err) {
      logError("welcome", err);
    }
    await audit({ zone: subject.zone, intent: parsedIntent, report: "start", ok: true });
    return;
  }

  const isCallback = !!ctx.callbackQuery;

  // Шаг 4½. Форма (form.ts): пока она открыта, текст человека идёт в неё, а не
  // в разбор вопроса. Любая команда форму закрывает (/cancel ответит
  // «Отменила» ниже), кнопки её не трогают.
  let formIntent: Intent | null = null;
  const messageText = ctx.message?.text;
  if (messageText !== undefined && !isCallback) {
    let form;
    try {
      form = await store.getForm(chatId);
    } catch (err) {
      logError("form", err);
      await send(ctx, { text: DB_DOWN_TEXT }, keyboard);
      await audit({ zone: subject.zone, intent: parsedIntent, ok: false, error: classifyDbError(err) });
      return;
    }
    if (form) {
      const route = FORM_ROUTE[form.kind];
      const asIntent: Intent = {
        report: route.report,
        section: route.section,
        action: route.action,
        // value — как есть; value_html — с форматированием Telegram (жирный,
        // курсив, ссылка) для текстов справочника. В журнал не попадает ни то,
        // ни другое: этих ключей нет в AUDIT_PARAM_KEYS.
        params: {
          ...form.params,
          value: messageText.trim(),
          value_html: messageToKbHtml(messageText, ctx.message?.entities),
        },
        source: "text",
        form: true,
      };
      if (messageText.trim().startsWith("/")) {
        await store.clearSession(chatId);
      } else if (formExpired(form, now)) {
        await store.clearSession(chatId);
        await send(ctx, { text: FORM_EXPIRED_TEXT }, keyboard);
        await audit({ zone: subject.zone, intent: asIntent, ok: false, error: "form_expired" });
        return;
      } else {
        formIntent = asIntent;
      }
    }
  }

  // Шаг 5. Разбор уже сделан; кнопка, которую нельзя выполнить, — устарела.
  let intent: Intent;
  if (formIntent) {
    intent = formIntent;
  } else if (parsed.kind === "stale") {
    await replyStale(ctx, subject, parsed.section, keyboard, store, effects, now);
    // Битая кнопка известного отчёта (список участников) — это отказ по
    // этому отчёту, а не безликий stale: каждое открытие списка в журнале.
    await audit({
      zone: subject.zone,
      intent: null,
      report: parsed.report ?? "stale",
      ok: !parsed.report,
      error: parsed.report ? "bad_params" : null,
    });
    return;
  } else {
    intent = parsed.intent;
  }

  switch (intent.report) {
    case "start":
      // /start всегда присылает актуальную клавиатуру и меню команд.
      await effects.setCommands(chatId, subject.zone);
      await send(ctx, { text: menuText(subject.zone, visible) }, keyboard);
      await audit({ zone: subject.zone, intent, ok: true });
      return;
    case "help":
      await send(ctx, { text: helpText(subject.zone, visible, commandsFor(visible, subject.isOwner).map((c) => c.command)) }, keyboard);
      await audit({ zone: subject.zone, intent, ok: true });
      return;
    case "menu":
      if (intent.action === "cancel") {
        await store.clearSession(chatId);
        await send(ctx, { text: CANCEL_TEXT }, keyboard);
      } else {
        await send(ctx, { text: menuText(subject.zone, visible), buttons: menuButtons(visible) }, keyboard, isCallback);
      }
      await audit({ zone: subject.zone, intent, ok: true });
      return;
    case "unknown": {
      // Временный маршрутизатор (router/interim.ts) до Промта 14: пока текст
      // ищется только в справочнике среди статей зоны.
      if (intent.source === "text" && intent.rawText) {
        try {
          const found = await interimTextRoute(
            { subject, member, intent, store, effects, now, botUsername: ctx.me.username },
            intent.rawText,
          );
          if (found) {
            await sendScreens(ctx, found.screens, keyboard, false);
            const routed: Intent = found.slug
              ? { report: "kb.article", section: "kb", action: "art", params: { slug: found.slug }, source: "text" }
              : { report: "clarify", section: "kb", action: "clarify", params: {}, source: "text" };
            await audit({ zone: subject.zone, intent: routed, ok: true });
            return;
          }
        } catch (err) {
          logError("interim", err);
          await send(ctx, { text: DB_DOWN_TEXT }, keyboard);
          await audit({ zone: subject.zone, intent, ok: false, error: classifyDbError(err) });
          return;
        }
      }
      await send(ctx, { text: UNKNOWN_TEXT }, keyboard);
      await audit({ zone: subject.zone, intent, ok: true });
      return;
    }
  }

  // Отчёт раздела.
  const report = intent.report as ReportId;
  const section = intent.section as Section;

  // Шаг 6. Зона — до обращения к данным.
  const target = intent.params.target ? Number(intent.params.target) : undefined;
  // Дата забега — для окна списка участников и «только будущие» у плана явки.
  const accessCtx = { targetChatId: target, runDate: intent.params.date, today: mskToday(now) };
  // Зоны статьи справочника — это данные: здесь проверяем только, что зоне
  // справочник открыт, а видна ли сама статья, решает обработчик (kb.ts) по
  // той же матрице — до того, как текст статьи уйдёт человеку.
  const allowed = report === "kb.article" ? zoneCan(subject, report) : can(subject, report, accessCtx);
  if (!allowed) {
    if (report === "run.people" && zoneCan(subject, report)) {
      // Зоне список положен, но забег вне окна −3…+14 дней.
      await send(ctx, { text: PEOPLE_WINDOW_TEXT }, keyboard);
      await audit({ zone: subject.zone, intent, ok: false, error: "window" });
      return;
    }
    if (target !== undefined && subject.isOwner && (isEnvOwner(target) || target === chatId)) {
      await send(ctx, { text: OWNER_PROTECTED_TEXT }, keyboard);
    } else if (isCallback) {
      // Кнопка из старого экрана: зона сменилась, права уже нет.
      await replyStale(ctx, subject, section, keyboard, store, effects, now);
    } else {
      await send(ctx, { text: forbiddenText(audienceOf(report), allowedVisible(subject)) }, keyboard);
    }
    await audit({ zone: subject.zone, intent, ok: false, error: "forbidden" });
    return;
  }

  const handler = SECTION_HANDLERS[section];
  if (!SECTION_READY[section] || !handler) {
    await send(ctx, { text: NOT_READY_TEXT }, keyboard);
    await audit({ zone: subject.zone, intent, ok: false, error: "not_ready" });
    return;
  }

  // Шаг 8. Обработчик.
  let outcome: SectionOutcome;
  try {
    outcome = await handler({ subject, member, intent, store, effects, now, botUsername: ctx.me.username });
  } catch (err) {
    logError(report, err);
    await send(ctx, { text: DB_DOWN_TEXT }, keyboard);
    await audit({ zone: subject.zone, intent, ok: false, error: classifyDbError(err) });
    return;
  }

  if (outcome.kind === "stale") {
    await replyStale(ctx, subject, section, keyboard, store, effects, now);
    await audit({ zone: subject.zone, intent, report: "stale", ok: true });
    return;
  }
  if (outcome.kind === "forbidden") {
    await send(ctx, { text: itemForbiddenText(allowedVisible(subject)) }, keyboard);
    await audit({ zone: subject.zone, intent, ok: false, error: "forbidden" });
    return;
  }

  if (outcome.consumeButton && ctx.callbackQuery?.message) {
    // Снимаем кнопки с нажатого сообщения ДО отправки: второе нажатие того же
    // «Ещё» уже не найдёт кнопку и не пришлёт ту же страницу ещё раз.
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  }
  await sendScreens(ctx, outcome.screens, keyboard, isCallback);
  // Шаг 9. Журнал — после отправки: latency_ms до ответа.
  await audit({ zone: subject.zone, intent, ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Вход
// ─────────────────────────────────────────────────────────────────────────────

type Admission =
  | { kind: "joined"; member: MemberRow }
  | { kind: "refused"; text: string; error: string | null };

/**
 * Человека нет среди активных. Пускаем, только если это владелец из env или
 * у него живое приглашение. Приглашение гасится одной командой в базе, поэтому
 * две параллельные попытки с одной ссылкой не пройдут обе.
 */
async function admit(
  store: DatabotStore,
  chatId: number,
  isOwner: boolean,
  intent: Intent | null,
  profile: { username: string | null; display_name: string | null },
  now: Date,
): Promise<Admission> {
  if (isOwner) {
    const member = await store.upsertMember(
      { chat_id: chatId, zone: "council", is_owner: true, invited_by: null, ...profile },
      now,
    );
    return { kind: "joined", member };
  }

  const token = intent?.report === "start" ? intent.params.invite : undefined;
  if (!token) return { kind: "refused", text: STRANGER_TEXT, error: null };

  const redeemed = await store.redeemInvite(token, chatId, now);
  if (redeemed) {
    // Повторное приглашение убранного человека реактивирует его с новой зоной.
    const member = await store.upsertMember(
      { chat_id: chatId, zone: redeemed.zone, is_owner: false, invited_by: redeemed.created_by, ...profile },
      now,
    );
    return { kind: "joined", member };
  }

  const invite = await store.findInvite(token);
  if (!invite) return { kind: "refused", text: STRANGER_TEXT, error: null };
  const inviter = await store.findMember(invite.created_by);
  const name = inviter?.display_name ?? (inviter?.username ? `@${inviter.username}` : null);
  return { kind: "refused", text: inviteExpiredText(name), error: "invite_expired" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ответы
// ─────────────────────────────────────────────────────────────────────────────

/** Разделы, доступные зоне и готовые, — для текста отказа. */
function allowedVisible(subject: Subject): Section[] {
  const visible = new Set(visibleSections(subject));
  return allowedSections(subject).filter((s) => visible.has(s));
}

/**
 * «Этот экран устарел» и свежий экран раздела. Если раздел закрыт или не готов
 * — только доступные разделы (они в постоянной клавиатуре этого же ответа).
 */
async function replyStale(
  ctx: Context,
  subject: Subject,
  section: Section | null,
  keyboard: ReplyMarkup,
  store: DatabotStore,
  effects: DatabotEffects,
  now: Date,
): Promise<void> {
  const visible = visibleSections(subject);
  await send(ctx, { text: STALE_TEXT }, keyboard);
  if (!section || !visible.includes(section)) return;

  const handler = SECTION_HANDLERS[section];
  if (!handler) return;
  const report = SECTION_HOME_REPORT[section];
  if (!can(subject, report)) return;
  try {
    const member = await store.findActiveMember(subject.chatId);
    if (!member) return;
    const intent: Intent = { report, section, action: "list", params: {}, source: "button" };
    const outcome = await handler({ subject, member, intent, store, effects, now, botUsername: ctx.me.username });
    if (outcome.kind === "screens") await sendScreens(ctx, outcome.screens, keyboard, false);
  } catch (err) {
    logError(`${SECTION_COMMAND[section]}:stale`, err);
  }
}

async function sendScreens(ctx: Context, screens: Screen[], keyboard: ReplyMarkup, editFirst: boolean): Promise<void> {
  for (const [i, screen] of screens.entries()) {
    await send(ctx, screen, keyboard, editFirst && i === 0);
  }
}

function inlineMarkup(screen: Screen): InlineKeyboardMarkup | undefined {
  if (!screen.buttons?.length) return undefined;
  return {
    inline_keyboard: screen.buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
  };
}

/**
 * Отправка одного экрана. Инлайн-кнопки и постоянная клавиатура в одно
 * сообщение не помещаются (reply_markup один), поэтому клавиатура уходит с
 * теми ответами, где кнопок нет, — /start, /help, отказы, «экран устарел».
 *
 * edit — заменить сообщение с нажатой кнопкой. Не вышло (сообщение старое или
 * не изменилось) — присылаем новым.
 */
async function send(ctx: Context, screen: Screen, keyboard?: ReplyMarkup, edit = false): Promise<void> {
  const inline = inlineMarkup(screen);
  const base = {
    parse_mode: "HTML" as const,
    link_preview_options: { is_disabled: true },
  };

  if (screen.document) {
    // CSV и прочие файлы — документом в личку; текст экрана — подпись.
    const file = new InputFile(Buffer.from(screen.document.content, "utf8"), screen.document.filename);
    await ctx.replyWithDocument(file, { caption: screen.text, parse_mode: "HTML", protect_content: screen.protect || undefined });
    return;
  }

  // Защищённый экран — только новым сообщением: у отредактированного
  // сообщения protect_content не появляется.
  if (edit && !screen.protect && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(screen.text, { ...base, reply_markup: inline });
      return;
    } catch {
      // Падаем в обычную отправку ниже.
    }
  }

  await ctx.reply(screen.text, {
    ...base,
    protect_content: screen.protect || undefined,
    reply_markup: inline ?? keyboard,
  });
}

async function leave(ctx: Context, chatId: number): Promise<void> {
  // chat_id в прод-логи не пишем: только сам факт и причину сбоя.
  await ctx.api.leaveChat(chatId).catch((err) => {
    console.error("[databot] leaveChat:", err instanceof Error ? err.message : String(err));
  });
}

function logError(where: string, err: unknown): void {
  console.error(`[databot] ${where}:`, err instanceof Error ? err.message : String(err));
}

