"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClientComponentClient } from "@/lib/supabase";
import { createRun, updateRun, deleteRun, formatPace, todayStr, isFutureDate } from "@/lib/runs";
import { cn } from "@/lib/utils";
import type { RunRow } from "@/types/database";
import type { RunIntensity } from "@/types/app";

const INTENSITY: { v: RunIntensity; l: string }[] = [
  { v: "easy", l: "Легко" },
  { v: "medium", l: "Средне" },
  { v: "hard", l: "Тяжело" },
];

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

interface RunSheetProps {
  open: boolean;
  onClose: () => void;
  mode: "add" | "edit";
  userId: string;
  run?: RunRow; // обязателен при mode="edit", для префилла
  onSaved?: () => void; // по умолчанию router.refresh()
}

export function RunSheet({ open, onClose, mode, userId, run, onSaved }: RunSheetProps) {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());

  const [date, setDate] = useState(todayStr);
  const [distance, setDistance] = useState("");
  const [duration, setDuration] = useState("");
  const [durationUnit, setDurationUnit] = useState<"min" | "h">("min");
  const [intensity, setIntensity] = useState<RunIntensity>("easy");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Заполняем поля при открытии: для edit — из run, для add — пустые/сегодня.
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && run) {
      setDate(run.date);
      setDistance(String(Number(run.distance_km)));
      setDuration(String(run.duration_min)); // минуты храним как есть → unit "min"
      setDurationUnit("min");
      setIntensity(run.intensity);
      setNote(run.note ?? "");
    } else {
      setDate(todayStr());
      setDistance("");
      setDuration("");
      setDurationUnit("min");
      setIntensity("easy");
      setNote("");
    }
    setConfirmDelete(false);
    setError(null);
  }, [open, mode, run]);

  // Дистанцию принимаем через точку или запятую.
  const km = parseFloat(distance.replace(",", "."));
  // Время: число в выбранных единицах либо формат чч:мм:сс / мм:сс. В БД — минуты.
  const min = durationToMinutes(duration, durationUnit);
  // max у <input type="date"> — только подсказка браузеру, значение всё равно
  // может оказаться в будущем (ручной ввод, автозаполнение), поэтому проверяем сами.
  const futureDate = Boolean(date) && isFutureDate(date);
  const valid = Boolean(date) && !futureDate && km > 0 && min > 0;
  // Показываем живой пересчёт, когда ввод не равен «просто минутам».
  const showMinConversion = min > 0 && (durationUnit === "h" || duration.includes(":"));
  // Живой предпросмотр темпа.
  const pacePreview = km > 0 && min > 0 ? formatPace(km, min) : "—:—";

  const busy = saving || deleting;

  async function save() {
    if (!valid || busy) return;
    setSaving(true);
    setError(null);

    const patch = { date, distanceKm: km, durationMin: min, intensity, note };
    const errMsg =
      mode === "edit" && run
        ? await updateRun(supabase, run.id, patch)
        : await createRun(supabase, { userId, ...patch });

    if (errMsg) {
      console.error(`[journal] ${mode === "edit" ? "updateRun" : "createRun"} failed:`, errMsg);
      setSaving(false);
      setError("Не получилось сохранить. Попробуй ещё раз.");
      return;
    }

    setSaving(false);
    onClose();
    (onSaved ?? router.refresh)();
  }

  async function remove() {
    if (!run || busy) return;
    setDeleting(true);
    setError(null);

    const errMsg = await deleteRun(supabase, run.id);
    if (errMsg) {
      console.error("[journal] deleteRun failed:", errMsg);
      setDeleting(false);
      setError("Не получилось удалить. Попробуй ещё раз.");
      return;
    }

    setDeleting(false);
    onClose();
    (onSaved ?? router.refresh)();
  }

  if (!open) return null;

  const fieldCls =
    "w-full min-w-0 rounded-input border border-line-default bg-canvas px-3 py-2.5 text-ink-primary outline-none placeholder:text-ink-faint focus:border-ink-primary";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onClose()} />

      {/* Панель: ограничена по высоте, поля скроллятся, кнопки закреплены снизу */}
      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-3xl bg-elevated shadow-card sm:rounded-3xl">
        <div className="px-6 pt-5">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
          <h2 className="font-serif text-xl font-medium text-ink-primary">
            {mode === "edit" ? "Редактировать пробежку" : "Новая пробежка"}
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-ink-secondary">Дата</span>
              <input
                type="date"
                value={date}
                max={todayStr()}
                onChange={(e) => setDate(e.target.value)}
                aria-invalid={futureDate}
                className={cn(fieldCls, futureDate && "border-accent focus:border-accent")}
              />
              {futureDate && (
                <span className="text-[11px] leading-snug text-accent">
                  Дата в будущем — пробежку можно записать только за сегодня или раньше.
                </span>
              )}
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
              <p className="text-[11px] leading-snug text-ink-faint">
                Темп {pacePreview} /км · считается сам
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

            {mode === "edit" && !confirmDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className="self-start text-sm font-medium text-accent transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                Удалить пробежку
              </button>
            )}

            {mode === "edit" && confirmDelete && (
              <div className="flex flex-col gap-2 rounded-input border border-line-default bg-canvas px-3 py-3">
                <p className="text-sm text-ink-primary">Удалить эту пробежку? Отменить нельзя.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={busy}
                    className="h-9 flex-1 rounded-pill border border-line-default text-sm font-medium text-ink-primary transition-colors hover:bg-surface-nika disabled:opacity-50"
                  >
                    Оставить
                  </button>
                  <button
                    type="button"
                    onClick={remove}
                    disabled={busy}
                    className="h-9 flex-1 rounded-pill bg-accent text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {deleting ? "Удаляем…" : "Удалить"}
                  </button>
                </div>
              </div>
            )}

            {error && <p className="text-center text-sm text-accent">{error}</p>}
          </div>
        </div>

        <div className="flex gap-3 border-t border-line-subtle px-6 py-4">
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="h-11 flex-1 rounded-pill border border-line-default text-[15px] font-medium text-ink-primary transition-colors hover:bg-surface-nika"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!valid || busy}
            className="h-11 flex-[1.5] rounded-pill bg-accent text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
