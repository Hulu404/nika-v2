/**
 * Переменные окружения бота данных команды — в одном месте, по образцу
 * lib/team/config.ts: модулям, которым нужно только «а бот вообще настроен?»,
 * незачем втягивать за собой весь бот.
 */

/** Токен бота данных. Это третий бот в BotFather, не командный и не основной. */
export function databotToken(): string | null {
  return process.env.DATABOT_TOKEN?.trim() || null;
}

/** Есть ли вообще смысл поднимать бота данных в этом окружении. */
export function databotConfigured(): boolean {
  return databotToken() !== null;
}

export function databotTaskConfig(): { chatId: number; sourceThreads: number[]; workThread: number | null } | null {
  const chat = process.env.DATABOT_TASK_CHAT_ID?.trim() ?? "";
  const sources = process.env.DATABOT_TASK_SOURCE_THREAD_IDS?.split(",").map(s => s.trim()) ?? [];
  const work = process.env.DATABOT_TASK_WORK_THREAD_ID?.trim() ?? "";
  const positive = (s: string) => /^[1-9]\d*$/.test(s) && Number.isSafeInteger(Number(s));
  if (!/^-\d+$/.test(chat) || !Number.isSafeInteger(Number(chat)) || Number(chat) >= 0 || !sources.length ||
      !sources.every(positive) || (work !== "" && !positive(work))) return null;
  return { chatId: Number(chat), sourceThreads: sources.map(Number), workThread: work ? Number(work) : null };
}
