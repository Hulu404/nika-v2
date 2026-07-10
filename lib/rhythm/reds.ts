/**
 * RED-S — безопасная заглушка ЗА ФЛАГОМ. По умолчанию выключена: в MVP не
 * форсим. Никакого счёта фаз, никакого прогноза. Срабатывает ТОЛЬКО если
 * пользователь сам отмечал месячные и виден длинный разрыв при регулярных
 * самоотчётах о нагрузке — тогда один раз, мягко, с предложением показаться
 * специалисту. Порог и формулировку финализирует Ali (это конфиг).
 */
export interface RedsConfig {
  enabled: boolean;
  /** Длинный разрыв без отметок месячных, дней. */
  gapDays: number;
  /** Сколько самоотчётов о нагрузке за окно считаем «регулярно». */
  minLoadReports: number;
  /** Окно подсчёта регулярности, дней. */
  windowDays: number;
  /** Формулировка мягкой реплики (Ali финализирует). */
  message: string;
}

export const RHYTHM_REDS: RedsConfig = {
  enabled: false,
  gapDays: 90,
  minLoadReports: 8,
  windowDays: 30,
  message:
    "Заметила, месячных давно не было, а бегаешь ты регулярно. Это не диагноз и не повод пугаться. Если захочешь, покажись специалисту, так спокойнее.",
};

export interface RedsSignals {
  /** Пользователь сам отмечал месячные (иначе не срабатываем вовсе). */
  hasSelfReportedPeriods: boolean;
  /** Дней с последней отметки месячных (null — если отметок нет). */
  daysSinceLastPeriod: number | null;
  /** Регулярные самоотчёты о нагрузке (пробежки) за окно. */
  loadReportsInWindow: number;
}

/**
 * Показывать ли одноразовую заглушку RED-S. Чистая функция без побочек и без
 * какого-либо счёта цикла/фаз.
 */
export function shouldShowRedsNotice(
  signals: RedsSignals,
  cfg: RedsConfig = RHYTHM_REDS,
): boolean {
  if (!cfg.enabled) return false;
  if (!signals.hasSelfReportedPeriods) return false;
  if (signals.daysSinceLastPeriod === null) return false;
  if (signals.daysSinceLastPeriod < cfg.gapDays) return false;
  if (signals.loadReportsInWindow < cfg.minLoadReports) return false;
  return true;
}
