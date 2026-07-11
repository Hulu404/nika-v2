import Link from "next/link";

export default function PaymentFailPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <h1 className="font-serif text-[32px] font-normal tracking-[-0.02em] text-ink-primary">
        Оплата не прошла
      </h1>
      <p className="max-w-[420px] text-[15px] leading-[1.55] text-ink-secondary">
        Деньги не списались. Можно попробовать ещё раз или выбрать другой способ
        оплаты.
      </p>
      <Link
        href="/upgrade"
        className="mt-4 rounded-pill bg-ink-primary px-6 py-3 text-[14px] font-medium text-canvas transition-colors hover:bg-accent"
      >
        Попробовать снова
      </Link>
    </main>
  );
}
