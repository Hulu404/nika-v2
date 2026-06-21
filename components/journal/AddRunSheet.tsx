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

/**
 * Переводит ввод длительности в минуты (в БД храним duration_min).
 * Поддерживает:
 *  - число в выбранных единицах: "28" (мин) или "1,5" (ч);
 *  - формат с двоеточием: "чч:мм:сс"; двухкомпонентный разбирается по
 *    выбранной единице — "ч" → "чч:мм", "мин" → "мм:сс" (секунды округляются).
 * Возвращает NaN, если ввод пустой/некорректный.
 */
function durationToMinutes(raw: string, unit: "min" | "h"): number {
  const s = raw.trim();
  if (!s) return NaN;

  if (s.includes(":")) {
    const parts = s.split(":");
    if (parts.length < 2 || parts.length > 3) return NaN;
    if (parts.some((p) => p.trim() === "")) return NaN;
    const nums = parts.map((p) => Number(p));
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return NaN;
    const [h, m, sec] =
      parts.length === 3
        ? nums
        : unit === "h"
          ? [nums[0], nums[1], 0] // чч:мм
          : [0, nums[0], nums[1]]; // мм:сс
    return Math.round(h * 60 + m + sec / 60);
  }

  const n = parseFloat(s.replace(",", "."));
  if (!Number.isFinite(n)) return NaN;
  return unit === "h" ? Math.round(n * 60) : Math.round(n);
}

export function AddRunSheet({ userId }: { userId: string }) {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayStr);
  const [distance, setDistance] = useState("");
  const [duration, setDuration] = useState("");
  const [durationUnit, setDurationUnit] = useState<"min" | "h">("min");
  const [intensity, setIntensity] = useState<RunIntensity>("easy");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Дистанцию принимаем через точку или запятую.
  const km = parseFloat(distance.replace(",", "."));
  // Время: число в выбранных единицах либо формат чч:мм:сс / мм:сс. В БД — минуты.
  const min = durationToMinutes(duration, durationUnit);
  const valid = Boolean(date) && km > 0 && min > 0;
  // Показываем живой пересчёт, когда ввод не равен «просто минутам».
  const showMinConversion = min > 0 && (durationUnit === "h" || duration.includes(":"));

  function reset() {
    setDate(todayStr());
    setDistance("");
    setDuration("");
    setDurationUnit("min");
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

                <div className="flex flex-col gap-1.5">
                  <div className="flex gap-3">
                    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="flex h-7 items-center text-xs uppercase tracking-wide text-ink-secondary">Дистанция, км</span>
                      <input type="text" inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="4.2 или 4,2" className={fieldCls} />
                    </label>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex h-7 items-center justify-between gap-2">
                        <span className="text-xs uppercase tracking-wide text-ink-secondary">Время</span>
                        <div className="flex rounded-pill border border-line-default p-[2px]">
                          {(["min", "h"] as const).map((u) => (
                            <button
                              key={u}
                              type="button"
                              onClick={() => setDurationUnit(u)}
                              className={cn(
                                "rounded-pill px-2 py-[3px] text-[11px] font-medium transition-colors",
                                durationUnit === u ? "bg-ink-primary text-canvas" : "text-ink-secondary",
                              )}
                            >
                              {u === "min" ? "мин" : "ч"}
                            </button>
                          ))}
                        </div>
                      </div>
                      <input
                        type="text"
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        placeholder={durationUnit === "min" ? "28 или 28:30" : "1,5 или 1:30"}
                        className={fieldCls}
                      />
                    </div>
                  </div>
                  <p className="text-[11px] leading-snug text-ink-faint">
                    Точка или запятая. Время — минуты, часы (1,5) или чч:мм:сс.
                    {showMinConversion ? ` Это ${min} мин.` : ""}
                  </p>
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
