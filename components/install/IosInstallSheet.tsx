'use client';

import { useState } from 'react';
import { usePwaInstall } from '@/lib/hooks/usePwaInstall';
import { useInstallBannerVisibility } from '@/lib/hooks/useInstallBannerVisibility';
import { InstallInstructions } from './InstallInstructions';

export function IosInstallSheet({ readyToShow }: { readyToShow: boolean }) {
  const { platform, isStandalone, isInAppBrowser } = usePwaInstall();
  const { visible, dismiss } = useInstallBannerVisibility(readyToShow);
  const [expanded, setExpanded] = useState(false);

  if (platform !== 'ios' || isStandalone || !visible) return null;

  if (isInAppBrowser) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-[#1F1B16] p-5 text-[#FAF7F1]">
        <p className="mb-1 text-[14px] leading-snug">
          Открой эту ссылку в Safari — из Instagram/TikTok установить меня на экран нельзя.
        </p>
        <p className="text-[12px] text-[#FAF7F1]/60">
          Нажми ⋯ в правом верхнем углу → «Открыть в браузере»
        </p>
        <button onClick={dismiss} className="mt-3 text-[12px] text-[#FAF7F1]/50 underline">
          Понятно
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-[#FAF7F1] p-5 shadow-[0_-4px_24px_rgba(0,0,0,0.12)]">
      {!expanded ? (
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="font-serif text-[15px] text-[#1F1B16]">Останусь у тебя на экране?</p>
            <p className="mt-0.5 text-[12px] text-[#1F1B16]/55">30 секунд — и я всегда рядом</p>
          </div>
          <button
            onClick={() => setExpanded(true)}
            className="whitespace-nowrap rounded-lg bg-[#C8553D] px-3 py-2 text-[13px] font-medium text-white"
          >
            Как?
          </button>
          <button onClick={dismiss} className="text-[16px] leading-none text-[#1F1B16]/35">
            ×
          </button>
        </div>
      ) : (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="font-serif text-[15px] text-[#1F1B16]">Три шага</p>
            <button onClick={dismiss} className="text-[16px] leading-none text-[#1F1B16]/35">×</button>
          </div>
          <div className="mt-4 max-h-[60vh] overflow-y-auto">
            <InstallInstructions platform="ios" />
          </div>
          <button onClick={dismiss} className="mt-5 text-[12px] text-[#1F1B16]/45 underline">
            Позже
          </button>
        </div>
      )}
    </div>
  );
}
