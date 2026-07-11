"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { showRhythm } from "@/lib/profile";
import { HOME_HREF, CHAT_HREF, MEDITATIONS_HREF, JOURNAL_HREF, RHYTHM_HREF, TIPS_HREF } from "@/lib/nav";

// ─── иконки (свой набор, 22×22, stroke 1.5) ──────────────────────────────────

function IcHome() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M3 11L11 4l8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 9v8a1 1 0 0 0 1 1h4v-4h2v4h4a1 1 0 0 0 1-1V9" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
function IcChat() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M3 17V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-5 3v-3Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
/** Медитации: лотос (покой / дыхание). */
function IcLotus() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M11 4c1.9 2.2 2.9 4.2 2.9 6 0 1.6-1.2 2.7-2.9 2.7S8.1 11.6 8.1 10c0-1.8 1-3.8 2.9-6Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8.3 8.9C6.2 8.6 4.4 9.4 3.4 10.7c1 2.2 3.4 3.5 5.9 3.2"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.7 8.9c2.1-.3 3.9.5 4.9 1.8-1 2.2-3.4 3.5-5.9 3.2"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.2 16.4c2 1.2 4.3 1.8 6.8 1.8s4.8-.6 6.8-1.8"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function IcJournal() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M5 4h12v14l-6-3-6 3V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
function IcRhythm() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M2 11h4l2.5-6 4 12 2.5-6H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
/** Советы: лампочка (подсказка / идея). */
function IcTip() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M7.5 14a4.5 4.5 0 1 1 7 0c-.7.6-1.2 1.3-1.2 2.3v.4H8.7v-.4c0-1-.5-1.7-1.2-2.3Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8.8 19.5h4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── вкладки ─────────────────────────────────────────────────────────────────

interface Tab {
  href: string;
  label: string;
  icon: React.ReactNode;
  isActive: (pathname: string) => boolean;
}

const TAB_HOME: Tab = {
  href: HOME_HREF,
  label: "Главная",
  icon: <IcHome />,
  isActive: (p) => p === "/today" || p === "/day1",
};
const TAB_CHAT: Tab = {
  href: CHAT_HREF,
  label: "Чат",
  icon: <IcChat />,
  isActive: (p) => p.startsWith("/chat"),
};
const TAB_MEDITATIONS: Tab = {
  href: MEDITATIONS_HREF,
  label: "Медитации",
  icon: <IcLotus />,
  isActive: (p) => p.startsWith("/meditations"),
};
const TAB_JOURNAL: Tab = {
  href: JOURNAL_HREF,
  label: "Журнал",
  icon: <IcJournal />,
  isActive: (p) => p.startsWith("/journal"),
};
const TAB_RHYTHM: Tab = {
  href: RHYTHM_HREF,
  label: "Мой ритм",
  icon: <IcRhythm />,
  isActive: (p) => p.startsWith("/rhythm"),
};
const TAB_TIPS: Tab = {
  href: TIPS_HREF,
  label: "Советы",
  icon: <IcTip />,
  isActive: (p) => p.startsWith("/tips"),
};

/**
 * Набор вкладок из профиля: «Мой ритм» появляется строго по showRhythm(gender,
 * cycle), «Советы» всегда последней (общий раздел, без гейта). «Профиль»
 * переехал в аватар шапки, в баре его нет.
 */
function buildTabs(gender?: string | null, cycle?: string | null): Tab[] {
  const tabs = [TAB_HOME, TAB_CHAT, TAB_MEDITATIONS, TAB_JOURNAL];
  if (showRhythm(gender, cycle)) tabs.push(TAB_RHYTHM);
  tabs.push(TAB_TIPS);
  return tabs;
}

/**
 * gender и cycle приходят пропами с сервера (BottomNavData) и пересчитываются на
 * каждом серверном рендере, поэтому после router.refresh() бар сам перестраивается 5↔4.
 */
export function BottomNav({ gender, cycle }: { gender?: string | null; cycle?: string | null }) {
  const pathname = usePathname();
  const tabs = buildTabs(gender, cycle);

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-[var(--bg-blur-strong)] backdrop-blur-[20px] border-t border-line-subtle pb-safe">
      <div className="flex items-stretch px-1 pt-1.5 pb-2">
        {tabs.map(({ href, label, icon, isActive }) => {
          const active = isActive(pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[10px] px-1 py-1 transition-all duration-150 active:scale-95 active:text-accent",
                active ? "text-accent" : "text-ink-muted",
              )}
            >
              {icon}
              <span className="whitespace-nowrap text-[10px] font-medium leading-none">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
