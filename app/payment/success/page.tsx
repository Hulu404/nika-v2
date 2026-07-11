import Link from "next/link";

/**
 * UI-«витрина» после оплаты. Не источник истины: подписку активирует
 * Result URL (/api/robokassa/result), пользователь мог закрыть вкладку до
 * этого редиректа — доступ всё равно обновится.
 */
export default function PaymentSuccessPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <h1 className="font-serif text-[32px] font-normal tracking-[-0.02em] text-ink-primary">
        Оплата прошла
      </h1>
      <p className="max-w-[420px] text-[15px] leading-[1.55] text-ink-secondary">
        Подписка активирована. Если доступ ещё не обновился — обнови приложение
        или зайди заново через пару минут.
      </p>
      <Link
        href="/"
        className="mt-4 rounded-pill bg-ink-primary px-6 py-3 text-[14px] font-medium text-canvas transition-colors hover:bg-accent"
      >
        Вернуться в НИКА
      </Link>
    </main>
  );
}
