"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { PlanBadge } from "@/components/PlanBadge";
import { ScenarioSheet } from "@/components/ScenarioSheet";

// ──────────────────────────────── иконки ────────────────────────────────────

function IcHome() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M3 8.5L9 3L15 8.5V15.5H11.5V11.5H6.5V15.5H3V8.5Z"
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
function IcRhythm() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M2 9h3l2-5 3 10 2-5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
/** Медитации: лотос (покой / дыхание). */
function IcLotus() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M9 3c1.6 1.8 2.4 3.4 2.4 4.9 0 1.3-1 2.2-2.4 2.2s-2.4-.9-2.4-2.2C6.6 6.4 7.4 4.8 9 3Z"
        stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M6.8 7.3C5 7.1 3.6 7.7 2.8 8.8c.8 1.8 2.8 2.9 4.8 2.6"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.2 7.3c1.8-.2 3.2.4 4 1.5-.8 1.8-2.8 2.9-4.8 2.6"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.4 13.4c1.6 1 3.5 1.5 5.6 1.5s4-.5 5.6-1.5"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
function IcSprint() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M9 2v4M13.5 4.5l-3 2.5M15 9h-4M13.5 13.5l-3-2.5M9 16v-4M4.5 13.5l3-2.5M3 9h4M4.5 4.5l3 2.5"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
function IcChevRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IcChevLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M9 3L5 7L9 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ──────────────────────────────── tooltip ───────────────────────────────────

function Tip({
  label,
  show,
  children,
}: {
  label: string;
  show: boolean;
  children: React.ReactNode;
}) {
  if (!show) return <>{children}</>;
  return (
    <div className="group/tip relative">
      {children}
      <span
        className="pointer-events-none absolute left-full top-1/2 z-[200] ml-3 -translate-y-1/2 whitespace-nowrap rounded-[6px] bg-ink-primary px-2.5 py-1.5 text-[11px] font-medium text-canvas opacity-0 shadow-md transition-opacity duration-150 group-hover/tip:opacity-100"
        role="tooltip"
      >
        {label}
      </span>
    </div>
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
  isPro?: boolean;
  showRhythm?: boolean;
}

export function Sidebar({ recentConvos, isPro = false, showRhythm = false }: SidebarProps) {
  const pathname = usePathname();
  const [dark, setDark] = useState(false);
  const [showScenarioSheet, setShowScenarioSheet] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    const stored = localStorage.getItem("sidebar_collapsed");
    if (stored === "true") setCollapsed(true);
    setMounted(true);
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar_collapsed", next ? "true" : "false");
  }

  function toggleDark() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("nika-theme", next ? "dark" : "light");
  }

  const NAV = [
    { href: "/today",       label: "Сегодня",        icon: <IcHome />,   implemented: true },
    { href: "#",            label: "Трекинг",         icon: <IcTimer />,  implemented: false },
    { href: "#",            label: "Медитации",       icon: <IcLotus />,  implemented: false },
    { href: "/journal",     label: "Журнал пробежек", icon: <IcList />,   implemented: true },
    ...(showRhythm
      ? [{ href: "/rhythm", label: "Мой ритм",        icon: <IcRhythm />, implemented: true }]
      : []),
    { href: "/analytics",   label: "Аналитика",       icon: <IcChart />,  implemented: true },
    ...(isPro
      ? [{ href: "/sprint", label: "Спринт",          icon: <IcSprint />, implemented: true }]
      : []),
    { href: "#",            label: "Пуши",            icon: <IcBell />,   implemented: false },
  ];

  // Suppress width transition on first paint to avoid flash
  const transitionClass = mounted ? "transition-[width] duration-[250ms] ease-in-out" : "";
  const w = collapsed ? 64 : 280;

  return (
    <>
      <aside
        className={cn(
          "hidden lg:flex flex-shrink-0 flex-col h-full border-r border-[var(--border-default)] bg-[var(--bg-canvas)] overflow-y-auto overflow-x-hidden",
          transitionClass,
        )}
        style={{ width: w }}
      >
        {/* ── Хедер ─────────────────────────────────────────────────────── */}
        <div
          className={cn(
            "flex flex-shrink-0 items-center border-b border-[var(--border-default)]",
            collapsed ? "justify-center px-0 py-5" : "gap-3 px-[22px] py-6",
          )}
        >
          {/* Аватар */}
          <div className="relative h-9 w-9 flex-shrink-0 rounded-full bg-nika-avatar">
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-canvas)] bg-[#7BA968]" />
          </div>

          {/* Название — скрыто при свёрнутом */}
          {!collapsed && (
            <span className="whitespace-nowrap font-serif text-[22px] font-medium tracking-[-0.02em] text-ink-primary">
              НИКА
            </span>
          )}
        </div>

        {/* ── Кнопка «Новый разговор» ──────────────────────────────────── */}
        <div className={cn("pb-2 pt-4", collapsed ? "px-2" : "px-[14px]")}>
          <Tip label="Новый разговор" show={collapsed}>
            <button
              onClick={() => setShowScenarioSheet(true)}
              className={cn(
                "flex w-full items-center bg-ink-primary text-canvas rounded-[10px] text-[13px] font-medium transition-colors hover:bg-accent",
                collapsed ? "justify-center p-3" : "gap-2 px-[14px] py-[11px]",
              )}
            >
              <IcPlus />
              {!collapsed && <span className="whitespace-nowrap">Новый разговор</span>}
            </button>
          </Tip>
        </div>

        {/* ── Навигация ─────────────────────────────────────────────────── */}
        <nav className={cn("flex flex-col gap-px border-b border-[var(--border-default)] pb-1 pt-2", collapsed ? "px-2" : "px-2")}>
          {NAV.map(({ href, label, icon, implemented }) => {
            const active = implemented && pathname === href;
            return (
              <Tip key={label} label={label} show={collapsed}>
                <Link
                  href={href}
                  className={cn(
                    "flex items-center rounded-[8px] text-[13px] transition-colors",
                    collapsed ? "justify-center p-[10px]" : "gap-2.5 px-3 py-[8px]",
                    active
                      ? "bg-[var(--surface-deep)] text-ink-primary font-medium"
                      : implemented
                        ? "text-ink-secondary hover:bg-[var(--surface-deep)] hover:text-ink-primary"
                        : "text-ink-muted cursor-default opacity-60",
                  )}
                  tabIndex={implemented ? undefined : -1}
                  aria-disabled={!implemented}
                >
                  <span className={cn("flex-shrink-0", active ? "text-accent" : "text-ink-muted")}>
                    {icon}
                  </span>
                  {!collapsed && (
                    <>
                      <span className="whitespace-nowrap">{label}</span>
                      {!implemented && (
                        <span className="ml-auto font-mono text-[9px] tracking-widest text-ink-faint uppercase">
                          soon
                        </span>
                      )}
                    </>
                  )}
                </Link>
              </Tip>
            );
          })}
        </nav>

        {/* ── Нижний блок ───────────────────────────────────────────────── */}
        <div className={cn("mt-auto space-y-1 border-t border-[var(--border-default)] py-3", collapsed ? "px-2" : "px-3")}>

          {/* PRO-блок — скрыт при свёрнутом и для Pro-пользователей */}
          {!collapsed && !isPro && (
            <div className="mb-3 overflow-hidden rounded-[10px] border border-[rgba(200,85,61,0.18)] bg-[var(--surface-warm)] px-3 py-3 relative">
              <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">PRO</div>
              <div className="font-serif text-[14px] font-medium text-ink-primary">Free + 7 дней пробного</div>
              <div className="mt-0.5 text-[12px] text-ink-secondary">Попробуй все функции</div>
              <Link
                href="/upgrade"
                className="mt-2.5 block w-full rounded-pill bg-ink-primary py-[9px] text-center text-[12px] font-medium text-canvas transition-colors hover:bg-accent"
              >
                Подключить PRO
              </Link>
            </div>
          )}

          {/* Профиль */}
          <Tip label="Профиль" show={collapsed}>
            <Link
              href="/profile"
              className={cn(
                "flex items-center rounded-[8px] text-[13px] transition-colors",
                collapsed ? "justify-center p-[10px]" : "w-full gap-2.5 px-3 py-2",
                pathname === "/profile"
                  ? "bg-[var(--surface-deep)] text-ink-primary"
                  : "text-ink-secondary hover:bg-[var(--surface-deep)] hover:text-ink-primary",
              )}
            >
              <IcUser />
              {!collapsed && (
                <>
                  <span className="flex-1 whitespace-nowrap">Профиль</span>
                  <PlanBadge isPro={isPro} className="px-1.5 py-[2px] text-[9px] tracking-[0.1em]" />
                  <IcChevRight />
                </>
              )}
            </Link>
          </Tip>

          {/* Тёмная тема */}
          <Tip label={dark ? "Светлая тема" : "Тёмная тема"} show={collapsed}>
            <button
              onClick={toggleDark}
              className={cn(
                "flex items-center rounded-[10px] border border-[var(--border-default)] text-[13px] text-ink-secondary transition-all hover:border-ink-primary hover:text-ink-primary",
                collapsed ? "w-full justify-center p-[10px]" : "w-full gap-2.5 px-3 py-[9px]",
              )}
            >
              {dark ? <IcSun /> : <IcMoon />}
              {!collapsed && (
                <>
                  <span className="flex-1 whitespace-nowrap text-left">Тёмная тема</span>
                  <span className="rounded bg-[var(--surface-deep)] px-[7px] py-[3px] font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted">
                    {dark ? "ON" : "OFF"}
                  </span>
                </>
              )}
            </button>
          </Tip>

          {/* Свернуть / Развернуть */}
          <Tip label="Развернуть" show={collapsed}>
            <button
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Развернуть сайдбар" : "Свернуть сайдбар"}
              className={cn(
                "flex items-center rounded-[8px] text-[13px] text-ink-muted transition-colors hover:bg-[var(--surface-deep)] hover:text-ink-primary",
                collapsed ? "w-full justify-center p-[10px]" : "w-full gap-2.5 px-3 py-2",
              )}
            >
              {collapsed ? <IcChevRight /> : <IcChevLeft />}
              {!collapsed && <span className="whitespace-nowrap">Свернуть</span>}
            </button>
          </Tip>
        </div>

        {/* ── Список диалогов — скрыт при свёрнутом ────────────────────── */}
        {!collapsed && (
          <div className="px-4 pb-6">
            <div className="py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-ink-muted">
              Сегодня — диалоги
            </div>
            <div className="flex flex-col gap-0.5">
              {recentConvos.length === 0 ? (
                <span className="px-3 py-2 font-serif text-[13px] italic text-ink-muted">
                  Нет диалогов
                </span>
              ) : (
                recentConvos.map((c) => (
                  <Link
                    key={c.href}
                    href={c.href}
                    className={cn(
                      "flex items-center justify-between rounded-[8px] px-3 py-2 text-[13px] transition-colors",
                      pathname === c.href
                        ? "bg-[var(--surface-deep)] text-ink-primary"
                        : "text-ink-secondary hover:bg-[var(--surface-deep)] hover:text-ink-primary",
                    )}
                  >
                    <span className="truncate">{c.label}</span>
                    <span className="ml-2 flex-shrink-0 text-[11px] text-ink-muted">{c.time}</span>
                  </Link>
                ))
              )}
            </div>
          </div>
        )}
      </aside>

      {/* Sheet выбора сценария */}
      <ScenarioSheet isOpen={showScenarioSheet} onClose={() => setShowScenarioSheet(false)} />
    </>
  );
}
