import { cn } from "@/lib/utils";
import type { WordFreq } from "@/lib/analytics";

// Размер, шрифт и цвет слова выводятся из относительной частоты.
function wordStyles(ratio: number): string {
  if (ratio >= 0.7) {
    // Самые частые: крупный serif, ink-primary
    return cn("font-serif font-medium text-ink-primary leading-none", "text-[30px]");
  }
  if (ratio >= 0.4) {
    // Средние: sans, ink-secondary
    return cn("text-ink-secondary leading-none", "text-[19px]");
  }
  // Редкие: mono, ink-muted, маленький
  return cn("font-mono text-ink-muted leading-none", "text-[13px]");
}

export function WordCloud({ words }: { words: WordFreq[] }) {
  if (words.length === 0) {
    return (
      <p className="text-sm text-ink-secondary">
        Пока мало слов — поговори со мной, и здесь появится картина.
      </p>
    );
  }
  const max = words[0].freq;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-3">
      {words.map((w) => (
        <span key={w.text} className={wordStyles(w.freq / max)}>
          {w.text}
        </span>
      ))}
    </div>
  );
}
