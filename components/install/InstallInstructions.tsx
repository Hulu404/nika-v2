import type { Platform } from '@/lib/hooks/usePwaInstall';

const IOS_STEPS = [
  'Открой именно Safari — в Chrome эта функция недоступна',
  'Нажми кнопку «Поделиться» внизу экрана — прямоугольник со стрелкой вверх',
  'Пролистай список вниз и выбери «На экран "Домой"»',
  'Нажми «Добавить» в правом верхнем углу',
];

export function InstallInstructions({ platform }: { platform: Platform }) {
  if (platform === 'ios') {
    return (
      <ol className="space-y-5">
        {IOS_STEPS.map((step, i) => (
          <li key={i} className="flex gap-3.5">
            <span className="flex-shrink-0 font-mono text-[11px] font-semibold text-accent mt-[3px]">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="text-[14px] leading-[1.55] text-ink-secondary">{step}</span>
          </li>
        ))}
      </ol>
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
            <span className="flex-shrink-0 font-mono text-[11px] font-semibold text-accent mt-[3px]">
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
