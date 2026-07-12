import { track } from "@/lib/track";
import type { TipCategory } from "@/types/app";

/**
 * События раздела «Советы». Тонкая обёртка над track(): только структурные
 * значения (категория), без текста советов. По образцу lib/rhythm/analytics.ts.
 *
 * Сохранение совета происходит на сервере (инструмент save_tip в чате), где
 * track() недоступен, — поэтому события «сохранён» здесь нет.
 */
export const tipsAnalytics = {
  opened: () => track("tips_opened"),
  deleted: (category: TipCategory) => track("tip_deleted", { category }),
};
