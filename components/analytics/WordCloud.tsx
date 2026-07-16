import { cn } from "@/lib/utils";
import type { WordFreq } from "@/lib/analytics";

// Стиль слова — по его рангу в облаке (а не по абсолютной частоте),
// чтобы при любом размере датасета был визуальный разброс, как на прототипе:
// топ — крупный serif/каплс/акцент, середина — смесь sans/serif/italic,
// низ — мелкий моноширинный приглушённый.
const MID_VARIANTS = [
  "text-ink-secondary text-[19px]",
  "font-serif italic text-ink-secondary text-[22px]",
  "font-serif font-medium text-accent text-[18px]",
  "italic text-accent text-[18px]",
];

function wordStyles(rank: number): string {
  if (rank === 0) {
    return "leading-none font-serif font-medium uppercase tracking-wide text-accent text-[28px] max-w-full break-words";
  }
  if (rank <= 2) {
    return "leading-none font-serif font-medium text-ink-primary text-[24px] max-w-full break-words";
  }
  if (rank <= 6) {
    return cn("leading-none max-w-full break-words", MID_VARIANTS[(rank - 3) % MID_VARIANTS.length]);
  }
  return "leading-none font-mono text-ink-muted text-[13px] max-w-full break-words";
}

/**
 * `highlight` — слова, пересекающиеся с целью/фокусом спринта; подсвечиваются
 * акцентом + подчёркиванием. На /analytics проп не передаётся → облако без подсветки.
 */
export function WordCloud({ words, highlight }: { words: WordFreq[]; highlight?: Set<string> }) {
  if (words.length === 0) {
    return (
      <p className="text-sm text-ink-secondary">
        Пока мало слов — поговори со мной, и здесь появится картина.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-3 overflow-hidden">
      {words.map((w, i) => (
        <span
          key={w.text}
          className={cn(
            wordStyles(i),
            highlight?.has(w.text) && "text-accent underline decoration-accent/50 underline-offset-4",
          )}
        >
          {w.text}
        </span>
      ))}
    </div>
  );
}
