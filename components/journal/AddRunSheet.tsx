"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClientComponentClient } from "@/lib/supabase";
import { createRun } from "@/lib/runs";
import { cn } from "@/lib/utils";
import type { RunIntensity } from "@/types/app";

const INTENSITY: { v: RunIntensity; l: string }[] = [
  { v: "easy", l: "Легко" },
  { v: "medium", l: "Средне" },
  { v: "hard", l: "Тяжело" },
];

function todayStr() {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD в локальном времени
}

export function AddRunSheet({ userId }: { userId: string }) {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayStr);
  const [distance, setDistance] = useState("");
  const [duration, setDuration] = useState("");
  const [intensity, setIntensity] = useState<RunIntensity>("easy");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const km = parseFloat(distance.replace(",", "."));
  const min = parseInt(duration, 10);
  const valid = date && km > 0 && min > 0;

  function reset() {
    setDate(todayStr());
    setDistance("");
    setDuration("");
    setIntensity("easy");
    setNote("");
    setError(null);
  }

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);

    const errMsg = await createRun(supabase, {
      userId,
      date,
      distanceKm: km,
      durationMin: min,
      intensity,
      note,
    });

    if (errMsg) {
      console.error("[journal] createRun failed:", errMsg);
      setSaving(false);
      setError("Не получилось сохранить. Попробуй ещё раз.");
      return;
    }

    setSaving(false);
    setOpen(false);
    reset();
    router.refresh();
  }

  const fieldCls =
    "w-full min-w-0 rounded-input border border-line-default bg-canvas px-3 py-2.5 text-ink-primary outline-none placeholder:text-ink-faint focus:border-ink-primary";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-pill bg-ink-primary text-[15px] font-medium text-canvas transition-colors hover:bg-accent"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        Добавить пробежку
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal>
          <div className="absolute inset-0 bg-black/40" onClick={() => !saving && setOpen(false)} />

          {/* Панель: ограничена по высоте, поля скроллятся, кнопки закреплены снизу */}
          <div className="relative z-10 flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-3xl bg-elevated shadow-card sm:rounded-3xl">
            <div className="px-6 pt-5">
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
              <h2 className="font-serif text-xl font-medium text-ink-primary">Новая пробежка</h2>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs uppercase tracking-wide text-ink-secondary">Дата</span>
                  <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} className={fieldCls} />
                </label>

                <div className="flex gap-3">
                  <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="text-xs uppercase tracking-wide text-ink-secondary">Дистанция, км</span>
                    <input type="number" inputMode="decimal" step="0.1" min="0" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="4.2" className={fieldCls} />
                  </label>
                  <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="text-xs uppercase tracking-wide text-ink-secondary">Время, мин</span>
                    <input type="number" inputMode="numeric" min="0" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="28" className={fieldCls} />
                  </label>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs uppercase tracking-wide text-ink-secondary">Как далось</span>
                  <div className="flex gap-2">
                    {INTENSITY.map((o) => (
                      <button
                        key={o.v}
                        type="button"
                        onClick={() => setIntensity(o.v)}
                        className={cn(
                          "flex-1 rounded-pill border px-3 py-2 text-sm transition-colors",
                          intensity === o.v
                            ? "border-ink-primary bg-ink-primary text-canvas"
                            : "border-line-default text-ink-primary hover:border-line-strong",
                        )}
                      >
                        {o.l}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs uppercase tracking-wide text-ink-secondary">Заметка</span>
                  <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Как прошло? (необязательно)" className={fieldCls} />
                </label>

                {error && <p className="text-center text-sm text-accent">{error}</p>}
              </div>
            </div>

            <div className="flex gap-3 border-t border-line-subtle px-6 py-4">
              <button
                type="button"
                onClick={() => !saving && setOpen(false)}
                className="h-11 flex-1 rounded-pill border border-line-default text-[15px] font-medium text-ink-primary transition-colors hover:bg-surface-nika"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!valid || saving}
                className="h-11 flex-[1.5] rounded-pill bg-accent text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Сохраняем…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
