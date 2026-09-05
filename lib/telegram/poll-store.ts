/**
 * Состояние опроса про погоду — БЕЗ базы данных.
 *
 * Решение осознанное: опрос разовый («завтра дождь — побежишь?»), ради него не
 * заводим ни столбцов, ни таблиц. Настоящий архив ответов — переписка
 * организатора с ботом: каждый ответ прилетает ему отдельным сообщением сразу,
 * и это единственное, что переживает вообще всё. Хранилище ниже нужно только
 * для живой сводки по команде /poll и для того, чтобы не спросить одного
 * человека дважды.
 *
 * Живёт в памяти процесса. Файл на диске пробовали — и убрали: bot.ts попадает
 * ещё и в edge-бандл (через instrumentation → ensure-webhook), а там node:fs
 * недоступен и сборка падает. Цена памяти известна и принята: перезапуск
 * приложения обнуляет сводку и список «кого уже спросили» — лента ответов в
 * личке при этом остаётся, а /pollsend перед отправкой показывает, скольким
 * собирается написать, так что внезапный повтор видно до того, как он уйдёт.
 *
 * Состояние висит на globalThis, а не в модульной переменной: в dev Next
 * перезагружает модули на каждое изменение, и опрос иначе терялся бы посреди
 * работы.
 */

export type PollAnswer = "yes" | "no";

/**
 * Какой именно вопрос сейчас задан:
 *   rain     — «завтра дождь, побежишь?» (накануне, про погоду);
 *   rollcall — перекличка «придёшь сегодня к такому-то времени?».
 * Вид определяет и текст вопроса, и подписи в сводке.
 */
export type PollKind = "rain" | "rollcall";

export interface PollRecipient {
  chatId: number;
  /** Имя из заявки — оно человечнее ника в Telegram. */
  name: string;
  username: string | null;
}

export interface PollVote {
  chatId: number;
  name: string;
  username: string | null;
  answer: PollAnswer;
  /** ISO — когда нажал (последнее нажатие: ответ можно менять). */
  at: string;
}

interface PollState {
  /** Забег, про который идёт опрос (YYYY-MM-DD); "" — опрос ещё не запускали. */
  runDate: string;
  /** Вопрос, который сейчас задан. */
  kind: PollKind;
  /** Время старта в вопросе переклички («18:00»); null — штатное время забега. */
  startTime: string | null;
  /** Чаты, которым бот шлёт ленту ответов и сводку (команда /admin <ключ>). */
  adminChatIds: number[];
  /** Кому вопрос уже ушёл: chatId → карточка участника. */
  sent: Map<number, PollRecipient>;
  /** Ответы: chatId → голос. */
  votes: Map<number, PollVote>;
  /**
   * Разовые объявления (перенос старта и подобное): ключ объявления → кому уже
   * ушло. Отдельно от опроса: объявлений за день может быть несколько, и
   * «перенос на 18:00» не должен мешать повторно объявить «на 19:00».
   */
  notices: Map<string, Set<number>>;
  /**
   * Последний объявленный перенос: дата забега → новое время. Нужен перекличке:
   * спрашивать «придёшь в 9:30?» после того, как всем объявили 18:00, — прямой
   * способ собрать неверные ответы.
   */
  moved: Map<string, string>;
}

const KEY = Symbol.for("nika.coffeerun.poll.state");

function empty(runDate: string, kind: PollKind = "rain", startTime: string | null = null): PollState {
  return {
    runDate,
    kind,
    startTime,
    adminChatIds: [],
    sent: new Map(),
    votes: new Map(),
    // Объявления и переносы переживают смену опроса: их ключ и так с датой.
    notices: new Map(),
    moved: new Map(),
  };
}

function state(): PollState {
  const g = globalThis as unknown as Record<symbol, PollState | undefined>;
  if (!g[KEY]) g[KEY] = empty("");
  // Состояние могло быть создано прошлой версией кода (dev, hot-reload).
  const s = g[KEY];
  if (!s.notices) s.notices = new Map();
  if (!s.moved) s.moved = new Map();
  if (!s.kind) s.kind = "rain";
  return s;
}

/**
 * Начать опрос: другой забег или другой вопрос. Ответы стираются — сводка
 * переклички не должна складываться с утренним «побежишь под дождём». Список
 * админ-чатов, объявления и переносы переживают смену: они про людей и про
 * забег, а не про конкретный вопрос.
 */
export function startPoll(
  runDate: string,
  kind: PollKind = "rain",
  startTime: string | null = null,
): void {
  const { adminChatIds, notices, moved } = state();
  const g = globalThis as unknown as Record<symbol, PollState | undefined>;
  g[KEY] = { ...empty(runDate, kind, startTime), adminChatIds, notices, moved };
}

/** Текущий забег опроса ("" — опрос ещё ни разу не запускали). */
export function pollRunDate(): string {
  return state().runDate;
}

/** Какой вопрос сейчас задан. */
export function pollKind(): PollKind {
  return state().kind;
}

/** Время старта в вопросе переклички; null — штатное время забега. */
export function pollStartTime(): string | null {
  return state().startTime;
}

/** Запомнить объявленный перенос — перекличка возьмёт это время по умолчанию. */
export function markMoved(runDate: string, newStart: string): void {
  state().moved.set(runDate, newStart);
}

/** Во сколько по последнему объявлению стартует забег; null — переносов не было. */
export function movedStartFor(runDate: string): string | null {
  return state().moved.get(runDate) ?? null;
}

/** Запомнить чат организатора: сюда полетят ответы и сводка. */
export function addAdminChat(chatId: number): void {
  const s = state();
  if (!s.adminChatIds.includes(chatId)) s.adminChatIds.push(chatId);
}

export function removeAdminChat(chatId: number): void {
  const s = state();
  s.adminChatIds = s.adminChatIds.filter((id) => id !== chatId);
}

export function adminChats(): number[] {
  return [...state().adminChatIds];
}

export function isAdminChat(chatId: number): boolean {
  return state().adminChatIds.includes(chatId);
}

/** Уже спрошенные — чтобы повторный /pollsend не задвоил вопрос. */
export function alreadyAsked(chatId: number): boolean {
  return state().sent.has(chatId);
}

export function markSent(r: PollRecipient): void {
  state().sent.set(r.chatId, r);
}

/**
 * Записать ответ. Возвращает голос целиком — вызывающий отправит его лентой
 * организатору. Имя берём из карточки рассылки (там имя из заявки), а если её
 * нет (например, после перезапуска) — из профиля Telegram.
 */
export function recordVote(
  chatId: number,
  answer: PollAnswer,
  fallback: { name: string; username: string | null },
): PollVote {
  const s = state();
  const known = s.sent.get(chatId);
  const vote: PollVote = {
    chatId,
    name: known?.name ?? fallback.name,
    username: known?.username ?? fallback.username,
    answer,
    at: new Date().toISOString(),
  };
  s.votes.set(chatId, vote);
  return vote;
}

/**
 * Разовые объявления: кому уже отправляли сообщение с этим ключом. Ключ задаёт
 * вызывающий (например, "moved:2026-09-05:18:00"), чтобы повторная команда не
 * задвоила рассылку, а новое объявление ушло всем заново.
 */
export function alreadyNotified(key: string, chatId: number): boolean {
  return state().notices.get(key)?.has(chatId) ?? false;
}

export function markNotified(key: string, chatId: number): void {
  const s = state();
  const set = s.notices.get(key) ?? new Set<number>();
  set.add(chatId);
  s.notices.set(key, set);
}

export interface PollSummary {
  runDate: string;
  kind: PollKind;
  /** Время старта переклички; null — штатное время забега. */
  startTime: string | null;
  yes: PollVote[];
  no: PollVote[];
  /** Спросили, но человек ещё не нажал ни одной кнопки. */
  silent: PollRecipient[];
  asked: number;
}

export function pollSummary(): PollSummary {
  const s = state();
  const votes = [...s.votes.values()];
  return {
    runDate: s.runDate,
    kind: s.kind,
    startTime: s.startTime,
    yes: votes.filter((v) => v.answer === "yes"),
    no: votes.filter((v) => v.answer === "no"),
    silent: [...s.sent.values()].filter((r) => !s.votes.has(r.chatId)),
    asked: s.sent.size,
  };
}

/** Только для тестов: забыть всё. */
export function __resetPollStateForTests(): void {
  const g = globalThis as unknown as Record<symbol, PollState | undefined>;
  g[KEY] = empty("");
}
