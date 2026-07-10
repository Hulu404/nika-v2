import type { MoodKey } from "@/types/app";
import { cn } from "@/lib/utils";
import { MOOD_KEYS } from "@/lib/rhythm";
import { MOOD_LABELS } from "@/lib/rhythm-copy";

interface MoodChipsProps {
  selected: Set<MoodKey>;
  onToggle: (key: MoodKey) => void;
  disabled?: boolean;
}

/**
 * Канонические 12 чипов состояния. Мультивыбор: тап включает/выключает чип.
 * Это не шкала и не оценка — просто набор отметок. Один набор на всех ширинах.
 */
export function MoodChips({ selected, onToggle, disabled }: MoodChipsProps) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Состояние">
      {MOOD_KEYS.map((key) => {
        const active = selected.has(key);
        return (
          <button
            key={key}
            type="button"
            role="checkbox"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onToggle(key)}
            className={cn(
              "inline-flex min-h-[44px] items-center rounded-pill border px-4 text-[14px] transition-colors motion-reduce:transition-none disabled:opacity-50",
              active
                ? "border-accent bg-accent text-white"
                : "border-line-default bg-canvas text-ink-primary hover:border-line-strong",
            )}
          >
            {MOOD_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}
