import type { SectionHandler } from "./section";
import { handleKb } from "./sections/kb";
import { handleRuns } from "./sections/runs";
import { handleTeam } from "./sections/team";
import { handlePro, handleProduct } from "./sections/summaries";
import { handleSocial } from "./sections/social";
import type { Section } from "./types";

/**
 * Обработчики разделов. Раздел без обработчика или с SECTION_READY = false
 * отвечает «Этот раздел ещё собираю».
 */
export const SECTION_HANDLERS: Partial<Record<Section, SectionHandler>> = {
  run: handleRuns,
  kb: handleKb,
  tm: handleTeam,
  pro: handlePro,
  prd: handleProduct,
  tr: handleSocial,
};
