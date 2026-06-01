import { BottomNav } from "@/components/BottomNav";
import { PageTransition } from "@/components/PageTransition";
import { LockBodyScroll } from "@/components/LockBodyScroll";

interface AppLayoutProps {
  children: React.ReactNode;
  /** Сайдбар (десктоп). Обычно <SidebarData /> — серверный враппер с данными. */
  sidebarSlot?: React.ReactNode;
  /** Скрыть мобильный BottomNav (например, на странице чата) */
  hideBottomNav?: boolean;
}

/**
 * Основной макет приложения: сайдбар (десктоп) + контент + BottomNav (мобайл).
 * Оборачивает все страницы, которым нужна навигация.
 */
export function AppLayout({ children, sidebarSlot, hideBottomNav }: AppLayoutProps) {
  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--bg-primary)]">
      <LockBodyScroll />
      {sidebarSlot}

      {/* Основная область контента */}
      <PageTransition>
        {children}
      </PageTransition>

      {!hideBottomNav && <BottomNav />}
    </div>
  );
}
