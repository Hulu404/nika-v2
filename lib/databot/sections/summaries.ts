import { can } from "../access";
import { cb } from "../callback";
import { answerText, pageScreen } from "../copy";
import { fetchPro, type ProSummary } from "../data/pro";
import { fetchProduct, type ProductSummary } from "../data/product";
import { periodFromCode, type Period } from "../dates";
import { escapeHtml, formatInt, formatPeriodRange, formatRub } from "../format";
import type { SectionHandler } from "../section";
import type { Screen } from "../types";
import { isPage } from "../validate";

export const SUMMARY_PERIODS = ["7d", "pw", "tm", "30d"] as const;
export function isSummaryPeriod(value: string): boolean {
  return (SUMMARY_PERIODS as readonly string[]).includes(value);
}

const PERIOD_LABELS = ["7 дней", "Прошлая неделя", "Этот месяц", "30 дней"];
const PLAN_LABELS: Record<string, string> = { monthly: "Месяц", halfyear: "6 месяцев", pro: "Стартовый PRO" };
const CHANNEL_LABELS: Record<string, string> = {
  instagram: "Instagram", telegram: "Telegram", vk: "ВКонтакте", offline: "Офлайн",
  partner: "Партнёры", other: "Другие", none: "Без метки",
};
const label = (value: string) => escapeHtml(value.slice(0, 120));

function summaryScreen(section: "pro" | "prd", period: Period, code: string, page: number, details: string[], now: Date): Screen {
  const headline = `<b>${section === "pro" ? "Про и оплаты" : "Продукт"}</b> · ${formatPeriodRange(period.fromYmd, period.toYmd)} · МСК`;
  const pages: string[] = [];
  let chunk: string[] = [];
  for (const line of details) {
    if (chunk.length && (chunk.length === 8 || answerText({ headline, details: [...chunk, line], at: now }).length > 4000)) {
      pages.push(answerText({ headline, details: chunk, at: now }));
      chunk = [];
    }
    chunk.push(line);
  }
  pages.push(answerText({ headline, details: chunk, at: now }));
  const buttons = SUMMARY_PERIODS.map((p, i) => ({
    text: `${p === code ? "✓ " : ""}${PERIOD_LABELS[i]}`, data: cb(section, "summary", p),
  }));
  return pageScreen(pages, page - 1, (next) => cb(section, "summary", code, next + 1), [
    buttons.slice(0, 2), buttons.slice(2), [{ text: "В меню", data: cb(section, "home") }],
  ]);
}

export function proDetails(data: ProSummary): string[] {
  return [
    `PRO сейчас: ${formatInt(data.proNow)}`,
    `Из них: оплачено ${formatInt(data.proPaid)}, промо ${formatInt(data.proPromo)}, вручную ${formatInt(data.proManual)}`,
    `Оплаты за период: ${formatInt(data.paymentsCount)} на ${formatRub(data.paymentsSum)}`,
    `Погашений промо за период: ${formatInt(data.redeemedByCode.reduce((sum, row) => sum + row.count, 0))}`,
    `Из погасивших промо за период оплатили позже: ${formatInt(data.redeemedToPaid)} (по текущим данным)`,
    `Подписка истекает в ближайшие 7 дней: ${formatInt(data.expiring7d)}`,
    "Аккаунты команды исключены. PRO сейчас и истечение не зависят от выбранного периода.",
    ...Object.entries(data.paymentsByPlan).sort(([a], [b]) => a.localeCompare(b)).map(([plan, value]) =>
      `Оплаты · ${label(Object.hasOwn(PLAN_LABELS, plan) ? PLAN_LABELS[plan] : plan)}: ${formatInt(value.count)} на ${formatRub(value.sum)}`),
    ...data.redeemedByCode.map((row) => `Промо · ${label(row.code)}${row.label ? ` (${label(row.label)})` : ""}: ${formatInt(row.count)}`),
  ];
}

export function productDetails(data: ProductSummary): string[] {
  return [
    `Регистрации за период: ${formatInt(data.signups)}`,
    `Из зарегистрированных: прошли онбординг ${formatInt(data.onboarded)}, подключили Telegram ${formatInt(data.tgLinked)} (текущее состояние)`,
    `Активны за 7 дней до конца периода: ${formatInt(data.active7d)} (все пользователи)`,
    `Спринты за период: начаты ${formatInt(data.sprintsStarted)}, закрыты ${formatInt(data.sprintsClosed)}`,
    `Активные спринты сейчас: ${formatInt(data.sprintsActive)}`,
    `Утренние сообщения за полные дни периода: отправлены ${formatInt(data.nudgeSent)}, переходы ${formatInt(data.nudgeClicked)}`,
    `Возврат после пропуска: ${data.nsm === null ? "нет данных" : formatInt(data.nsm)}`,
    "Аккаунты команды исключены. Каналы регистраций — по последнему касанию.",
    ...Object.entries(data.byChannel).sort(([a], [b]) => a.localeCompare(b)).map(([channel, count]) =>
      `Регистрации · ${label(Object.hasOwn(CHANNEL_LABELS, channel) ? CHANNEL_LABELS[channel] : channel)}: ${formatInt(count)}`),
  ];
}

/** Данные и часы подменяются в тестах; ошибки БД обрабатывает общий конвейер. */
export function createSummaryHandlers(deps = { fetchPro, fetchProduct }): { pro: SectionHandler; prd: SectionHandler } {
  const handler = (section: "pro" | "prd"): SectionHandler => async (req) => {
    const report = section === "pro" ? "pro.summary" : "prd.summary";
    if (!can(req.subject, report)) return { kind: "forbidden" };
    if (req.intent.report !== report || !["list", "summary"].includes(req.intent.action)) return { kind: "stale" };
    const code = req.intent.params.period ?? "tm";
    const page = req.intent.params.page ?? "1";
    if (!isSummaryPeriod(code) || !isPage(page)) return { kind: "stale" };
    const period = periodFromCode(code, req.now)!;
    const details = section === "pro"
      ? proDetails(await deps.fetchPro(period.from, period.to))
      : productDetails(await deps.fetchProduct(period.from, period.to));
    return { kind: "screens", screens: [summaryScreen(section, period, code, Number(page), details, req.now)] };
  };
  return { pro: handler("pro"), prd: handler("prd") };
}

const handlers = createSummaryHandlers();
export const handlePro = handlers.pro;
export const handleProduct = handlers.prd;
