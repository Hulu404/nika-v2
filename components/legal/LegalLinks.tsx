// Тексты документов живут на /legal/*, здесь только ссылки: так шторка не расходится с сайтом.

const DOCS = [
  { href: "/legal/privacy", title: "Политика обработки персональных данных", hint: "Какие данные, кому передаём, сроки и ваши права" },
  { href: "/legal/consent", title: "Согласие на обработку персональных данных", hint: "Что именно вы разрешаете, включая сведения о здоровье" },
  { href: "/legal/oferta", title: "Публичная оферта", hint: "Тарифы, оплата, отказ и возврат средств" },
] as const;

interface Props {
  onClose: () => void;
}

export function LegalLinks({ onClose }: Props) {
  return (
    <div>
      <p className="text-[14px] leading-[1.6] text-ink-secondary">
        Актуальные тексты открываются на сайте, в новой вкладке. Редакция от 30.09.2026.
      </p>
      <div className="mt-4 flex flex-col gap-2.5">
        {DOCS.map((d) => (
          <a
            key={d.href}
            href={d.href}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-3 rounded-[14px] border border-line-default bg-canvas px-4 py-4 transition-colors hover:border-accent/40"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[15px] text-ink-primary">{d.title}</p>
              <p className="mt-0.5 text-[12px] text-ink-muted">{d.hint}</p>
            </div>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="flex-shrink-0 text-ink-faint">
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        ))}
      </div>
      <button
        onClick={onClose}
        className="mt-6 w-full rounded-pill border border-line-default py-[13px] text-[14px] font-medium text-ink-secondary transition-colors hover:border-line-strong"
      >
        Закрыть
      </button>
    </div>
  );
}
