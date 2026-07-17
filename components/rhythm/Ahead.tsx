"use client";

import { addDays, fmtDateRu, getPhase, PHASE_META, type Phase } from "@/lib/rhythm/cycles";
import { cn } from "@/lib/utils";

interface AheadProps {
  latestCycleStartedAt: string;
  cycleDay: number;
  cycleLen: number;
  phase: Phase;
}

interface TlItem {
  title: string;
  pill: string;
  text: string;
  current: boolean;
}

export function Ahead({ latestCycleStartedAt, cycleDay, cycleLen, phase }: AheadProps) {
  const meta = PHASE_META[phase];
  const daysRemaining = cycleLen - cycleDay;

  // Конец текущей фазы
  const currentEnd = `дни с ${cycleDay} по ${cycleLen}`;

  // Следующие месячные: начало следующего цикла
  const nextPeriodDate = addDays(latestCycleStartedAt, cycleLen);
  const nextPeriodStr = `≈ ${fmtDateRu(nextPeriodDate)}`;

  // Следующее окно энергии: день 6 следующего цикла
  const nextEnergyDate = addDays(nextPeriodDate, 5);
  const nextEnergyEndDate = addDays(nextPeriodDate, 13);
  const nextEnergyStr = `≈ ${fmtDateRu(nextEnergyDate)}`;

  // Формируем items (не показываем месячные/energy если они уже прошли)
  const items: TlItem[] = [
    {
      title: `${currentEnd} · ${meta.labelRu.toLowerCase()}`,
      pill: "сейчас",
      text: meta.aheadText,
      current: true,
    },
  ];

  if (daysRemaining <= 14) {
    // Близко к концу цикла — показываем следующие месячные
    items.push({
      title: "Месячные",
      pill: nextPeriodStr,
      text: PHASE_META.menses.aheadText,
      current: false,
    });
    items.push({
      title: `Дни с 6 по 13 · окно энергии`,
      pill: nextEnergyStr,
      text: PHASE_META.rise.aheadText,
      current: false,
    });
  } else {
    // Ещё далеко — показываем общий прогноз
    const peakDay = cycleLen - 14;
    if (cycleDay < peakDay - 1) {
      // До пика ещё есть фаза подъёма
      const peakDate = addDays(latestCycleStartedAt, peakDay - 1);
      items.push({
        title: `Дни ${peakDay} и ${peakDay + 1} · пик`,
        pill: `≈ ${fmtDateRu(peakDate)}`,
        text: PHASE_META.peak.aheadText,
        current: false,
      });
    }
    items.push({
      title: "Месячные",
      pill: nextPeriodStr,
      text: PHASE_META.menses.aheadText,
      current: false,
    });
  }

  void nextEnergyEndDate; // for future use

  return (
    <div className="relative pl-6">
      {/* Вертикальная линия */}
      <div className="absolute left-2 top-1.5 bottom-1.5 w-0.5 bg-line-default" />

      {items.map((item, i) => (
        <div key={i} className={cn("relative mb-4 last:mb-0")}>
          {/* Точка */}
          <span
            className={cn(
              "absolute -left-6 top-0.5 h-4 w-4 rounded-full border-2",
              item.current
                ? "border-accent bg-accent shadow-[0_0_0_4px_rgba(200,85,61,0.16)]"
                : "border-dashed border-line-strong bg-transparent",
            )}
          />

          {/* Заголовок + пилюля */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-ink-primary">{item.title}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[9.5px] font-medium tracking-[0.02em]",
                item.current ? "bg-accent text-white" : "bg-surface-nika text-ink-muted",
              )}
            >
              {item.pill}
            </span>
          </div>

          {/* Карточка */}
          <div className="rounded-[14px] border border-line-subtle bg-elevated p-3.5">
            <p className="text-[12.5px] leading-[1.55] text-ink-secondary">{item.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
