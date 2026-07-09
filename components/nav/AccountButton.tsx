import Link from "next/link";
import { PROFILE_HREF } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Иконка личного кабинета в шапке экрана. Стоит там, где раньше был
 * колокольчик: управление уведомлениями переехало внутрь аккаунта.
 */
export function AccountButton({ className }: { className?: string }) {
  return (
    <Link
      href={PROFILE_HREF}
      aria-label="Личный кабинет"
      className={cn(
        "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-surface-nika hover:text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="10" cy="7" r="3.2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 17c.7-3.2 3.3-4.6 6-4.6s5.3 1.4 6 4.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </Link>
  );
}
