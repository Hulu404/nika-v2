"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClientComponentClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { requestNotifPermission } from "@/lib/notifications";
import { subscribeToPush, unsubscribeFromPush } from "@/lib/push-subscribe";
import type { Gender, NotifPermission } from "@/types/app";
import { BottomSheet } from "@/components/BottomSheet";
import { PlanBadge } from "@/components/PlanBadge";
import { PrivacyContent } from "@/components/legal/PrivacyContent";
import { OfertaContent } from "@/components/legal/OfertaContent";

// ─── типы ────────────────────────────────────────────────────────────────────

type NotifFrequency = "daily" | "every_other_day" | "weekdays" | "weekly" | "biweekly" | "monthly";
type SheetId =
  | "when" | "name" | "gender" | "morning" | "pause"
  | "export" | "delete" | "how" | "manifesto" | "support" | "terms"
  | "privacy" | "oferta"
  | null;

// ─── константы ───────────────────────────────────────────────────────────────

const FREQUENCY_OPTIONS: { v: NotifFrequency; label: string }[] = [
  { v: "daily",           label: "Каждый день" },
  { v: "every_other_day", label: "Через день" },
  { v: "weekdays",        label: "По будням" },
  { v: "weekly",          label: "Раз в неделю" },
  { v: "biweekly",        label: "Раз в две недели" },
  { v: "monthly",         label: "Раз в месяц" },
];

// Род определяет и обращение НИКИ, и видимость раздела «Мой ритм» (showRhythm).
const GENDER_OPTIONS: { v: Gender; short: string; full: string; desc: string }[] = [
  { v: "female",  short: "она",       full: "Она / её",  desc: "«молодец, что вышла»" },
  { v: "male",    short: "он",        full: "Он / его",  desc: "«молодец, что вышел»" },
  { v: "neutral", short: "без рода",  full: "Без рода",  desc: "Без согласования по роду" },
];

/**
 * Приглушённый текст на инвертированной карточке подписки (bg-ink-primary).
 * Через color-mix — переворачивается по теме. Модификатор text-canvas/60 тут не
 * работает: цвет canvas задан как цельная CSS-переменная без alpha-канала.
 */
const MUTED_ON_INVERTED = {
  color: "color-mix(in srgb, var(--bg-primary) 68%, var(--ink-primary))",
} as const;

// ─── Skeleton UI ──────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-muted">
      {children}
    </p>
  );
}

interface RowProps {
  label: string;
  value?: string;
  badge?: string;
  red?: boolean;
  disabled?: boolean;
  tag?: string;
  onClick?: () => void;
  href?: string;
  rightEl?: React.ReactNode;
}

function Row({ label, value, badge, red, disabled, tag, onClick, href, rightEl }: RowProps) {
  const showChevron = (!!onClick || !!href) && !disabled && !rightEl;

  const inner = (
    <div className={cn("flex min-h-[52px] items-center gap-2.5 px-4 py-[13px]", disabled && "opacity-45")}>
      <span className={cn("flex-1 text-[15px] leading-snug", red ? "text-accent" : "text-ink-primary")}>
        {label}
      </span>
      {tag && (
        <span className="rounded-pill bg-surface-deep px-2.5 py-[3px] font-mono text-[9px] font-bold uppercase tracking-widest text-ink-muted">
          {tag}
        </span>
      )}
      {badge && (
        <span className="text-[13px] text-ink-muted">{badge}</span>
      )}
      {value && (
        <span className="max-w-[140px] truncate text-right text-[13px] text-ink-muted">{value}</span>
      )}
      {rightEl}
      {showChevron && (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="flex-shrink-0 text-ink-faint">
          <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );

  if (disabled) return inner;

  if (href) {
    return (
      <Link href={href} className="block transition-colors hover:bg-surface-warm active:bg-surface-deep">
        {inner}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button onClick={onClick} className="w-full text-left transition-colors hover:bg-surface-warm active:bg-surface-deep">
        {inner}
      </button>
    );
  }

  return inner;
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-7 w-[50px] flex-shrink-0 rounded-pill transition-colors duration-200",
        on ? "bg-accent" : "bg-line-default",
      )}
    >
      <span className={cn(
        "absolute left-0 top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-soft transition-transform duration-200",
        on ? "translate-x-[25px]" : "translate-x-[3px]",
      )} />
    </button>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      "overflow-hidden rounded-card border border-line-default bg-elevated divide-y divide-line-subtle",
      className,
    )}>
      {children}
    </div>
  );
}

// ─── Pluraliser ───────────────────────────────────────────────────────────────

function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "дней";
  if (mod10 === 1) return "день";
  if (mod10 >= 2 && mod10 <= 4) return "дня";
  return "дней";
}

function formatTimeLeft(ms: number): string {
  const totalMin = Math.ceil(ms / 60_000);
  if (totalMin < 60) return `${totalMin} мин`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  userId: string;
  initialName: string;
  email: string;
  isPro: boolean;
  reminderEnabled: boolean;
  initialGender: Gender | null;
  initialProactive: boolean;
  initialNotifTime: string;
  initialNotifFrequency: string;
  initialTelegramLinked: boolean;
  initialTelegramBlocked: boolean;
  initialTelegramAllowed: boolean;
  initialQuietMode: boolean;
  initialMorningEnabled: boolean;
  initialMorningTime: string;
  initialPauseUntil: string | null;
  createdAt: string;
}

// ─── Основной компонент ───────────────────────────────────────────────────────

export function ProfileContent({
  userId,
  initialName,
  email,
  isPro,
  reminderEnabled,
  initialGender,
  initialProactive,
  initialNotifTime,
  initialNotifFrequency,
  initialTelegramLinked,
  initialTelegramBlocked,
  initialTelegramAllowed,
  initialQuietMode,
  initialMorningEnabled,
  initialMorningTime,
  initialPauseUntil,
  createdAt,
}: Props) {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());

  // Preferences
  const [gender, setGender]           = useState<Gender | null>(initialGender);
  const [genderSaving, setGenderSaving] = useState(false);
  const [notifOn, setNotifOn]         = useState(initialProactive);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifTime, setNotifTime]     = useState(initialNotifTime);
  const [notifFrequency, setNotifFrequency] = useState<NotifFrequency>(
    (initialNotifFrequency as NotifFrequency) ?? "daily",
  );
  const [notifSettingsSaving, setNotifSettingsSaving] = useState(false);
  const [dark, setDark]               = useState(false);

  // Telegram-связка
  const [telegramLinked, setTelegramLinked] = useState(initialTelegramLinked);
  const [telegramBusy, setTelegramBusy]     = useState(false);
  const telegramBlocked = initialTelegramBlocked && !telegramLinked;

  // Тихий режим
  const [quietMode, setQuietMode] = useState(initialQuietMode);
  const [quietSaving, setQuietSaving] = useState(false);

  // Утренние сообщения (notification_prefs.morning_*)
  const [morningEnabled, setMorningEnabled] = useState(initialMorningEnabled);
  const [morningTime, setMorningTime]       = useState(initialMorningTime);
  const [pauseUntil, setPauseUntil]         = useState<string | null>(initialPauseUntil);
  const [morningBusy, setMorningBusy]       = useState(false);

  // Name editing
  const [name, setName]         = useState(initialName);
  const [editName, setEditName] = useState(initialName);
  const [nameSaving, setNameSaving] = useState(false);

  // Active sheet
  const [activeSheet, setActiveSheet] = useState<SheetId>(null);
  const closeSheet = useCallback(() => setActiveSheet(null), []);

  // Days counter
  const daysWithNika = Math.max(1, Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24),
  ));

  // Промокод (ручной ввод)
  const [promoInput, setPromoInput]   = useState("");
  const [promoStatus, setPromoStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [promoMessage, setPromoMessage] = useState("");

  async function handlePromoRedeem() {
    const token = promoInput.trim().toUpperCase();
    if (!token) return;
    setPromoStatus("loading");
    setPromoMessage("");
    try {
      const r = await fetch("/api/promo/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        setPromoStatus("ok");
        setPromoMessage("Pro активирован! Обновляем страницу…");
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setPromoStatus("error");
        setPromoMessage(d.error ?? "Не получилось активировать код.");
      }
    } catch {
      setPromoStatus("error");
      setPromoMessage("Нет соединения. Попробуй ещё раз.");
    }
  }

  // Usage
  const [usage, setUsage] = useState<{ used: number; limit: number; msUntilReset?: number } | null>(null);
  useEffect(() => {
    fetch("/api/usage").then(r => r.ok ? r.json() : null).then(d => {
      if (d && typeof d.used === "number") setUsage(d);
    }).catch(() => {});
  }, []);

  // Read localStorage after mount
  useEffect(() => {
    const theme = localStorage.getItem("nika-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(theme === "dark" || (!theme && prefersDark));
  }, []);

  // ── Handlers ──

  async function handleNotifSettingsSave() {
    setNotifSettingsSaving(true);
    const { error } = await supabase.from("profiles").upsert(
      { user_id: userId, notif_time: notifTime, notif_frequency: notifFrequency, reminder_enabled: true },
      { onConflict: "user_id" },
    );
    setNotifSettingsSaving(false);
    if (error) {
      console.error("[profile] notif settings save failed:", error.message);
      // показываем ошибку в консоли, но модалку закрываем — локальный стейт обновлён
    }
    closeSheet();
  }

  /**
   * Смена рода: пишем в профиль и вызываем router.refresh() — серверные
   * компоненты (шапка, таб-бар, сайдбар) перечитывают gender и бар
   * перестраивается 5↔4 без перезапуска приложения.
   */
  async function handleGenderChange(v: Gender) {
    if (genderSaving || v === gender) { closeSheet(); return; }
    setGenderSaving(true);
    const prev = gender;
    setGender(v);
    const { error } = await supabase
      .from("profiles")
      .upsert({ user_id: userId, gender: v }, { onConflict: "user_id" });
    setGenderSaving(false);
    if (error) {
      console.error("[profile] gender save failed:", error.message);
      setGender(prev); // откатываем оптимистичное значение
      return;
    }
    closeSheet();
    router.refresh();
  }

  /**
   * Единственное место управления уведомлениями (колокольчик из шапки убран).
   * Включение дёргает системный запрос разрешения и сохраняет его результат.
   */
  async function handleNotifToggle(v: boolean) {
    if (notifSaving) return;
    setNotifSaving(true);
    const prev = notifOn;
    setNotifOn(v);

    const patch: { user_id: string; proactive: boolean; notif_permission?: NotifPermission } = {
      user_id: userId,
      proactive: v,
    };
    if (v) {
      patch.notif_permission = await requestNotifPermission();
      // Подписываем на web push — не блокируем тогл если не получилось
      subscribeToPush().catch(() => {});
    } else {
      unsubscribeFromPush().catch(() => {});
    }

    const { error } = await supabase.from("profiles").upsert(patch, { onConflict: "user_id" });
    setNotifSaving(false);
    if (error) {
      console.error("[profile] notifications save failed:", error.message);
      setNotifOn(prev);
    }
  }

  // Подключение Telegram: минтим токен и открываем deep-link. Статус «Подключён»
  // проставится сам после того, как пользователь нажмёт Start в боте (при
  // следующей загрузке профиля). Если связка уже активна — сервер вернёт linked.
  // Тест-режим: кнопка активна только для allowlist (initialTelegramAllowed),
  // остальным показана как «soon». Серверный гейт — в /api/telegram/link.
  async function handleTelegramConnect() {
    if (telegramBusy) return;
    setTelegramBusy(true);
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.linked) { setTelegramLinked(true); return; }
      if (data.url) window.open(data.url, "_blank", "noopener,noreferrer");
    } catch {
      /* молча — пользователь может повторить */
    } finally {
      setTelegramBusy(false);
    }
  }

  async function handleTelegramDisconnect() {
    if (telegramBusy) return;
    setTelegramBusy(true);
    try {
      const res = await fetch("/api/telegram/unlink", { method: "POST" });
      if (res.ok) setTelegramLinked(false);
    } catch {
      /* молча */
    } finally {
      setTelegramBusy(false);
    }
  }

  async function handleQuietToggle(v: boolean) {
    if (quietSaving) return;
    setQuietSaving(true);
    const prev = quietMode;
    setQuietMode(v);
    try {
      const res = await fetch("/api/prefs/quiet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quiet_mode: v }),
      });
      if (!res.ok) setQuietMode(prev);
    } catch {
      setQuietMode(prev);
    } finally {
      setQuietSaving(false);
    }
  }

  // Утренние сообщения: сохраняем в notification_prefs. Таймзону определяем
  // молча через Intl и шлём вместе с любым изменением.
  async function saveMorningPrefs(patch: Record<string, unknown>): Promise<boolean> {
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch("/api/notifications/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, timezone }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function handleMorningToggle(v: boolean) {
    if (morningBusy) return;
    setMorningBusy(true);
    const prev = morningEnabled;
    setMorningEnabled(v);
    const ok = await saveMorningPrefs({ morning_enabled: v });
    if (!ok) setMorningEnabled(prev);
    setMorningBusy(false);
  }

  async function handleMorningTimeSave() {
    if (morningBusy) return;
    setMorningBusy(true);
    await saveMorningPrefs({ morning_time: morningTime });
    setMorningBusy(false);
    closeSheet();
  }

  // pause_until = сегодня + N дней (локально). null снимает паузу.
  async function setPauseDays(days: number) {
    if (morningBusy) return;
    setMorningBusy(true);
    const d = new Date();
    d.setDate(d.getDate() + days);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const prev = pauseUntil;
    setPauseUntil(ymd);
    const ok = await saveMorningPrefs({ pause_until: ymd });
    if (!ok) setPauseUntil(prev);
    setMorningBusy(false);
    closeSheet();
  }

  async function clearPause() {
    if (morningBusy) return;
    setMorningBusy(true);
    const prev = pauseUntil;
    setPauseUntil(null);
    const ok = await saveMorningPrefs({ pause_until: null });
    if (!ok) setPauseUntil(prev);
    setMorningBusy(false);
    closeSheet();
  }

  function handleDarkToggle(v: boolean) {
    setDark(v);
    document.documentElement.classList.toggle("dark", v);
    localStorage.setItem("nika-theme", v ? "dark" : "light");
  }

  async function handleNameSave() {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === name) { closeSheet(); return; }
    setNameSaving(true);
    await supabase.from("users").update({ display_name: trimmed }).eq("id", userId);
    setName(trimmed);
    setNameSaving(false);
    closeSheet();
  }

  async function handleDeleteConversations() {
    await supabase.from("conversations").delete().eq("user_id", userId);
    closeSheet();
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.assign("/auth");
  }

  // Derived labels
  const notifTimeShort  = notifOn ? `${notifTime} · ${FREQUENCY_OPTIONS.find(o => o.v === notifFrequency)?.label ?? ""}` : "Выкл.";

  // Пауза активна, пока pause_until >= сегодня (локально).
  const todayYmd = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const pauseActive = pauseUntil != null && pauseUntil >= todayYmd;
  const pauseLabel = pauseActive ? `до ${pauseUntil!.slice(8, 10)}.${pauseUntil!.slice(5, 7)}` : "Нет";
  const genderShort     = GENDER_OPTIONS.find(o => o.v === gender)?.short ?? "—";

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Scrollable page ── */}
      <div className="flex-1 overflow-y-auto pt-safe-top">
        <div className="mx-auto w-full max-w-[720px] px-6 pb-tabbar pt-5">

          {/* Блок идентичности */}
          <div className="mb-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="font-serif text-[32px] font-normal leading-tight tracking-[-0.02em] text-ink-primary">
                {name || email.split("@")[0]}
              </p>
              <PlanBadge isPro={isPro} />
            </div>
            <p className="mt-1 text-[14px] text-ink-muted">
              С НИКОЙ {daysWithNika} {pluralDays(daysWithNika)}
            </p>
          </div>

          {/* Usage */}
          {usage && (
            <div className="mb-5 rounded-card border border-line-subtle bg-elevated p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                  Использовано сегодня
                </span>
                {usage.msUntilReset != null && (
                  <span className="text-[11px] text-ink-muted">
                    сброс через {formatTimeLeft(usage.msUntilReset)}
                  </span>
                )}
              </div>
              <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-deep">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${Math.min(100, Math.round((usage.used / usage.limit) * 100))}%` }}
                />
              </div>
              <p className="text-[12px] text-ink-muted">
                {Math.min(100, Math.round((usage.used / usage.limit) * 100))}%
                {" "}·{" "}
                осталось {Math.max(0, Math.round(((usage.limit - usage.used) / usage.limit) * 100))}%
              </p>
            </div>
          )}

          {/* Карточка подписки (Free) */}
          {!isPro && (
            <div className="mb-6 rounded-card bg-ink-primary p-5">
              <span className="mb-3 inline-flex items-center rounded-pill bg-accent px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-canvas">
                Pro
              </span>
              <p className="mb-2 text-[18px] font-semibold leading-snug text-canvas">
                Открой расширенную НИКУ
              </p>
              <ul className="mb-4 flex flex-col gap-2">
                {[
                  "Страница советов собирается персонально под тебя",
                  "До 20 сообщений за один сценарий",
                  "Помнит контекст и не начинает с нуля каждый день",
                  "Все сценарии без ограничений",
                  "Узнаёт, что тобой движет, и держит эту нить",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden className="mt-[2px] shrink-0 text-accent">
                      <path d="M4.5 10.5l3.5 3.5 7.5-7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="text-[13px] leading-[1.5] text-canvas">{f}</span>
                  </li>
                ))}
              </ul>
              <p className="mb-4 font-mono text-[13px]" style={MUTED_ON_INVERTED}>
                <span className="font-semibold text-accent">Попробуй за 1 ₽</span> · далее 249 ₽/мес
              </p>
              <Link
                href="/upgrade"
                className="block w-full rounded-pill bg-accent py-[13px] text-center text-[14px] font-medium text-canvas transition-opacity hover:opacity-90"
              >
                Попробовать
              </Link>
              <p className="mt-2.5 text-center text-[11px] leading-[1.45]" style={MUTED_ON_INVERTED}>
                Первая неделя — 1 ₽, далее 249 ₽/мес. Отменить можно в любой момент.
              </p>
            </div>
          )}

          {/* Промокод */}
          {!isPro && (
            <div className="mb-5">
              <SectionLabel>Промокод</SectionLabel>
              <Card>
                <div className="px-4 py-3 flex flex-col gap-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={promoInput}
                      onChange={e => { setPromoInput(e.target.value); setPromoStatus("idle"); setPromoMessage(""); }}
                      onKeyDown={e => e.key === "Enter" && handlePromoRedeem()}
                      placeholder="Введи промокод"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      disabled={promoStatus === "loading" || promoStatus === "ok"}
                      className="flex-1 rounded-input border border-ink-tertiary bg-canvas px-3 py-2 text-[14px] font-mono text-ink-primary placeholder:text-ink-tertiary focus:border-accent focus:outline-none disabled:opacity-50"
                    />
                    <button
                      onClick={handlePromoRedeem}
                      disabled={promoStatus === "loading" || promoStatus === "ok" || !promoInput.trim()}
                      className="rounded-input bg-accent px-4 py-2 text-[13px] font-medium text-canvas transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {promoStatus === "loading" ? "…" : "Применить"}
                    </button>
                  </div>
                  {promoMessage && (
                    <p className={`text-[12px] leading-[1.45] ${promoStatus === "ok" ? "text-accent" : "text-red-500"}`}>
                      {promoMessage}
                    </p>
                  )}
                </div>
              </Card>
            </div>
          )}

          {/* Секция НИКА */}
          <div className="mb-5">
            <SectionLabel>НИКА</SectionLabel>
            <Card>
              <Row
                label="Уведомления"
                rightEl={<Toggle on={notifOn} onChange={handleNotifToggle} />}
              />
              {notifOn && (
                <Row label="Время и частота" value={notifTimeShort} onClick={() => setActiveSheet("when")} />
              )}
              <Row label="Род обращения"                   value={genderShort}     onClick={() => setActiveSheet("gender")} />
              <Row label="Имя — как ко мне обращаться"     value={name || "—"}     onClick={() => { setEditName(name); setActiveSheet("name"); }} />
              {telegramLinked ? (
                <Row
                  label="Telegram подключён"
                  value={telegramBusy ? "…" : "Отключить"}
                  red
                  disabled={telegramBusy}
                  onClick={handleTelegramDisconnect}
                />
              ) : initialTelegramAllowed ? (
                // Тест-режим: allowlist-пользователи могут подключить бота.
                <Row
                  label="Подключить Telegram"
                  value={telegramBusy ? "…" : "Подключить"}
                  disabled={telegramBusy}
                  onClick={handleTelegramConnect}
                />
              ) : (
                // Остальным бот ещё «недоступен» — показываем как «скоро».
                <Row label="Подключить Telegram" tag="soon" disabled />
              )}
              {telegramLinked && (
                // Плашка-подтверждение: аккаунт связан, напоминания идут в бот.
                <div className="px-4 pb-3 pt-1">
                  <div className="flex items-center gap-2 rounded-input bg-accent-soft px-3 py-2">
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden className="flex-shrink-0 text-accent">
                      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <p className="text-[12px] leading-[1.45] text-ink-secondary">
                      Аккаунт привязан к Telegram — напоминания приходят в чат с ботом.
                    </p>
                  </div>
                </div>
              )}
              {telegramBlocked && (
                <div className="px-4 pb-3 pt-1">
                  <p className="text-[12px] leading-[1.55] text-ink-faint">
                    Похоже, бот был остановлен. Если хочешь снова получать сообщения — переподключи.
                  </p>
                </div>
              )}
              {telegramLinked && (
                <>
                  <Row
                    label="Утренние сообщения от Ники"
                    rightEl={<Toggle on={morningEnabled} onChange={handleMorningToggle} />}
                  />
                  {morningEnabled && (
                    <>
                      <Row label="Когда написать утром" value={morningTime} onClick={() => setActiveSheet("morning")} />
                      <Row label="Пауза" value={pauseLabel} onClick={() => setActiveSheet("pause")} />
                    </>
                  )}
                </>
              )}
              <Row
                label="Тихий режим"
                rightEl={<Toggle on={quietMode} onChange={handleQuietToggle} />}
              />
            </Card>
          </div>

          {/* Секция Внешний вид */}
          <div className="mb-5">
            <SectionLabel>Внешний вид</SectionLabel>
            <Card>
              <Row
                label="Тёмная тема"
                rightEl={<Toggle on={dark} onChange={handleDarkToggle} />}
              />
            </Card>
          </div>

          {/* Секция Данные */}
          <div className="mb-5">
            <SectionLabel>Данные</SectionLabel>
            <Card>
              <Row label="Подключить Strava"  tag="скоро" disabled />
              <Row label="Подключить Garmin"  tag="скоро" disabled />
              <div className="px-4 py-3">
                <p className="text-[12px] leading-[1.55] text-ink-faint">
                  Появится после запуска. Пока НИКА работает по тому, что ты пишешь.
                </p>
              </div>
              <Row label="Экспорт диалогов"                onClick={() => setActiveSheet("export")} />
              <Row label="Удалить все диалоги" red          onClick={() => setActiveSheet("delete")} />
            </Card>
          </div>

          {/* Секция О НИКЕ */}
          <div className="mb-5">
            <SectionLabel>О НИКЕ</SectionLabel>
            <Card>
              <Row label="Как НИКА работает"   onClick={() => setActiveSheet("how")} />
              <Row label="Что НИКА не делает"  onClick={() => setActiveSheet("manifesto")} />
              <Row label="Поддержка"           onClick={() => setActiveSheet("support")} />
              <Row label="Условия и приватность"        onClick={() => setActiveSheet("terms")} />
              <Row label="Политика конфиденциальности" onClick={() => setActiveSheet("privacy")} />
              <Row label="Публичная оферта"            onClick={() => setActiveSheet("oferta")} />
            </Card>
          </div>

          {/* Выйти */}
          <button
            onClick={signOut}
            className="mb-4 w-full rounded-card border border-line-default bg-elevated py-[14px] text-[15px] font-medium text-accent transition-colors hover:bg-surface-warm"
          >
            Выйти
          </button>

          {/* Удалить аккаунт */}
          <button
            onClick={() => setActiveSheet("delete")}
            className="mb-8 w-full py-2 text-center text-[12px] text-ink-faint transition-colors hover:text-ink-muted"
          >
            Удалить аккаунт
          </button>

          {/* Футер */}
          <p className="text-center font-mono text-[11px] tracking-wide text-ink-faint">
            v 1.0.0 · build 247
          </p>

        </div>
      </div>

      {/* ──────────────── BOTTOM SHEETS ──────────────────────────────────────── */}

      {/* Время и частота уведомлений */}
      <BottomSheet isOpen={activeSheet === "when"} onClose={closeSheet} title="Время и частота">
        <div className="flex flex-col gap-4">
          {/* Time picker */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Время
            </p>
            <input
              type="time"
              value={notifTime}
              onChange={(e) => setNotifTime(e.target.value)}
              className="w-full rounded-[14px] border border-line-default bg-canvas px-4 py-2.5 text-[15px] text-center text-ink-primary outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Frequency */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Частота
            </p>
            <div className="flex flex-col gap-2">
              {FREQUENCY_OPTIONS.map((o) => {
                const active = notifFrequency === o.v;
                return (
                  <button
                    key={o.v}
                    onClick={() => setNotifFrequency(o.v)}
                    className={cn(
                      "flex items-center justify-between rounded-[14px] border px-4 py-3.5 text-left transition-all",
                      active
                        ? "border-ink-primary bg-ink-primary"
                        : "border-line-default bg-canvas hover:border-line-strong",
                    )}
                  >
                    <span className={cn("text-[15px] font-medium", active ? "text-canvas" : "text-ink-primary")}>
                      {o.label}
                    </span>
                    {active && (
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden className="flex-shrink-0 text-canvas">
                        <path d="M4.5 10.5l3.5 3.5 7.5-7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={handleNotifSettingsSave}
            disabled={notifSettingsSaving}
            className="mt-1 w-full rounded-full bg-accent py-3.5 text-[15px] font-semibold text-white disabled:opacity-40"
          >
            Сохранить
          </button>
        </div>
      </BottomSheet>

      {/* Когда написать утром */}
      <BottomSheet isOpen={activeSheet === "morning"} onClose={closeSheet} title="Когда написать утром">
        <div className="flex flex-col gap-4">
          <p className="text-[13px] leading-[1.5] text-ink-secondary">
            Напишу примерно в это время — тёплое «доброе утро», без будильника и давления.
          </p>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Время
            </p>
            <input
              type="time"
              value={morningTime}
              onChange={(e) => setMorningTime(e.target.value)}
              className="w-full rounded-[14px] border border-line-default bg-canvas px-4 py-2.5 text-center text-[15px] text-ink-primary outline-none transition-colors focus:border-accent"
            />
          </div>
          <button
            onClick={handleMorningTimeSave}
            disabled={morningBusy}
            className="mt-1 w-full rounded-full bg-accent py-3.5 text-[15px] font-semibold text-white disabled:opacity-40"
          >
            Сохранить
          </button>
        </div>
      </BottomSheet>

      {/* Пауза */}
      <BottomSheet isOpen={activeSheet === "pause"} onClose={closeSheet} title="Отдохнуть от сообщений">
        <div className="flex flex-col gap-4">
          <p className="text-[13px] leading-[1.5] text-ink-secondary">
            {pauseActive
              ? `Утренние сообщения на паузе ${pauseLabel}. Можно вернуть в любой момент.`
              : "Иногда нужна тишина — это нормально. Выбери, на сколько сделать паузу, и я не буду писать по утрам."}
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setPauseDays(3)}
              disabled={morningBusy}
              className="rounded-[14px] border border-line-default bg-canvas px-4 py-3.5 text-left text-[15px] font-medium text-ink-primary transition-colors hover:border-line-strong disabled:opacity-40"
            >
              Отдохнуть 3 дня
            </button>
            <button
              onClick={() => setPauseDays(7)}
              disabled={morningBusy}
              className="rounded-[14px] border border-line-default bg-canvas px-4 py-3.5 text-left text-[15px] font-medium text-ink-primary transition-colors hover:border-line-strong disabled:opacity-40"
            >
              Отдохнуть 7 дней
            </button>
            {pauseActive && (
              <button
                onClick={clearPause}
                disabled={morningBusy}
                className="rounded-[14px] px-4 py-3.5 text-left text-[15px] font-medium text-accent transition-colors hover:bg-surface-warm disabled:opacity-40"
              >
                Снять паузу
              </button>
            )}
          </div>
        </div>
      </BottomSheet>

      {/* Род обращения */}
      <BottomSheet isOpen={activeSheet === "gender"} onClose={closeSheet} title="Род обращения">
        <div className="flex flex-col gap-2.5">
          {GENDER_OPTIONS.map((o) => {
            const active = gender === o.v;
            return (
              <button
                key={o.v}
                onClick={() => handleGenderChange(o.v)}
                disabled={genderSaving}
                className={cn(
                  "flex items-center gap-3 rounded-[14px] border px-4 py-4 text-left transition-all disabled:opacity-60",
                  active
                    ? "border-ink-primary bg-ink-primary"
                    : "border-line-default bg-canvas hover:border-line-strong",
                )}
              >
                <div className="flex-1">
                  <p className={cn("text-[15px] font-medium", active ? "text-canvas" : "text-ink-primary")}>
                    {o.full}
                  </p>
                  <p className={cn("mt-0.5 text-[12px]", active ? "text-canvas/60" : "text-ink-muted")}>
                    {o.desc}
                  </p>
                </div>
                {active && (
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden className="flex-shrink-0 text-canvas">
                    <path d="M4.5 10.5l3.5 3.5 7.5-7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-[12px] leading-[1.5] text-ink-muted">
          От рода зависит, как НИКА к тебе обращается. Раздел «Мой ритм» доступен при женском роде.
        </p>
      </BottomSheet>

      {/* Имя */}
      <BottomSheet isOpen={activeSheet === "name"} onClose={closeSheet} title="Как тебя называть">
        <div>
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleNameSave(); }}
            placeholder="Твоё имя"
            autoFocus
            className="w-full rounded-[14px] border border-line-default bg-canvas px-4 py-[14px] text-[16px] text-ink-primary outline-none placeholder:text-ink-faint focus:border-accent transition-colors"
          />
          <button
            onClick={handleNameSave}
            disabled={nameSaving || !editName.trim()}
            className="mt-3 w-full rounded-pill bg-ink-primary py-[13px] text-[14px] font-medium text-canvas transition-colors hover:bg-accent disabled:opacity-50"
          >
            {nameSaving ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </BottomSheet>

      {/* Экспорт диалогов */}
      <BottomSheet isOpen={activeSheet === "export"} onClose={closeSheet} title="Экспорт диалогов">
        <div className="flex flex-col items-center py-8 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-surface-warm">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden className="text-ink-muted">
              <path d="M13 3v16M6 12l7 8 7-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 23h20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-[18px] font-semibold text-ink-primary">Скоро</p>
          <p className="mt-2 max-w-[240px] text-[14px] leading-[1.6] text-ink-muted">
            Экспорт диалогов появится в следующем обновлении.
          </p>
        </div>
      </BottomSheet>

      {/* Удалить диалоги */}
      <BottomSheet isOpen={activeSheet === "delete"} onClose={closeSheet} title="Удалить все диалоги">
        <p className="mb-6 text-[14px] leading-[1.6] text-ink-secondary">
          Все диалоги с НИКОЙ будут удалены навсегда. Это действие нельзя отменить.
        </p>
        <button
          onClick={handleDeleteConversations}
          className="mb-3 w-full rounded-pill bg-accent py-[13px] text-[14px] font-medium text-canvas transition-colors hover:bg-accent-deep"
        >
          Удалить всё
        </button>
        <button
          onClick={closeSheet}
          className="w-full rounded-pill border border-line-default py-[13px] text-[14px] font-medium text-ink-secondary transition-colors hover:border-line-strong"
        >
          Отмена
        </button>
      </BottomSheet>

      {/* Как НИКА работает */}
      <BottomSheet isOpen={activeSheet === "how"} onClose={closeSheet} title="Как НИКА работает">
        <div className="space-y-4 text-[14px] leading-[1.65] text-ink-secondary">
          <p>НИКА — это не тренер и не психолог. Это собеседник, который помогает тебе не бросить бег.</p>
          <p>Каждый разговор строится вокруг твоего состояния прямо сейчас: устал, сорвался, не хочется — НИКА рядом.</p>
          <p>НИКА запоминает контекст в рамках одного диалога и предлагает нужный сценарий в зависимости от момента.</p>
          <p>Всё, что ты пишешь, — остаётся только в твоём профиле.</p>
        </div>
      </BottomSheet>

      {/* Что НИКА не делает */}
      <BottomSheet isOpen={activeSheet === "manifesto"} onClose={closeSheet} title="Что НИКА не делает">
        <div className="space-y-4 text-[14px] leading-[1.65] text-ink-secondary">
          <p>НИКА не даёт тренировочных планов и не считает километры вместо тебя.</p>
          <p>НИКА не заменяет врача, физиотерапевта или тренера.</p>
          <p>НИКА не отправляет уведомлений каждый день, если ты не просил.</p>
          <p>НИКА не оценивает твои результаты и не сравнивает тебя с другими.</p>
          <p className="text-ink-muted">Мы здесь только чтобы ты не бросил.</p>
        </div>
      </BottomSheet>

      {/* Поддержка */}
      <BottomSheet isOpen={activeSheet === "support"} onClose={closeSheet} title="Поддержка">
        <p className="mb-5 text-[14px] leading-[1.6] text-ink-secondary">
          Если что-то не работает или есть вопросы — напиши нам, мы читаем всё.
        </p>
        <div className="flex flex-col gap-2.5">
          <a
            href="mailto:ceo@mynika.ru"
            className="flex items-center gap-3 rounded-[14px] border border-line-default bg-canvas px-4 py-4 transition-colors hover:border-accent/40"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden className="flex-shrink-0 text-ink-muted">
              <rect x="2" y="4" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2 6l7 5 7-5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            <span className="flex-1 text-[15px] text-ink-primary">ceo@mynika.ru</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="text-ink-faint">
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <a
            href="tg://resolve?domain=meine_nika"
            className="flex items-center gap-3 rounded-[14px] border border-line-default bg-canvas px-4 py-4 transition-colors hover:border-accent/40"
          >
            {/* Telegram logo */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="flex-shrink-0 text-ink-muted">
              <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" stroke="currentColor" strokeWidth="1.3" />
              <path d="M7 12l3 3 7-7" stroke="none" fill="none" />
              <path d="M16.5 7.5l-6.5 6.5-2.5-2.5 9-4zm-6.5 6.5l.5 2.5 1.5-1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] text-ink-primary">Написать в Telegram</p>
              <p className="text-[12px] text-ink-muted">@meine_nika</p>
            </div>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="text-ink-faint">
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </BottomSheet>

      {/* Условия и приватность */}
      <BottomSheet isOpen={activeSheet === "terms"} onClose={closeSheet} title="Условия и приватность">
        <div className="space-y-4 text-[14px] leading-[1.65] text-ink-secondary">
          <p>Твои данные хранятся на защищённых серверах и не передаются третьим лицам.</p>
          <p>Диалоги используются только для формирования ответов НИКИ в рамках твоей сессии.</p>
          <p>Ты можешь удалить все свои данные в любой момент в разделе «Данные».</p>
          <p>Оплата обрабатывается через ЮKassa. Отмена подписки — в любой момент из личного кабинета.</p>
        </div>
      </BottomSheet>

      {/* Политика конфиденциальности */}
      <BottomSheet isOpen={activeSheet === "privacy"} onClose={closeSheet} title="Политика конфиденциальности">
        <PrivacyContent onClose={closeSheet} />
      </BottomSheet>

      {/* Публичная оферта */}
      <BottomSheet isOpen={activeSheet === "oferta"} onClose={closeSheet} title="Публичная оферта">
        <OfertaContent onClose={closeSheet} />
      </BottomSheet>
    </>
  );
}
