"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MoodKey } from "@/types/app";
import { createClientComponentClient } from "@/lib/supabase";
import {
  deleteAllRhythmData,
  exportRhythmData,
  saveRhythmConsent,
  upsertDailyState,
  userToday,
} from "@/lib/rhythm";
import { enqueueDailyState, flushOutbox } from "@/lib/rhythm-outbox";
import { resolveBucket } from "@/lib/rhythm/buckets";
import { bucketReply } from "@/lib/rhythm/replies";
import { rhythmAnalytics } from "@/lib/rhythm/analytics";
import { WeekStrip } from "@/components/rhythm/WeekStrip";
import { MonthCalendar } from "@/components/rhythm/MonthCalendar";
import { TodayPanel } from "@/components/rhythm/TodayPanel";
import { CheckinCta } from "@/components/rhythm/CheckinCta";
import { CheckinScreen } from "@/components/rhythm/CheckinScreen";
import { CheckinCard } from "@/components/rhythm/CheckinCard";
import { ConsentSheet } from "@/components/rhythm/ConsentSheet";
import { RhythmSettings } from "@/components/rhythm/RhythmSettings";
import { RedsNotice } from "@/components/rhythm/RedsNotice";

/** Лёгкая проекция строки daily_state для клиента. */
export interface RhythmDay {
  date: string;
  moods: MoodKey[];
}

interface RhythmScreenProps {
  userId: string;
  /** Дата сервера (YYYY-MM-DD) — стартовое значение до гидрации, чтобы SSR и
   *  первый клиентский рендер совпали; после монтирования уточняем по клиенту. */
  serverToday: string;
  days: RhythmDay[];
  periodDates: string[];
  hasConsent: boolean;
  /** Факт пропуска (ran=false после известной паузы) — приоритетный бакет. */
  skip: boolean;
  /** Кандидат на разовую заглушку RED-S (сервер уже проверил флаг и сигналы). */
  redsNotice?: boolean;
  /** Формулировка RED-S (конфиг). */
  redsMessage?: string;
}

const DISCUSS_HREF = "/chat/general?new=1";

export function RhythmScreen({
  userId,
  serverToday,
  days,
  periodDates,
  hasConsent,
  skip,
  redsNotice = false,
  redsMessage,
}: RhythmScreenProps) {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());

  // Дата пользователя может отличаться от серверной таймзоны. Стартуем с
  // серверной (совпадает с SSR), после монтирования пересчитываем по клиенту.
  const [today, setToday] = useState(serverToday);
  useEffect(() => {
    const t = userToday();
    if (t !== today) setToday(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markedDates = useMemo(() => new Set(days.map((d) => d.date)), [days]);
  const periodSet = useMemo(() => new Set(periodDates), [periodDates]);

  const todayMoods = useMemo<MoodKey[]>(
    () => days.find((d) => d.date === today)?.moods ?? [],
    [days, today],
  );
  // Реплики берём из ПЕРСИСТНОГО состояния дня (бакет). Меняются после сохранения
  // + router.refresh(), а не по ходу выбора чипов.
  const bucket = useMemo(() => resolveBucket(todayMoods, { skip }), [todayMoods, skip]);
  const reply = useMemo(() => bucketReply(bucket), [bucket]);

  // Аналитика (без сырого состояния): открытие раздела и показ карточки Ники.
  useEffect(() => {
    rhythmAnalytics.opened();
  }, []);

  // Офлайн-синк (§8.5): сливаем отложенные отметки при заходе и когда вернулась
  // сеть. После успешной доставки перечитываем страницу — реплики обновятся.
  useEffect(() => {
    let cancelled = false;
    const flush = async () => {
      if (!navigator.onLine) return;
      const delivered = await flushOutbox(supabase, userId);
      if (delivered > 0 && !cancelled) router.refresh();
    };
    void flush();
    window.addEventListener("online", flush);
    return () => {
      cancelled = true;
      window.removeEventListener("online", flush);
    };
  }, [supabase, userId, router]);
  useEffect(() => {
    rhythmAnalytics.nikaCardShown(bucket);
  }, [bucket]);

  // ── Чек-ин ──────────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<MoodKey>>(() => new Set(todayMoods));
  const [checkinOpen, setCheckinOpen] = useState(false); // мобильный экран
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentGranted, setConsentGranted] = useState(hasConsent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback((key: MoodKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Пишет отметки за сегодня. При офлайн-ошибке кладёт в outbox для синка позже.
  const persist = useCallback(async () => {
    setSaving(true);
    setError(null);
    const moods = [...selected];
    const err = await upsertDailyState(supabase, { userId, date: today, moods });
    setSaving(false);
    if (err) {
      enqueueDailyState({ date: today, moods });
      setError("Не получилось сохранить сейчас — отметки сохранятся, когда появится сеть.");
      return;
    }
    rhythmAnalytics.checkinCompleted(moods, resolveBucket(moods, { skip }));
    setCheckinOpen(false);
    router.refresh(); // сервер пересчитает реплики по новому состоянию
  }, [selected, supabase, userId, today, skip, router]);

  // «Сохранить»: без согласия сперва показываем лист согласия, потом пишем.
  const handleSave = useCallback(() => {
    if (!consentGranted) {
      setConsentOpen(true);
      return;
    }
    void persist();
  }, [consentGranted, persist]);

  const acceptConsent = useCallback(async () => {
    setSaving(true);
    const err = await saveRhythmConsent(supabase, userId);
    if (err) {
      setSaving(false);
      setError("Не получилось сохранить согласие. Попробуй ещё раз.");
      return;
    }
    rhythmAnalytics.consent(true);
    setConsentGranted(true);
    setConsentOpen(false);
    setSaving(false);
    void persist();
  }, [supabase, userId, persist]);

  const dismissConsent = useCallback(() => {
    rhythmAnalytics.consent(false);
    setConsentOpen(false);
  }, []);

  const handleDiscuss = useCallback(() => {
    rhythmAnalytics.discussInChatClicked(bucket);
  }, [bucket]);

  // ── Приватность: экспорт JSON и полное удаление ──────────────────────────────
  const handleExport = useCallback(async (): Promise<string | null> => {
    try {
      const data = await exportRhythmData(supabase, userId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nika-rhythm-${today}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Не удалось выгрузить данные.";
    }
  }, [supabase, userId, today]);

  const handleDelete = useCallback(async (): Promise<string | null> => {
    const err = await deleteAllRhythmData(supabase, userId);
    if (err) return err;
    rhythmAnalytics.dataDeleted();
    // Возврат в состояние «первый вход»: сбрасываем выбор и согласие локально,
    // сервер перечитает пустые данные и отсутствие consent.
    setSelected(new Set());
    setConsentGranted(false);
    router.refresh();
    return null;
  }, [supabase, userId, router]);

  return (
    <div className="flex-1 overflow-y-auto pb-tabbar lg:pb-10">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6 px-6 py-8 xl:flex-row xl:items-start xl:gap-10 xl:py-12">
        {/* Центр: герой (короткая реплика бакета), календарь (десктоп) / неделя (мобайл) */}
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <section className="rounded-card border border-line-default bg-surface-warm p-7 lg:p-9">
            <span className="mb-5 block h-12 w-12 rounded-full bg-nika-avatar shadow-card" aria-hidden />
            <h1 className="font-serif text-[28px] font-normal leading-tight tracking-[-0.02em] text-ink-primary lg:text-[34px]">
              {reply.short}
            </h1>
          </section>

          {/* Разовая мягкая заглушка RED-S (по умолчанию выключена флагом) */}
          {redsNotice && redsMessage && <RedsNotice message={redsMessage} />}

          <WeekStrip today={today} markedDates={markedDates} periodDates={periodSet} className="xl:hidden" />
          <MonthCalendar today={today} markedDates={markedDates} periodDates={periodSet} className="hidden xl:block" />

          {/* Мобайл: панель «сегодня» + CTA открывает отдельный экран чек-ина */}
          <div className="flex flex-col gap-6 xl:hidden">
            <TodayPanel message={reply.short} discussHref={DISCUSS_HREF} onDiscuss={handleDiscuss} />
            <CheckinCta onOpen={() => setCheckinOpen(true)} />
          </div>

          {/* Настройки раздела: дисклеймер, экспорт, удаление */}
          <RhythmSettings onExport={handleExport} onDelete={handleDelete} />
        </div>

        {/* Десктоп: правый рейл — «сегодня» + карточка чек-ина */}
        <aside className="hidden w-[340px] flex-shrink-0 flex-col gap-6 xl:flex">
          <TodayPanel message={reply.short} discussHref={DISCUSS_HREF} onDiscuss={handleDiscuss} />
          <CheckinCard selected={selected} onToggle={toggle} onSave={handleSave} saving={saving} error={error} />
        </aside>
      </div>

      {/* Мобильный экран чек-ина */}
      {checkinOpen && (
        <CheckinScreen
          selected={selected}
          onToggle={toggle}
          onSave={handleSave}
          onClose={() => setCheckinOpen(false)}
          saving={saving}
          error={error}
        />
      )}

      {/* Лист согласия перед первой записью */}
      {consentOpen && (
        <ConsentSheet onAccept={acceptConsent} onDismiss={dismissConsent} busy={saving} />
      )}
    </div>
  );
}
