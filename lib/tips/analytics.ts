import { track } from "@/lib/track";

/**
 * События раздела «Советы». Тонкая обёртка над track(): только структурные
 * значения (id совета), без текста карточек. По образцу lib/rhythm/analytics.ts.
 */
export const tipsAnalytics = {
  opened: () => track("tips_opened"),
  saved: (tipId: number) => track("tip_saved", { tipId }),
  unsaved: (tipId: number) => track("tip_unsaved", { tipId }),
};
