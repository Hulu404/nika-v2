/**
 * ПУЛ ФОРМУЛИРОВОК утреннего pure-push нуджа + сборка сообщения (Приложение А ТЗ).
 * Голос Ники: второе лицо, тепло, без вины, максимум один эмодзи. НИКОГДА про
 * цикл/фазу/месячные — ни прямо, ни намёком (privacy + нейтральность локскрина).
 * Тексты правит один человек в одном месте — здесь.
 *
 * Чистые хелперы: крона тут нет, их дёргает крон нуджа (Промт 4). Транспорт
 * (sendMessage) не трогаем — reply_markup отдаём в готовом виде Bot API.
 */

export interface MorningVariant {
  variant: string;
  text: string;
}

/**
 * Стартовый набор. Ротация по `variant`, поэтому коды стабильны (не текст) —
 * правка формулировки не ломает лог/ротацию. Добавлять варианты — сюда же.
 */
export const MORNING_VARIANTS: MorningVariant[] = [
  { variant: "m1", text: "Доброе утро 🌤 Как ты сегодня — по телу и по настроению? Загляни, отметимся вместе." },
  { variant: "m2", text: "Утро. Прежде чем бежать — сверимся, как ты. Я рядом." },
  { variant: "m3", text: "Привет 🌿 Давай отметим, как ты проснулась. С этого и начнём день." },
  { variant: "m4", text: "Доброе утро. Твой бег сегодня начинается с одного вопроса — как ты?" },
];

/**
 * Ротация: выбирает вариант, НЕ равный прошлому (чтобы не приедалось). Если
 * прошлого нет или он единственный — выбор из всего пула. Чистая функция.
 */
export function pickVariant(lastVariant?: string): MorningVariant {
  const pool = lastVariant
    ? MORNING_VARIANTS.filter((v) => v.variant !== lastVariant)
    : MORNING_VARIANTS;
  const choices = pool.length ? pool : MORNING_VARIANTS;
  return choices[Math.floor(Math.random() * choices.length)];
}

// ── CTA (одна URL-кнопка на экран чек-ина) ────────────────────────────────────

/** Экран чек-ина «Мой ритм». Сверено с Промтом 0: route = /rhythm (не /ritm). */
export const CHECKIN_PATH = "/rhythm";

/** Источник перехода — для атрибуции клика (clicked_at при src=tg_morning). */
export const MORNING_SRC = "tg_morning";

/** Подписи кнопки в одной таблице: основная + запасная. */
export const CTA_LABELS = {
  primary: "Открыть Нику",
  spare: "Заглянуть к Нике",
} as const;

export interface MorningCta {
  text: string;
  url: string;
}

/**
 * Одна URL-кнопка в приложение.
 *   • autoLoginUrl задан (Промт 4 обернул ссылку через /api/tg/open, magic-link
 *     уже с to=CHECKIN_PATH и src=tg_morning) → используем её как есть, чтобы
 *     незалогиненный в браузере попадал сразу внутрь. Минт token_hash тут НЕ
 *     размазываем — принимаем готовый url параметром.
 *   • иначе → прямой диплинк ${NEXT_PUBLIC_APP_URL}${CHECKIN_PATH}?src=tg_morning.
 *   • пустой NEXT_PUBLIC_APP_URL и нет autoLoginUrl → null (кнопки нет, сообщение
 *     всё равно уходит).
 */
export function buildMorningCta(autoLoginUrl?: string): MorningCta | null {
  const text = CTA_LABELS.primary;

  if (autoLoginUrl) return { text, url: autoLoginUrl };

  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) return null;

  const url = `${base.replace(/\/$/, "")}${CHECKIN_PATH}?src=${MORNING_SRC}`;
  return { text, url };
}

// ── Сборка сообщения ──────────────────────────────────────────────────────────

export interface MorningMessage {
  text: string;
  variant: string;
  reply_markup?: { inline_keyboard: MorningCta[][] };
}

/**
 * Готовое сообщение нуджа: текст (ротация) + одна URL-кнопка.
 * `userId` прокидывает Промт 4 (лог/атрибуция; сюда же можно завести per-user
 * авто-логин, когда появится /api/tg/open). `autoLoginUrl` — опциональная
 * готовая обёртка авто-логина (см. buildMorningCta).
 *
 * Сбой сборки CTA не роняет вызов: без кнопки сообщение всё равно валидно.
 */
export function buildMorningMessage(
  userId: string,
  lastVariant?: string,
  autoLoginUrl?: string,
): MorningMessage {
  void userId; // резерв под лог/атрибуцию и будущий per-user авто-логин (Промт 4)

  const chosen = pickVariant(lastVariant);

  let reply_markup: MorningMessage["reply_markup"];
  try {
    const cta = buildMorningCta(autoLoginUrl);
    if (cta) reply_markup = { inline_keyboard: [[cta]] };
  } catch {
    /* без кнопки сообщение остаётся валидным — не роняем нудж */
  }

  return { text: chosen.text, variant: chosen.variant, reply_markup };
}
