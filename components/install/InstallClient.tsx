'use client';

import { InstallInstructions } from '@/components/install/InstallInstructions';
import { usePwaInstall } from '@/lib/hooks/usePwaInstall';

export function InstallClient() {
  const { platform, isStandalone, canPromptNative, promptInstall } = usePwaInstall();

  if (isStandalone) {
    return (
      <div
        className="rounded-2xl border p-6 text-center"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
      >
        <p className="font-serif text-[20px] text-ink-primary mb-2">Уже установлено</p>
        <p className="text-[14px] text-ink-secondary">
          НИКА уже у тебя на экране — просто открой приложение.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-accent">
        Как установить
      </p>
      <h1 className="mb-6 font-serif text-[26px] leading-[1.25] tracking-[-0.01em] text-ink-primary">
        Добавь НИКУ на экран — она всегда будет рядом.
      </h1>

      {platform === 'android' && canPromptNative && (
        <button
          onClick={promptInstall}
          className="mb-6 w-full rounded-full bg-[#C8553D] py-3.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          Установить приложение
        </button>
      )}

      <InstallInstructions platform={platform} />
    </>
  );
}
