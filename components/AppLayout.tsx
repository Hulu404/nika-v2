import { Sidebar } from "@/components/Sidebar";
import { BottomNav } from "@/components/BottomNav";

interface AppLayoutProps {
  children: React.ReactNode;
  /** Скрыть мобильный BottomNav (например, на странице чата) */
  hideBottomNav?: boolean;
}

/**
 * Основной макет приложения: сайдбар (десктоп) + контент + BottomNav (мобайл).
 * Оборачивает все страницы, которым нужна навигация.
 */
export function AppLayout({ children, hideBottomNav }: AppLayoutProps) {
  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--bg-primary)]">
      <Sidebar />

      {/* Основная область контента */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {children}
      </div>

      {!hideBottomNav && <BottomNav />}
    </div>
  );
}
