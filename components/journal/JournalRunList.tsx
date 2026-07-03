"use client";

import { Fragment, useState } from "react";
import { RunCard } from "./RunCard";
import { RunSheet } from "./RunSheet";
import { buildRunViews } from "@/lib/runs";
import type { RunRow } from "@/types/database";

const MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

export function JournalRunList({ rows, userId }: { rows: RunRow[]; userId: string }) {
  const [editing, setEditing] = useState<RunRow | null>(null);
  const views = buildRunViews(rows);

  if (views.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line-default px-5 py-10 text-center">
        <p className="font-serif text-[17px] text-ink-primary">Пока нет пробежек</p>
        <p className="mt-1 text-sm text-ink-secondary">Добавь первую — и она появится здесь.</p>
      </div>
    );
  }

  const [y, m] = rows[0].date.split("-").map(Number);
  const monthLabel = `${MONTHS[m - 1]} · ${y}`;

  return (
    <>
      <p className="mb-2 text-xs uppercase tracking-wider text-ink-secondary">{monthLabel}</p>
      <div className="flex flex-col gap-2.5">
        {views.map((run) => (
          <Fragment key={run.id}>
            {run.gapBefore && (
              <div className="rounded-lg bg-surface-deep py-2 text-center text-xs text-ink-secondary">
                — {run.gapBefore} —
              </div>
            )}
            <RunCard run={run} onClick={() => setEditing(rows.find((r) => r.id === run.id) ?? null)} />
          </Fragment>
        ))}
      </div>

      <RunSheet
        open={!!editing}
        onClose={() => setEditing(null)}
        mode="edit"
        userId={userId}
        run={editing ?? undefined}
      />
    </>
  );
}
