import { BottomNavData } from "@/components/BottomNavData";
import { PageTransition } from "@/components/PageTransition";
import { LockBodyScroll } from "@/components/LockBodyScroll";

interface AppLayoutProps {
  children: React.ReactNode;
  /** Сайдбар (десктоп). Обычно <SidebarData /> — серверный враппер с данными. */
  sidebarSlot?: React.ReactNode;
  /**
   * Скрыть мобильный таб-бар. По умолчанию бар виден во всех разделах и их
   * вложенных экранах (включая чат-тред). Выставляют только экраны, которым
   * бар мешает: например будущий полноэкранный плеер медитации.
   */
  hideTabBar?: boolean;
}

/**
 * Основной макет приложения: сайдбар (десктоп) + контент + таб-бар (мобайл).
 * Отдельной общей шапки нет: у каждого экрана своя, слева эмблема-заголовок
 * (ведёт на Главную), справа AccountButton.
 */
export function AppLayout({ children, sidebarSlot, hideTabBar }: AppLayoutProps) {
  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--bg-primary)]">
      <LockBodyScroll />
      {sidebarSlot}

      {/* Основная область контента */}
      <div className="flex min-w-0 flex-1 flex-col">
        <PageTransition>{children}</PageTransition>
      </div>

      {!hideTabBar && <BottomNavData />}
    </div>
  );
}
