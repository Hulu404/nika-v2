const STATS = [
  { value: "3", label: "пробежки" },
  { value: "12.4", label: "км" },
  { value: "1ч 18м", label: "время" },
];

/**
 * Статистика недели. Адаптив: на мобильном — единый скруглённый блок с тремя
 * колонками; на десктопе — три статы в строку без фона.
 */
export function WeekStats() {
  return (
    <div className="grid grid-cols-3 gap-3 rounded-2xl bg-surface-deep p-4 lg:flex lg:gap-8 lg:rounded-none lg:bg-transparent lg:p-0">
      {STATS.map((s) => (
        <div key={s.label} className="text-center lg:text-left">
          <div className="text-[28px] font-bold leading-none text-ink-primary lg:text-4xl">
            {s.value}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-widest text-ink-secondary lg:text-xs">
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}
