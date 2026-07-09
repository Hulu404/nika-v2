import Link from "next/link";
import { HOME_HREF, PROFILE_HREF } from "@/lib/nav";

function SilhouetteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="9" cy="6.5" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 15.5c.5-2.8 2.9-4 5.5-4s5 1.2 5.5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

interface AppHeaderProps {
  /** users.display_name — из него берём инициал. */
  displayName?: string | null;
  /** Фото профиля (сейчас только из user_metadata Supabase Auth). */
  avatarUrl?: string | null;
  /** Гость — аватар-заглушка, тап ведёт на вход. */
  isAuthed?: boolean;
}

/**
 * Общая шапка приложения: логотип-ссылка на Главную слева, аватар-ссылка на
 * профиль справа. Зоны нажатия 44×44. Рендерится в AppLayout, поэтому есть на
 * всех экранах после логина.
 */
export function AppHeader({ displayName, avatarUrl, isAuthed = true }: AppHeaderProps) {
  const trimmed = (displayName ?? "").trim();
  // Первая буква имени; [...] корректно берёт символ, а не половину суррогатной пары.
  const initial = trimmed ? [...trimmed][0].toUpperCase() : "";
  const profileHref = isAuthed ? PROFILE_HREF : `/auth?next=${PROFILE_HREF}`;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line-default bg-canvas px-3">
      {/* Логотип: точка + вордмарк, ведёт на Главную */}
      <Link
        href={HOME_HREF}
        aria-label="На главную"
        className="-ml-1 flex h-11 min-w-[44px] items-center gap-2 rounded-pill px-2 transition-colors hover:bg-surface-nika focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="h-[26px] w-[26px] flex-shrink-0 rounded-full bg-nika-avatar" aria-hidden />
        <span className="font-serif text-[19px] font-medium tracking-[-0.01em] text-ink-primary">НИКА</span>
      </Link>

      {/* Аватар: фото → инициал → силуэт */}
      <Link
        href={profileHref}
        aria-label="Профиль"
        className="-mr-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-nika focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-line-default bg-surface-nika text-[14px] font-medium text-ink-secondary">
          {isAuthed && avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- внешний URL аватара, next/image потребовал бы конфиг доменов
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : isAuthed && initial ? (
            initial
          ) : (
            <SilhouetteIcon />
          )}
        </span>
      </Link>
    </header>
  );
}
