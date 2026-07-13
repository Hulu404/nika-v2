'use client';

import Link from 'next/link';
import { usePwaInstall } from '@/lib/hooks/usePwaInstall';

function IcDownload() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 4v10M8 10l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 18h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IcProfile() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 20c.8-4 4.4-6 8-6s7.2 2 8 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Day1InstallCard() {
  const { isStandalone, canPromptNative, promptInstall, platform } = usePwaInstall();

  // Уже установлено — показываем карточку «Настройки»
  if (isStandalone) {
    return (
      <Link
        href="/profile"
        className="group flex items-center gap-4 rounded-[18px] border px-5 py-4 text-left transition-all hover:shadow-card"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
      >
        <div
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[13px] text-accent"
          style={{ background: 'var(--surface-nika)' }}
        >
          <IcProfile />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-serif text-[16px] lg:text-[18px] font-medium leading-tight text-ink-primary">
            Настройки
          </div>
          <div className="mt-1 text-[12.5px] leading-[1.45] text-ink-secondary">
            Тон, когда писать первой, тёмная тема.
          </div>
        </div>
      </Link>
    );
  }

  // Android с нативным prompt
  if (platform === 'android' && canPromptNative) {
    return (
      <button
        onClick={promptInstall}
        className="group flex w-full items-center gap-4 rounded-[18px] border px-5 py-4 text-left transition-all hover:shadow-card"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
      >
        <div
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[13px] text-accent"
          style={{ background: 'var(--surface-nika)' }}
        >
          <IcDownload />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-serif text-[16px] lg:text-[18px] font-medium leading-tight text-ink-primary">
            Установить приложение
          </div>
          <div className="mt-1 text-[12.5px] leading-[1.45] text-ink-secondary">
            Один тап — и я всегда под рукой.
          </div>
        </div>
      </button>
    );
  }

  // iOS или desktop без prompt — ведём на /install
  return (
    <Link
      href="/install"
      className="group flex items-center gap-4 rounded-[18px] border px-5 py-4 text-left transition-all hover:shadow-card"
      style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
    >
      <div
        className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[13px] text-accent"
        style={{ background: 'var(--surface-nika)' }}
      >
        <IcDownload />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-serif text-[16px] lg:text-[18px] font-medium leading-tight text-ink-primary">
          Установить приложение
        </div>
        <div className="mt-1 text-[12.5px] leading-[1.45] text-ink-secondary">
          Добавь НИКУ на экран — она будет рядом.
        </div>
      </div>
    </Link>
  );
}
