/**
 * Обработка апдейта Telegram после ответа вебхуку.
 *
 * Если отвечать 200 только после handleUpdate, долгий обработчик (рассылка,
 * походы в базу) не укладывается в ожидание Telegram: тот рвёт соединение, а в
 * логе остаётся «Error: aborted / ECONNRESET». Поэтому роут отвечает сразу, а
 * апдейт дорабатывается здесь. Это безопасно, потому что прод живёт на Railway
 * долгоживущим процессом (`next start`); на serverless фон обрывался бы.
 *
 * Медленные апдейты пишем в лог, чтобы видеть, какой обработчик тормозит.
 */
export const SLOW_UPDATE_MS = 5_000;

export function processInBackground(
  logPrefix: string,
  updateId: number | undefined,
  handle: () => Promise<void>,
): void {
  const startedAt = Date.now();
  void (async () => {
    try {
      await handle();
    } catch (err) {
      console.error(`${logPrefix} handleUpdate:`, err instanceof Error ? err.message : String(err));
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= SLOW_UPDATE_MS) {
      console.warn(`${logPrefix} апдейт ${updateId ?? "?"} обработан за ${elapsed} мс`);
    }
  })();
}
