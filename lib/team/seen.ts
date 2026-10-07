import { touchMember } from "./access";

/**
 * Метка «был в боте» (team_members.last_seen_at) для /team и сводки фаундерам.
 *
 * Ставится на любое действие в «Пятнице», но в базу пишется не чаще раза в
 * 5 минут на человека: иначе каждое нажатие в списке задач было бы лишним
 * UPDATE. Кэш в памяти процесса: после деплоя первая метка уйдёт сразу, и это
 * правильно. Для чужих (не в team_members) UPDATE просто ничего не находит.
 */

export const TOUCH_EVERY_MS = 5 * 60_000;

const lastTouch = new Map<number, number>();

/** Пора ли писать метку. Отмечает момент, если пора. */
export function shouldTouch(chatId: number, now: Date, cache: Map<number, number> = lastTouch): boolean {
  const prev = cache.get(chatId);
  if (prev !== undefined && now.getTime() - prev < TOUCH_EVERY_MS) return false;
  cache.set(chatId, now.getTime());
  return true;
}

/** Не бросает: метка не повод сломать ответ. */
export async function touchSeen(
  chatId: number,
  now: Date = new Date(),
  touch: (chatId: number, now: Date) => Promise<void> = touchMember,
  cache?: Map<number, number>,
): Promise<void> {
  if (!shouldTouch(chatId, now, cache)) return;
  try {
    await touch(chatId, now);
  } catch (err) {
    console.error("[team-seen]", err instanceof Error ? err.message : String(err));
  }
}

/** Для тестов: забыть, кого уже отмечали. */
export function resetSeenCache(): void {
  lastTouch.clear();
}
