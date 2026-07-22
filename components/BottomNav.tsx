"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { showRhythm } from "@/lib/profile";
import { HOME_HREF, CHAT_HREF, JOURNAL_HREF, RHYTHM_HREF, TIPS_HREF } from "@/lib/nav";

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
 * Вкладки таб-бара. Медитации переехали карточкой на Главную (плашка «soon»);
 * освободившееся среднее место у женской формы обращения занимает «Мой ритм».
 * У остальных остаётся четыре вкладки.
 */
function buildTabs(rhythm: boolean): Tab[] {
  const middle = rhythm ? [TAB_RHYTHM] : [];
  return [TAB_HOME, TAB_CHAT, ...middle, TAB_JOURNAL, TAB_TIPS];
}

/** Является ли элемент текстовым полем (открывает клавиатуру). */
function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  if (el.tagName !== "INPUT") return false;
  const t = (el as HTMLInputElement).type;
  return !["button", "submit", "reset", "checkbox", "radio", "range", "file", "color", "image"].includes(t);
}

export function BottomNav({ gender, cycle }: { gender?: string | null; cycle?: string | null }) {
  const pathname = usePathname();
  const tabs = buildTabs(showRhythm(gender, cycle));

  // Прячем нижнюю навигацию, пока в фокусе текстовое поле (открыта клавиатура):
  // на iOS fixed+backdrop-blur панель иначе всплывает над контентом при вводе.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => { if (isTextField(e.target)) setTyping(true); };
    const onFocusOut = () => {
      // Отложенно: при переходе между полями focusout→focusin не мигаем.
      setTimeout(() => { if (!isTextField(document.activeElement)) setTyping(false); }, 0);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <nav className={cn(
      "lg:hidden fixed bottom-0 inset-x-0 z-50 bg-[var(--bg-blur-strong)] backdrop-blur-[20px] border-t border-line-subtle pb-safe",
      typing && "hidden",
    )}>
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
