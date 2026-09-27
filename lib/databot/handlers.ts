import type { SectionHandler } from "./section";
import { handleTeam } from "./sections/team";
import type { Section } from "./types";

/**
 * Обработчики разделов. Раздел без обработчика или с SECTION_READY = false
 * отвечает «Этот раздел ещё собираю».
 */
export const SECTION_HANDLERS: Partial<Record<Section, SectionHandler>> = {
  tm: handleTeam,
};
