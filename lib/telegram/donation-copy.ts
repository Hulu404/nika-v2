/**
 * Все тексты поддержки клуба (донатов). Тексты 1–15 утверждены Дмитрием
 * (бриф «поддержка клуба»), берутся дословно — не дописывать и не «улучшать».
 * В коде донатов строк для человека мимо этого файла нет (это проверяет тест).
 *
 * Голос — от лица команды, во множественном числе. Сердечко оранжевое 🧡.
 */

// ── Суммы ────────────────────────────────────────────────────────────────────

/** Кнопки сумм на экране «Поддержать» и под сообщением после события. */
export const DONATION_AMOUNTS = [200, 500, 1000] as const;
export const DONATION_MIN_RUB = 100;
export const DONATION_MAX_RUB = 50_000;

// ── Утверждённые тексты (таблица брифа) ───────────────────────────────────────

/** 1. Кнопка постоянного меню. */
export const DONATE_MENU_LABEL = "🧡 Поддержать";

/** 2. Кнопки сумм: «200 ₽», «500 ₽», «1000 ₽» и «Своя сумма». */
export const amountLabel = (amount: number) => `${amount} ₽`;
export const CUSTOM_AMOUNT_LABEL = "Своя сумма";

/** 3. Кнопка-ссылка на страницу оплаты ЮKassa. */
export const payLabel = (amount: number) => `Оплатить ${amount} ₽`;

/** 4. Экран «Поддержать» (по кнопке меню). Им же подписана кнопка оплаты после ввода суммы или почты. */
export const DONATE_SCREEN_TEXT =
  "Многие встречи наших клубов бесплатные. Если хочешь поддержать нашу команду, будем очень признательны. Это добровольно 🤗";

/** 5. Запрос своей суммы (после «Своя сумма»). */
export const ASK_AMOUNT_TEXT = "Напиши сумму числом, от 100 ₽. Например: 300";

/** 6. Сумма не подошла — переспрашиваем. */
export const BAD_AMOUNT_TEXT = "Нужно целое число от 100 до 50 000. Попробуешь ещё раз?";

/** 7. Почты для чека нет ни в одной заявке — просим один раз. */
export const ASK_EMAIL_TEXT = "Куда прислать чек? Напиши почту.";

/** 8. Почта не похожа на почту. */
export const BAD_EMAIL_TEXT = "Похоже, в адресе опечатка. Проверь и пришли ещё раз.";

/** 9. Бот, после успешной оплаты (вебхук ЮKassa). */
export const THANKS_TEXT = "Спасибо большое, получили 🧡 Чек уже на почте. Увидимся на следующей встрече!";

/** 10. Страница /thanks после оплаты. */
export const THANKS_PAGE = {
  title: "Спасибо 🧡",
  text: "Чек придёт на почту. Возвращайся в бот, там расписание ближайших встреч.",
  button: "Открыть бот",
} as const;

/** 11. Оплата не прошла (платёж отменён). Под текстом — кнопка payLabel(amount). */
export const PAYMENT_FAILED_TEXT = "Оплата не прошла. Можно попробовать ещё раз, кнопка ниже.";

/** 12. Сообщение после события (флаг DONATIONS_AFTER_EVENT=1). Под ним — те же кнопки сумм. */
export const afterEventText = (eventPrep: string) =>
  `Спасибо, что сегодня был(а) на ${eventPrep} 🧡 Нам важно, что ты пришёл(шла). Если хочешь, чтобы таких встреч было больше, можешь поддержать клуб, это добровольно 🤗`;

/** {event_prep}: событие в предложном падеже по формату. */
export const EVENT_PREP: Record<string, string> = {
  coffeerun: "кофе-ране",
  pilates: "пилатесе",
  bookclub: "встрече книжного клуба",
};
export const EVENT_PREP_FALLBACK = "нашей встрече";
export const eventPrep = (format: string) => EVENT_PREP[format] ?? EVENT_PREP_FALLBACK;

/** 13. Последняя строка «🎟 Мои записи», если человек хоть раз поддержал клуб. */
export const SUPPORTER_LINE = "🧡 Ты поддерживаешь клуб";

/** 14. description платежа ЮKassa — так его покажет nika-pay-bot. */
export const PAYMENT_DESCRIPTION = "Поддержка клуба NIKA";

/** 15. Предмет расчёта в чеке 54-ФЗ. */
export const RECEIPT_ITEM = "Добровольная оплата участия в мероприятиях клуба NIKA";

// ── Вне таблицы: технические и служебные (на утверждение) ─────────────────────

/**
 * ЮKassa не создала платёж. Вне таблицы брифа: та же фраза, что у билетов в
 * club-signup.ts, — Дмитрию на утверждение.
 */
export const PAYMENT_UNAVAILABLE_TEXT = "Не получилось подготовить оплату. Напиши в поддержку — поможем.";

/** Страница /thanks, пока ЮKassa не подтвердила оплату (как на /paid у билетов). */
export const THANKS_PAGE_PENDING = {
  title: "Ждём подтверждения оплаты",
  text: "Обычно это занимает минуту, страница обновится сама.",
} as const;

// ── Организатору ──────────────────────────────────────────────────────────────

/** Подпись события для организатора в /done. */
export const runEventTitle = (spotName: string, dateLabel: string) => `Кофе-ран · ${spotName}, ${dateLabel}`;
export const sessionEventTitle = (title: string, dateLabel: string) => `${title}, ${dateLabel}`;

/** /done: сегодня нечего разослать. */
export const DONE_NOTHING_TEXT = "Сегодня нет стартовавших событий, по которым можно разослать спасибо.";

/** /done: заголовок списка событий. */
export const DONE_LIST_TEXT = "Каким событием закончили? Разошлём спасибо всем, кто пришёл.";

/** /done: строка события в списке. */
export const doneEventLine = (title: string, recipients: number) => `${title} — получат ${recipients}`;

/** /done: событие уже разослано (автоматически или раньше через /done). */
export const doneAlreadyText = (title: string, at: string, sent: number) =>
  `${title}: уже разослали в ${at}, получили ${sent} ${peopleWord(sent)}`;

/** /done: подтверждение. */
export const doneConfirmText = (title: string, recipients: number) =>
  `${title}. Разослать ${recipients} ${participantsWord(recipients)}?`;
export const DONE_SEND_LABEL = "Разослать";
export const DONE_CANCEL_LABEL = "Отмена";
export const DONE_CANCELLED_TEXT = "Отменили — никому ничего не отправляли.";
export const DONE_NIGHT_TEXT = "Сейчас ночь (22:00–9:00) — ночью не пишем. Разошли утром, если ещё актуально.";
export const DONE_DISABLED_TEXT = "Сообщения после событий выключены: на сервере не задан DONATIONS_AFTER_EVENT=1.";
export const DONE_FAILED_TEXT = "Не получилось проверить базу — ничего не отправили. Смотри логи сервера.";
export const doneSentText = (title: string, sent: number) => `${title}: разослали, получили ${sent} ${peopleWord(sent)}.`;

/** /donations: сводка за 7 и 30 дней. */
export function donationsSummaryText(rows: { days: number; total: number; count: number; bySource: Record<string, { total: number; count: number }> }[]): string {
  const sourceName: Record<string, string> = { menu: "из меню", after_event: "после события" };
  const lines = ["Поддержка клуба:"];
  for (const r of rows) {
    lines.push("", `За ${r.days} дней: ${r.total} ₽, оплат ${r.count}`);
    for (const [source, s] of Object.entries(r.bySource)) lines.push(`  ${sourceName[source] ?? source}: ${s.total} ₽, оплат ${s.count}`);
  }
  return lines.join("\n");
}
export const DONATIONS_DB_DOWN = "Не получилось собрать сводку — база не ответила. Смотри логи сервера.";

function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
}
const peopleWord = (n: number) => plural(n, "человек", "человека", "человек");
const participantsWord = (n: number) => plural(n, "участнику", "участникам", "участникам");
