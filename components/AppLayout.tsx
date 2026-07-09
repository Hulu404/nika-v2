import { BottomNavData } from "@/components/BottomNavData";
import { AppHeader } from "@/components/nav/AppHeader";
import { PageTransition } from "@/components/PageTransition";
import { LockBodyScroll } from "@/components/LockBodyScroll";
import { createServerComponentClient } from "@/lib/supabase";

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
  /** Скрыть общую шапку (тот же механизм для полноэкранных экранов) */
  hideHeader?: boolean;
}

/**
 * Основной макет приложения: сайдбар (десктоп) + шапка + контент +
 * таб-бар (мобайл). Оборачивает все страницы после логина, поэтому шапка и бар
 * автоматически есть везде.
 */
export async function AppLayout({ children, sidebarSlot, hideTabBar, hideHeader }: AppLayoutProps) {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName: string | null = null;
  if (user) {
    const { data } = await supabase
      .from("users")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    displayName = data?.display_name ?? null;
  }

  // Колонки avatar_url в БД нет: единственный источник фото — метаданные Auth
  // (заполняются OAuth-провайдерами; при входе по паролю их нет).
  const meta = user?.user_metadata as { avatar_url?: string; picture?: string } | undefined;
  const avatarUrl = meta?.avatar_url ?? meta?.picture ?? null;

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--bg-primary)]">
      <LockBodyScroll />
      {sidebarSlot}

      {/* Шапка + основная область контента */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!hideHeader && (
          <AppHeader displayName={displayName} avatarUrl={avatarUrl} isAuthed={!!user} />
        )}
        <PageTransition>{children}</PageTransition>
      </div>

      {!hideTabBar && <BottomNavData />}
    </div>
  );
}
