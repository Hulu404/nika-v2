import Link from "next/link";
import { formatPace } from "@/lib/runs";
import type { RunRow } from "@/types/database";
import type { RunIntensity } from "@/types/app";

const INTENSITY: Record<RunIntensity, string> = { easy: "легко", medium: "средне", hard: "тяжело" };
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function Cap({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
      <svg width="13" height="13" viewBox="0 0 18 18" fill="none" aria-hidden className="text-accent">
        <path d="M11 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" stroke="currentColor" strokeWidth="1.4" />
        <path d="M6 16l2-5 3 1 1-3 3 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </div>
  );
}

export function LastRunCard({ run }: { run: RunRow | null }) {
  return (
    <div className="col-span-2 rounded-2xl border border-line-subtle bg-elevated p-[18px]">
      <Cap>Последняя пробежка</Cap>

      {run ? (
        <Link href="/journal" className="mt-3 flex items-start gap-3.5 text-left transition-opacity hover:opacity-80">
          {(() => {
            const [y, m, d] = run.date.split("-").map(Number);
            const dist = Number(run.distance_km);
            return (
              <>
                {/* Дата */}
                <div className="w-[42px] flex-shrink-0 text-center">
                  <div className="font-serif text-[24px] font-medium leading-none tracking-[-0.02em] text-ink-primary">{d}</div>
                  <div className="mt-1.5 text-[9.5px] font-medium uppercase tracking-[0.1em] text-ink-muted">
                    {MONTHS[m - 1]}{" "}{y !== new Date().getFullYear() ? y : ""}
                  </div>
                </div>
                {/* Инфо */}
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-[14px] font-medium text-ink-primary">
                    {dist} км · {run.duration_min} мин · {INTENSITY[run.intensity]}
                  </div>
                  {run.note && (
                    <div className="font-serif text-[13px] italic leading-[1.4] text-ink-muted">
                      «{run.note}»
                    </div>
                  )}
                </div>
                {/* Темп */}
                <div className="flex-shrink-0 self-center text-right font-mono text-[11px] text-ink-secondary">
                  {formatPace(dist, run.duration_min)}
                  <br />
                  <small className="text-ink-muted">/км</small>
                </div>
              </>
            );
          })()}
        </Link>
      ) : (
        <p className="mt-3 text-[13px] text-ink-secondary">
          Пока нет пробежек. Добавь первую в{" "}
          <Link href="/journal" className="text-accent hover:underline">журнале</Link>.
        </p>
      )}
    </div>
  );
}
