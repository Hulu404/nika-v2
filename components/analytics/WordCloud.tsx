import { cn } from "@/lib/utils";
import type { WordFreq } from "@/lib/analytics";

// Размер/цвет/начертание выводятся из частоты относительно максимума,
// чтобы облако адаптировалось к объёму данных конкретного пользователя.
function ratioStyles(ratio: number) {
  const size = ratio >= 0.8 ? "text-3xl" : ratio >= 0.6 ? "text-2xl" : ratio >= 0.4 ? "text-xl" : ratio >= 0.2 ? "text-base" : "text-sm";
  const color = ratio >= 0.6 ? "text-accent" : ratio >= 0.3 ? "text-ink-primary" : "text-ink-secondary";
  const weight = ratio >= 0.6 ? "font-bold" : "font-normal";
  return cn("leading-none", size, color, weight);
}

export function WordCloud({ words }: { words: WordFreq[] }) {
  if (words.length === 0) {
    return <p className="text-sm text-ink-secondary">Пока мало слов — поговори со мной, и здесь появится картина.</p>;
  }
  const max = words[0].freq;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
      {words.map((w) => (
        <span key={w.text} className={ratioStyles(w.freq / max)}>
          {w.text}
        </span>
      ))}
    </div>
  );
}
