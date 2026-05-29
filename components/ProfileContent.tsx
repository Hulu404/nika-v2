"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createClientComponentClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";

// ─── типы ────────────────────────────────────────────────────────────────────

type Tone = "soft" | "direct" | "brief";
type WhenWrite = "morning" | "evening" | "never";

const TONE_OPTIONS: { v: Tone; l: string; d: string }[] = [
  { v: "soft",   l: "Мягко и бережно",   d: "Как разговор с другом" },
  { v: "direct", l: "Прямо и честно",    d: "Без лишних слов" },
  { v: "brief",  l: "Коротко и по делу", d: "Минимум текста" },
];

const WHEN_OPTIONS: { v: WhenWrite; l: string }[] = [
  { v: "morning", l: "Утром перед тренировкой" },
  { v: "evening", l: "Вечером" },
  { v: "never",   l: "Не писать первой" },
];

// ─── вспомогательные компоненты ──────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
      {children}
    </p>
  );
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
      <span
        className={cn(
          "absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-soft transition-transform duration-200",
          on ? "translate-x-[26px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

// ─── основной компонент ───────────────────────────────────────────────────────

interface Props {
  userId: string;
  initialName: string;
  email: string;
  isPro: boolean;
  reminderEnabled: boolean;
}

export function ProfileContent({
  userId,
  initialName,
  email,
  isPro,
  reminderEnabled,
}: Props) {
  const [supabase] = useState(() => createClientComponentClient());

  // Имя
  const [name, setName]               = useState(initialName);
  const [nameSaved, setNameSaved]     = useState(false);
  const nameTimer                      = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Тон (localStorage)
  const [tone, setTone] = useState<Tone>("soft");

  // Когда писать (localStorage + profiles.reminder_enabled)
  const [whenWrite, setWhenWrite] = useState<WhenWrite>(
    reminderEnabled ? "morning" : "never",
  );

  // Тёмная тема
  const [dark, setDark] = useState(false);

  // Читаем localStorage один раз после маунта
  useEffect(() => {
    const t = localStorage.getItem("nika-tone") as Tone | null;
    if (t) setTone(t);

    const w = localStorage.getItem("nika-when") as WhenWrite | null;
    if (w) setWhenWrite(w);

    const theme = localStorage.getItem("nika-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(theme === "dark" || (!theme && prefersDark));
  }, []);

  // Автосохранение имени с дебаунсом 800 мс
  function handleNameChange(v: string) {
    setName(v);
    setNameSaved(false);
    if (nameTimer.current) clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(async () => {
      await supabase
        .from("users")
        .update({ display_name: v.trim() || null })
        .eq("id", userId);
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
    }, 800);
  }

  // Тон — только localStorage (нет колонки в БД)
  function handleToneChange(v: Tone) {
    setTone(v);
    localStorage.setItem("nika-tone", v);
  }

  // Когда писать — localStorage + profiles.reminder_enabled
  async function handleWhenChange(v: WhenWrite) {
    setWhenWrite(v);
    localStorage.setItem("nika-when", v);
    await supabase
      .from("profiles")
      .upsert(
        { user_id: userId, reminder_enabled: v !== "never" },
        { onConflict: "user_id" },
      );
  }

  // Тёмная тема
  function handleDarkToggle(v: boolean) {
    setDark(v);
    document.documentElement.classList.toggle("dark", v);
    localStorage.setItem("nika-theme", v ? "dark" : "light");
  }

  // Выход
  async function signOut() {
    await supabase.auth.signOut();
    window.location.assign("/auth");
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-md px-5 pb-32 pt-10">

        {/* Заголовок */}
        <h1 className="mb-8 font-serif text-[34px] font-normal leading-none tracking-[-0.025em] text-ink-primary">
          Профиль
        </h1>

        {/* ── 1. Личные данные ─── */}
        <section className="mb-7">
          <SectionLabel>Личные данные</SectionLabel>
          <div className="divide-y divide-line-subtle rounded-card border border-line-default bg-elevated">
            {/* Имя */}
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="w-14 flex-shrink-0 text-[13px] text-ink-muted">Имя</span>
              <input
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Твоё имя"
                className="flex-1 bg-transparent text-[14px] text-ink-primary outline-none placeholder:text-ink-faint"
              />
              {nameSaved && (
                <span className="flex-shrink-0 text-[11px] text-accent">Сохранено</span>
              )}
            </div>
            {/* Email */}
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="w-14 flex-shrink-0 text-[13px] text-ink-muted">Email</span>
              <span className="flex-1 truncate text-[14px] text-ink-secondary">{email}</span>
            </div>
          </div>
        </section>

        {/* ── 2. Тон НИКИ ─── */}
        <section className="mb-7">
          <SectionLabel>Тон НИКИ</SectionLabel>
          <div className="flex flex-col gap-2">
            {TONE_OPTIONS.map((o) => (
              <button
                key={o.v}
                onClick={() => handleToneChange(o.v)}
                className={cn(
                  "w-full rounded-card border px-5 py-[14px] text-left transition-all duration-150",
                  tone === o.v
                    ? "border-ink-primary bg-ink-primary"
                    : "border-line-default bg-elevated hover:border-line-strong",
                )}
              >
                <span className={cn("block text-[14px] font-medium leading-snug",
                  tone === o.v ? "text-canvas" : "text-ink-primary")}>
                  {o.l}
                </span>
                <span className={cn("mt-0.5 block text-[12px]",
                  tone === o.v ? "text-canvas/70" : "text-ink-muted")}>
                  {o.d}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ── 3. Когда писать первой ─── */}
        <section className="mb-7">
          <SectionLabel>Когда писать первой</SectionLabel>
          <div className="flex flex-col gap-2">
            {WHEN_OPTIONS.map((o) => (
              <button
                key={o.v}
                onClick={() => handleWhenChange(o.v)}
                className={cn(
                  "w-full rounded-card border px-5 py-[14px] text-left text-[14px] font-medium transition-all duration-150",
                  whenWrite === o.v
                    ? "border-ink-primary bg-ink-primary text-canvas"
                    : "border-line-default bg-elevated text-ink-primary hover:border-line-strong",
                )}
              >
                {o.l}
              </button>
            ))}
          </div>
        </section>

        {/* ── 4. Тёмная тема ─── */}
        <section className="mb-7">
          <SectionLabel>Внешний вид</SectionLabel>
          <div className="flex items-center justify-between rounded-card border border-line-default bg-elevated px-4 py-4">
            <div>
              <p className="text-[14px] font-medium text-ink-primary">Тёмная тема</p>
              <p className="mt-0.5 text-[12px] text-ink-muted">Переключить оформление</p>
            </div>
            <Toggle on={dark} onChange={handleDarkToggle} />
          </div>
        </section>

        {/* ── 5. Подписка ─── */}
        <section className="mb-8">
          <SectionLabel>Подписка</SectionLabel>
          <div className="rounded-card border border-line-default bg-elevated px-5 py-4">
            {isPro ? (
              <div className="flex items-center justify-between">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-accent">
                      PRO
                    </span>
                    <span className="text-[14px] font-medium text-ink-primary">Активна</span>
                  </div>
                  <p className="text-[12px] text-ink-muted">Все функции открыты</p>
                </div>
                <div className="h-9 w-9 flex-shrink-0 rounded-full bg-nika-avatar" />
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-[14px] font-medium text-ink-primary">Free</p>
                    <p className="text-[12px] text-ink-muted">10 сообщений в день</p>
                  </div>
                </div>
                <Link
                  href="/upgrade"
                  className="block w-full rounded-pill bg-ink-primary py-[11px] text-center text-[13px] font-medium text-canvas transition-colors hover:bg-accent"
                >
                  Подключить PRO
                </Link>
              </>
            )}
          </div>
        </section>

        {/* ── Кнопка выйти ─── */}
        <button
          onClick={signOut}
          className="w-full rounded-card border border-line-default bg-elevated py-[14px] text-[14px] font-medium text-accent transition-colors hover:bg-surface-warm"
        >
          Выйти
        </button>

      </div>
    </div>
  );
}
