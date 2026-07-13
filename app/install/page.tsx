'use client';

import { AppLayout } from '@/components/AppLayout';
import { SidebarData } from '@/components/SidebarData';
import { PageHeader } from '@/components/nav/PageHeader';
import { InstallInstructions } from '@/components/install/InstallInstructions';
import { usePwaInstall } from '@/lib/hooks/usePwaInstall';

export default function InstallPage() {
  const { platform, isStandalone, canPromptNative, promptInstall } = usePwaInstall();

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <PageHeader title="Установить приложение" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[540px] px-5 pb-16 pt-8">

          {isStandalone ? (
            <div className="rounded-2xl border border-[#E4D9C4] bg-[#FAF7F1] p-6 text-center">
              <p className="font-serif text-[20px] text-[#1F1B16] mb-2">Уже установлено</p>
              <p className="text-[14px] text-[#1F1B16]/60">
                НИКА уже у тебя на экране — просто открой приложение.
              </p>
            </div>
          ) : (
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
          )}

        </div>
      </div>
    </AppLayout>
  );
}
