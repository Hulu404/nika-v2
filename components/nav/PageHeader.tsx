import Link from "next/link";
import { AccountButton } from "@/components/nav/AccountButton";
import { HOME_HREF } from "@/lib/nav";

/**
 * Шапка раздела. Видна на всех ширинах, поэтому вернуться на Главную можно
 * из любого экрана и на мобайле, и на десктопе.
 * Слева эмблема (аватар + заголовок раздела) — ссылка на Главную,
 * справа кнопка личного кабинета.
 */
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-line-default bg-[var(--bg-blur)] px-4 py-2 backdrop-blur-[16px] lg:px-8">
      {/* Обёртка держит ширину, а сама ссылка обнимает содержимое — иначе
          подсветка при наведении растягивалась бы на всю шапку. */}
      <div className="min-w-0 flex-1">
        <Link
          href={HOME_HREF}
          aria-label="На главную"
          className="inline-flex min-h-[44px] max-w-full items-center gap-3 rounded-pill pl-1 pr-3 transition-colors hover:bg-surface-nika focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="relative h-9 w-9 flex-shrink-0 rounded-full bg-nika-avatar" aria-hidden>
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-primary)] bg-[#7BA968]" />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-serif text-[17px] font-medium tracking-[-0.01em] text-ink-primary">
              {title}
            </span>
            {subtitle && (
              <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">{subtitle}</span>
            )}
          </span>
        </Link>
      </div>

      <AccountButton />
    </header>
  );
}
