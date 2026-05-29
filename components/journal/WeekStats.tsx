export function WeekStats({
  count,
  km,
  duration,
}: {
  count: number;
  km: string;
  duration: string;
}) {
  const stats = [
    { value: String(count), label: "пробежки" },
    { value: km, label: "км" },
    { value: duration, label: "время" },
  ];
  return (
    <div className="grid grid-cols-3 gap-3 rounded-2xl bg-surface-deep p-4 lg:flex lg:gap-8 lg:rounded-none lg:bg-transparent lg:p-0">
      {stats.map((s) => (
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
