"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ScenarioSheet } from "@/components/ScenarioSheet";

// ──────────────────────────────── иконки ────────────────────────────────────

function IcChat() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M3 14V5.5A2.5 2.5 0 0 1 5.5 3h7A2.5 2.5 0 0 1 15 5.5v5A2.5 2.5 0 0 1 12.5 13H7L3 16V14Z"
        stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
function IcStar() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M9 2l1.8 3.6L15 6.3l-3 2.9.7 4.1L9 11.1 5.3 13.3 6 9.2 3 6.3l4.2-.7L9 2Z"
        stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
function IcTimer() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="9" cy="10" r="6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9 7v3l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M7 2h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function IcList() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M3 5h12M3 9h12M3 13h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function IcChart() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M3 14l4-4 3 3 5-6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IcBell() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M9 2a5 5 0 0 1 5 5v3l1.5 2H2.5L4 10V7a5 5 0 0 1 5-5Z"
        stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M7.5 14a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function IcUser() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="9" cy="6.5" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 15.5c.5-2.8 2.9-4 5.5-4s5 1.2 5.5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function IcMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M13 8.5A5.5 5.5 0 0 1 7.5 3a5 5 0 1 0 5.5 5.5Z"
        stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}
function IcSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function IcPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function IcChev() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ──────────────────────────────── типы ──────────────────────────────────────

export interface RecentConvo {
  label: string;
  time: string;
  href: string;
}

// ──────────────────────────────── компонент ──────────────────────────────────

interface SidebarProps {
  recentConvos: RecentConvo[];
}

export function Sidebar({ recentConvos }: SidebarProps) {
  const pathname = usePathname();
  const [dark, setDark] = useState(false);
  const [showScenarioSheet, setShowScenarioSheet] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleDark() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("nika-theme", next ? "dark" : "light");
  }

  const NAV = [
    { href: "/today",     label: "Сегодня",        icon: <IcChat />,  implemented: true },
    { href: "#",          label: "Трекинг",         icon: <IcTimer />, implemented: false },
    { href: "/journal",   label: "Журнал пробежек", icon: <IcList />,  implemented: true },
    { href: "/analytics", label: "Аналитика",       icon: <IcChart />, implemented: true },
    { href: "#",          label: "Пуши",            icon: <IcBell />,  implemented: false },
  ];

  return (
    <>
      <aside className="hidden lg:flex w-[280px] flex-shrink-0 flex-col h-full border-r border-[var(--border-default)] bg-[var(--bg-canvas)] overflow-y-auto">

        {/* Хедер */}
        <div className="flex items-center gap-3 px-[22px] py-6 border-b border-[var(--border-default)]">
          <div className="relative w-9 h-9 rounded-full bg-nika-avatar flex-shrink-0">
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-canvas)] bg-[#7BA968]" />
          </div>
          <span className="font-serif text-[22px] font-medium tracking-[-0.02em] text-ink-primary">НИКА</span>
        </div>

        {/* Кнопка нового разговора */}
        <div className="px-[14px] pt-4 pb-2">
          <button
            onClick={() => setShowScenarioSheet(true)}
            className="flex items-center gap-2 w-full bg-ink-primary text-canvas rounded-[10px] px-[14px] py-[11px] text-[13px] font-medium transition-colors hover:bg-accent"
          >
            <IcPlus />
            Новый разговор
          </button>
        </div>

        {/* Навигация */}
        <nav className="px-2 pt-2 pb-1 flex flex-col gap-px border-b border-[var(--border-default)]">
          {NAV.map(({ href, label, icon, implemented }) => {
            const active = implemented && pathname === href;
            return (
              <Link
                key={label}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-[8px] rounded-[8px] text-[13px] transition-colors",
                  active
                    ? "bg-[var(--surface-deep)] text-ink-primary font-medium"
                    : implemented
                      ? "text-ink-secondary hover:bg-[var(--surface-deep)] hover:text-ink-primary"
                      : "text-ink-muted cursor-default opacity-60",
                )}
                tabIndex={implemented ? undefined : -1}
                aria-disabled={!implemented}
              >
                <span className={cn(active ? "text-accent" : "text-ink-muted")}>{icon}</span>
                {label}
                {!implemented && (
                  <span className="ml-auto font-mono text-[9px] tracking-widest text-ink-faint uppercase">soon</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Нижний блок */}
        <div className="mt-auto px-3 py-3 space-y-1 border-t border-[var(--border-default)]">

          {/* PRO-блок */}
          <div className="mb-3 px-3 py-3 rounded-[10px] bg-[var(--surface-warm)] border border-[rgba(200,85,61,0.18)] relative overflow-hidden">
            <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-accent font-semibold mb-1">PRO</div>
            <div className="text-[14px] font-serif font-medium text-ink-primary">Free + 7 дней пробного</div>
            <div className="text-[12px] text-ink-secondary mt-0.5">Попробуй все функции</div>
            <Link
              href="/upgrade"
              className="mt-2.5 block w-full bg-ink-primary text-canvas rounded-pill py-[9px] text-center text-[12px] font-medium hover:bg-accent transition-colors"
            >
              Подключить PRO
            </Link>
          </div>

          {/* Профиль */}
          <Link
            href="/profile"
            className={cn(
              "flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2 text-[13px] transition-colors",
              pathname === "/profile"
                ? "bg-[var(--surface-deep)] text-ink-primary"
                : "text-ink-secondary hover:bg-[var(--surface-deep)] hover:text-ink-primary",
            )}
          >
            <IcUser />
            Профиль
            <IcChev />
          </Link>

          {/* Тёмная тема */}
          <button
            onClick={toggleDark}
            className="flex items-center gap-2.5 w-full px-3 py-[9px] rounded-[10px] text-[13px] text-ink-secondary border border-[var(--border-default)] hover:text-ink-primary hover:border-ink-primary transition-all"
          >
            {dark ? <IcSun /> : <IcMoon />}
            <span className="flex-1 text-left">Тёмная тема</span>
            <span className="font-mono text-[10px] text-ink-muted bg-[var(--surface-deep)] px-[7px] py-[3px] rounded uppercase tracking-[0.08em]">
              {dark ? "ON" : "OFF"}
            </span>
          </button>
        </div>

        {/* Список диалогов */}
        <div className="px-4 pb-6">
          <div className="text-[10.5px] font-mono uppercase tracking-[0.1em] text-ink-muted font-medium py-3">
            Сегодня — диалоги
          </div>
          <div className="flex flex-col gap-0.5">
            {recentConvos.length === 0 ? (
              <span className="px-3 py-2 text-[13px] text-ink-muted italic font-serif">
                Нет диалогов
              </span>
            ) : (
              recentConvos.map((c) => (
                <Link
                  key={c.href}
                  href={c.href}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 rounded-[8px] text-[13px] transition-colors",
                    pathname === c.href
                      ? "bg-[var(--surface-deep)] text-ink-primary"
                      : "text-ink-secondary hover:bg-[var(--surface-deep)] hover:text-ink-primary",
                  )}
                >
                  <span className="truncate">{c.label}</span>
                  <span className="text-[11px] text-ink-muted ml-2 flex-shrink-0">{c.time}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      </aside>

      {/* Sheet выбора сценария */}
      <ScenarioSheet isOpen={showScenarioSheet} onClose={() => setShowScenarioSheet(false)} />
    </>
  );
}
