import type { Platform } from '@/lib/hooks/usePwaInstall';
import Image from 'next/image';

interface Step {
  num: string;
  caption: string;
  img?: string;
}

const IOS_STEPS: Step[] = [
  {
    num: '01',
    caption: 'Нажми на кнопку «Поделиться» внизу экрана Safari — прямоугольник со стрелкой вверх',
    img: '/images/pwa-install/ios-step-1-share.jpg',
  },
  {
    num: '02',
    caption: 'Пролистай список вниз и выбери «На экран «Домой»»',
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
      <div>
        <p className="mb-5 text-[13px] text-ink-muted">
          Открой эту страницу именно в Safari — в Chrome «Добавить на экран» недоступно.
        </p>
        <ol className="space-y-7">
          {IOS_STEPS.map((step) => (
            <li key={step.num} className="flex flex-col gap-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-[2px] shrink-0 font-mono text-[11px] font-semibold text-accent">
                  {step.num}
                </span>
                <span className="text-[14px] leading-[1.55] text-ink-secondary">{step.caption}</span>
              </div>
              {step.img && (
                <div className="ml-[22px] overflow-hidden rounded-xl">
                  <Image
                    src={step.img}
                    alt={step.caption}
                    width={320}
                    height={480}
                    className="w-full max-w-[280px] object-cover"
                    unoptimized
                  />
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (platform === 'android') {
    return (
      <ol className="space-y-5">
        {[
          'Открой Chrome',
          'Нажми ⋮ в правом верхнем углу',
          'Выбери «Установить приложение» или «Добавить на главный экран»',
        ].map((step, i) => (
          <li key={i} className="flex gap-3.5">
            <span className="mt-[3px] shrink-0 font-mono text-[11px] font-semibold text-accent">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="text-[14px] leading-[1.55] text-ink-secondary">{step}</span>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <p className="text-[14px] leading-relaxed text-ink-secondary">
      Значок установки — в адресной строке браузера справа (значок монитора или ромба).
    </p>
  );
}
