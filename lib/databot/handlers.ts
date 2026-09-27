import type { SectionHandler } from "./section";
import { handleRuns } from "./sections/runs";
import { handleTeam } from "./sections/team";
import type { Section } from "./types";

/**
 * Обработчики разделов. Раздел без обработчика или с SECTION_READY = false
 * отвечает «Этот раздел ещё собираю».
 */
export const SECTION_HANDLERS: Partial<Record<Section, SectionHandler>> = {
  run: handleRuns,
  tm: handleTeam,
};
