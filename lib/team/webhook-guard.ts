/**
 * Защита вебхука «Пятницы» от второго экземпляра с тем же токеном.
 *
 * Дважды (10.11 и 11.11.2026) сразу после деплоя бот замолкал: Telegram
 * слал апдейты с секретом, который не совпадал с TEAM_WEBHOOK_SECRET сервера
 * (401), то есть вебхук перерегистрировал кто-то другой с тем же
 * TEAM_BOT_TOKEN и своим секретом. Если вебхук возвращают себе по таймеру все
 * экземпляры, они перетягивают его по кругу.
 *
 * Поэтому возвращает вебхук себе только тот, к кому апдейты реально приходят
 * и кто их отклоняет: роут отмечает отказ (noteRejectedSecret) и сразу
 * перерегистрирует вебхук со своим секретом, тикер — только если отказ был
 * недавно. Экземпляр, к которому апдейты не приходят, вебхук не трогает.
 *
 * Состояние на globalThis: роут и тикер instrumentation.ts живут в одном
 * процессе, но в разных графах модулей.
 */

const KEY = Symbol.for("nika.team.webhook.guard");
/** Не чаще раза в 30 секунд: Telegram ретраит очередь пачкой. */
const HEAL_EVERY_MS = 30_000;
/** «Недавно отклоняли» для тикера. */
export const REJECTED_WINDOW_MS = 10 * 60_000;

interface GuardState {
  rejectedAt: number;
  healedAt: number;
}

function state(): GuardState {
  const g = globalThis as unknown as Record<symbol, GuardState | undefined>;
  return (g[KEY] ??= { rejectedAt: 0, healedAt: 0 });
}

/** Апдейт пришёл с чужим секретом. */
export function noteRejectedSecret(now: number = Date.now()): void {
  state().rejectedAt = now;
}

/** Этот экземпляр недавно отклонял апдейты с чужим секретом. */
export function rejectedRecently(now: number = Date.now(), windowMs: number = REJECTED_WINDOW_MS): boolean {
  const at = state().rejectedAt;
  return at > 0 && now - at <= windowMs;
}

/** Перерегистрировать вебхук после отказа, не чаще раза в 30 секунд. true — запустили. */
export function healAfterRejection(heal: () => Promise<unknown>, now: number = Date.now()): boolean {
  const s = state();
  if (now - s.healedAt < HEAL_EVERY_MS) return false;
  s.healedAt = now;
  void heal().catch((err) => console.error("[team-webhook] восстановление:", err instanceof Error ? err.message : String(err)));
  return true;
}

/** Для тестов. */
export function __resetWebhookGuard(): void {
  const g = globalThis as unknown as Record<symbol, GuardState | undefined>;
  g[KEY] = { rejectedAt: 0, healedAt: 0 };
}
