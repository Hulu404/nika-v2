'use client';

import { usePwaInstall } from '@/lib/hooks/usePwaInstall';
import { useInstallBannerVisibility } from '@/lib/hooks/useInstallBannerVisibility';

export function AndroidInstallBanner({ readyToShow }: { readyToShow: boolean }) {
  const { platform, isStandalone, isInAppBrowser, canPromptNative, promptInstall } = usePwaInstall();
  const { visible, dismiss } = useInstallBannerVisibility(readyToShow);

  if (platform !== 'android' || isStandalone || !visible) return null;

  if (isInAppBrowser) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 rounded-2xl bg-[#1F1B16] p-4 text-[#FAF7F1] shadow-lg">
        <p className="mb-2 text-[14px] leading-snug">
          Открой эту страницу в Chrome — тогда смогу остаться у тебя на экране.
        </p>
        <p className="text-[12px] text-[#FAF7F1]/60">Нажми ⋮ в углу и выбери «Открыть в браузере»</p>
        <button onClick={dismiss} className="mt-2 text-[12px] text-[#FAF7F1]/50 underline">
          Понятно
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 flex items-center gap-3 rounded-2xl bg-[#1F1B16] p-4 text-[#FAF7F1] shadow-lg">
      <div className="flex-1">
        <p className="text-[14px] leading-snug">Останусь у тебя на экране?</p>
        <p className="mt-0.5 text-[12px] text-[#FAF7F1]/60">Один тап — и я всегда под рукой</p>
      </div>
      {canPromptNative && (
        <button
          onClick={promptInstall}
          className="whitespace-nowrap rounded-lg bg-[#C8553D] px-3 py-2 text-[13px] font-medium text-white"
        >
          Установить
        </button>
      )}
      <button onClick={dismiss} className="text-[16px] leading-none text-[#FAF7F1]/40">
        ×
      </button>
    </div>
  );
}
