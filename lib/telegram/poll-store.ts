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
  /** Чаты, которым бот шлёт ленту ответов и сводку (команда /admin <ключ>). */
  adminChatIds: number[];
  /** Кому вопрос уже ушёл: chatId → карточка участника. */
  sent: Map<number, PollRecipient>;
  /** Ответы: chatId → голос. */
  votes: Map<number, PollVote>;
}

const KEY = Symbol.for("nika.coffeerun.poll.state");

function empty(runDate: string): PollState {
  return { runDate, adminChatIds: [], sent: new Map(), votes: new Map() };
}

function state(): PollState {
  const g = globalThis as unknown as Record<symbol, PollState | undefined>;
  if (!g[KEY]) g[KEY] = empty("");
  return g[KEY];
}

/**
 * Переключить опрос на другой забег. Ответы при этом стираются: сводка «побегут
 * завтра» не должна складываться с прошлым воскресеньем. Список админ-чатов
 * переживает смену — он про людей, а не про забег.
 */
export function startPoll(runDate: string): void {
  const admins = state().adminChatIds;
  const g = globalThis as unknown as Record<symbol, PollState | undefined>;
  g[KEY] = { ...empty(runDate), adminChatIds: admins };
}

/** Текущий забег опроса ("" — опрос ещё ни разу не запускали). */
export function pollRunDate(): string {
  return state().runDate;
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

export interface PollSummary {
  runDate: string;
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
