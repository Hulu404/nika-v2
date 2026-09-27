import { cb } from "../callback";
import { canOpenSection } from "../access";
import { SECTION_READY } from "../sections";
import { kbArticle, searchKb } from "../sections/kb";
import type { SectionRequest } from "../section";
import type { Screen } from "../types";

/**
 * ВРЕМЕННЫЙ маршрутизатор текста — до полного разбора вопроса в Промте 14,
 * который заменит этот файл целиком.
 *
 * Сейчас текст (не команда и не ответ формы) ищется только в справочнике,
 * среди статей зоны человека:
 *   • одна статья — показать её;
 *   • две или три — «Уточни:» и кнопки;
 *   • ни одной или больше трёх — null: конвейер ответит «Не поняла вопрос».
 */
export interface InterimResult {
  screens: Screen[];
  /** Если показали статью — её slug для журнала (report kb.article). */
  slug: string | null;
}

const MAX_CLARIFY = 3;

export async function interimTextRoute(req: SectionRequest, text: string): Promise<InterimResult | null> {
  if (!SECTION_READY.kb || !canOpenSection(req.subject, "kb")) return null;
  const found = await searchKb(req.subject, text);
  if (found.length === 1) {
    const screen = await kbArticle(req, found[0].slug);
    if (!screen || screen === "forbidden") return null;
    return { screens: [screen], slug: found[0].slug };
  }
  if (found.length >= 2 && found.length <= MAX_CLARIFY) {
    return {
      screens: [
        {
          text: "Уточни:",
          buttons: found.map((a) => [{ text: a.title, data: cb("kb", "art", a.slug) }]),
        },
      ],
      slug: null,
    };
  }
  return null;
}
