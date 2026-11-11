import { readFileSync } from "node:fs";
import path from "node:path";
import { publicOriginFromEnv } from "../public-origin";
import { eventForLanding } from "./events";
import { CANONICAL_ORIGIN, renderTemplate } from "./template";

/**
 * Лендинг с диска + подстановка (lib/landings/template.ts). Только для
 * серверного маршрута app/api/landing/[name]/route.ts: здесь node:fs, в бот и
 * edge-сборку этот файл не импортировать.
 */
export {
  escapeHtml,
  eventJsonOf,
  placeholderValues,
  renderTemplate,
  scriptJson,
  shiftTime,
} from "./template";

/** Каталог шаблонов: landings/ в корне репозитория (вне public/, напрямую не отдаётся). */
export const LANDINGS_DIR = path.join(process.cwd(), "landings");

const templateCache = new Map<string, string>();

/** Исходный HTML лендинга. Файлы меняются только деплоем, поэтому кэшируем на процесс. */
export function landingTemplate(name: string): string {
  let html = templateCache.get(name);
  if (html === undefined) {
    html = readFileSync(path.join(LANDINGS_DIR, `${name}.html`), "utf8");
    templateCache.set(name, html);
  }
  return html;
}

/**
 * Готовая страница лендинга на момент `now`. null — такого лендинга нет или
 * у него нет ни одного события (ни будущего, ни прошедшего).
 */
export function renderLanding(name: string, now: Date = new Date()): string | null {
  const event = eventForLanding(name, now);
  if (!event) return null;
  return renderTemplate(landingTemplate(name), event, publicOriginFromEnv() ?? CANONICAL_ORIGIN);
}

/**
 * Кэш страницы лендинга: минута свежести и пять минут «отдать старое, пока
 * обновляется». Перенос забега в run.ts доезжает до страницы за минуту после деплоя.
 */
export const LANDING_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";
