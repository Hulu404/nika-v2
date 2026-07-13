import type { Platform } from '@/lib/hooks/usePwaInstall';
import Image from 'next/image';

interface Step {
  num: string;
  caption: string;
  img: string;
}

const IOS_STEPS: Step[] = [
  {
    num: '01',
    caption: 'Нажми на кнопку «Поделиться» внизу экрана Safari',
    img: '/images/pwa-install/ios-step-1-share.jpg',
  },
  {
    num: '02',
    caption: 'Пролистай список и выбери «Добавить на экран «Домой»»',
    img: '/images/pwa-install/ios-step-2-addtohome.jpg',
  },
  {
    num: '03',
    caption: 'Нажми «Добавить» в правом верхнем углу',
    img: '/images/pwa-install/ios-step-3-confirm.jpg',
  },
];

export function InstallInstructions({ platform }: { platform: Platform }) {
  if (platform === 'ios') {
    return (
      <ol className="space-y-6">
        {IOS_STEPS.map((step) => (
          <li key={step.num} className="flex flex-col gap-2">
            <div className="flex items-start gap-2.5">
              <span className="font-mono text-[11px] font-semibold text-[#C8553D] mt-0.5 shrink-0">{step.num}</span>
              <span className="text-[13px] text-[#1F1B16]/75 leading-snug">{step.caption}</span>
            </div>
            <div className="ml-[22px] overflow-hidden rounded-xl border border-[#E4D9C4]">
              <Image
                src={step.img}
                alt={step.caption}
                width={320}
                height={480}
                className="w-full max-w-[280px] object-cover"
                unoptimized
              />
            </div>
          </li>
        ))}
      </ol>
    );
  }

  if (platform === 'android') {
    return (
      <p className="text-[13px] text-[#1F1B16]/75 leading-relaxed">
        Нажми ⋮ в правом верхнем углу Chrome → «Установить приложение».
      </p>
    );
  }

  return (
    <p className="text-[13px] text-[#1F1B16]/75 leading-relaxed">
      Значок установки — в адресной строке браузера (значок монитора или ромба справа).
    </p>
  );
}
