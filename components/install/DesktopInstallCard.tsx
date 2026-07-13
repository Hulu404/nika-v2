'use client';

import { usePwaInstall } from '@/lib/hooks/usePwaInstall';
import { useInstallBannerVisibility } from '@/lib/hooks/useInstallBannerVisibility';

export function DesktopInstallCard({ readyToShow }: { readyToShow: boolean }) {
  const { platform, isStandalone, canPromptNative, promptInstall } = usePwaInstall();
  const { visible, dismiss } = useInstallBannerVisibility(readyToShow);

  if (platform !== 'desktop' || isStandalone || !visible) return null;

  return (
    <div className="mx-3 mb-2 rounded-xl border border-[#E4D9C4] bg-[#FAF7F1] p-3.5">
      <p className="font-serif text-[14px] text-[#1F1B16] leading-snug mb-1">
        Хочешь, чтобы я была под рукой?
      </p>
      <p className="text-[12px] text-[#1F1B16]/60 leading-relaxed mb-3">
        Установи НИКУ как приложение — открывается в один клик.
      </p>
      <div className="flex items-center gap-2">
        {canPromptNative ? (
          <button
            onClick={promptInstall}
            className="rounded-lg bg-[#C8553D] px-3 py-1.5 text-[12px] font-medium text-white transition hover:opacity-90"
          >
            Установить
          </button>
        ) : (
          <span className="text-[11px] text-[#1F1B16]/45">
            Значок установки — в адресной строке браузера
          </span>
        )}
        <button
          onClick={dismiss}
          className="px-2 py-1.5 text-[12px] text-[#1F1B16]/50 transition hover:text-[#1F1B16]/80"
        >
          Не сейчас
        </button>
      </div>
    </div>
  );
}
