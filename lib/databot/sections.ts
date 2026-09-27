import { canOpenSection } from "./access";
import { SECTIONS, type ReportId, type Section, type Subject } from "./types";

/**
 * Готовность разделов — ОДИН флаг в одном месте. Неготового раздела нет ни в
 * постоянной клавиатуре, ни в меню команд; если до него всё же дошли (старая
 * клавиатура, команда руками) — «Этот раздел ещё собираю».
 *
 * Включают: run — Промт 5, kb — Промт 7, tr — Промт 12, pro и prd — Промт 13.
 */
export const SECTION_READY: Record<Section, boolean> = {
  run: true,
  tr: false,
  pro: false,
  prd: false,
  kb: true,
  tm: true,
};

/** Команда раздела (без «/»). */
export const SECTION_COMMAND: Record<Section, string> = {
  run: "runs",
  tr: "social",
  pro: "pro",
  prd: "product",
  kb: "kb",
  tm: "team",
};

/** Отчёт, которым открывается раздел. */
export const SECTION_HOME_REPORT: Record<Section, ReportId> = {
  run: "run.section",
  tr: "tr.section",
  pro: "pro.summary",
  prd: "prd.summary",
  kb: "kb.list",
  tm: "tm.list",
};

/** Разделы, которые человек видит в клавиатуре и меню: доступны зоне И готовы. */
export function visibleSections(subject: Subject): Section[] {
  return SECTIONS.filter((s) => SECTION_READY[s] && canOpenSection(subject, s));
}

/** Разделы, доступные зоне, независимо от готовности. */
export function allowedSections(subject: Subject): Section[] {
  return SECTIONS.filter((s) => canOpenSection(subject, s));
}
