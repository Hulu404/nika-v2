"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TAB_TODAY = {
  href: "/today",
  label: "Главная",
  icon: (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M3 11L11 4l8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 9v8a1 1 0 0 0 1 1h4v-4h2v4h4a1 1 0 0 0 1-1V9" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
};
const TAB_CHAT = {
  href: "/chat/morning",
  label: "Чат",
  icon: (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M3 17V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-5 3v-3Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
};
const TAB_JOURNAL = {
  href: "/journal",
  label: "Журнал",
  icon: (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M5 4h12v14l-6-3-6 3V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
};
// Раздел «Мой ритм» — только для женского рода (вместо «Аналитики» в мобильной панели).
const TAB_RHYTHM = {
  href: "/rhythm",
  label: "Мой ритм",
  icon: (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M2 11h4l2.5-6 4 12 2.5-6H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};
const TAB_PROFILE = {
  href: "/profile",
  label: "Профиль",
  icon: (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <circle cx="11" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 19c.6-3.5 3.7-5 7-5s6.4 1.5 7 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
};

export function BottomNav({ showRhythm = false }: { showRhythm?: boolean }) {
  const pathname = usePathname();

  // «Аналитика» из мобильной панели убрана; для female на её место — «Мой ритм».
  const TABS = [
    TAB_TODAY,
    TAB_CHAT,
    TAB_JOURNAL,
    ...(showRhythm ? [TAB_RHYTHM] : []),
    TAB_PROFILE,
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-[var(--bg-blur-strong)] backdrop-blur-[20px] border-t border-[var(--border-subtle)] pb-safe">
      <div className="flex items-stretch px-1 pt-2 pb-3">
        {TABS.map(({ href, label, icon }) => {
          const active =
            pathname === href ||
            (href === "/today" && pathname === "/day1");
          return (
            <Link
              key={label}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 px-1 py-1 rounded-[10px] transition-all duration-150 min-w-0 active:scale-95 active:text-accent",
                active ? "text-accent" : "text-ink-muted",
              )}
            >
              {icon}
              <span className="text-[10px] font-medium whitespace-nowrap">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
