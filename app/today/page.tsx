import Link from "next/link";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { createServerComponentClient } from "@/lib/supabase";
import { SCENARIO_META, SCENARIO_ORDER } from "@/lib/scenarios";

export default async function TodayPage() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let name = "друг";
  let daysSince = 0;

  if (user) {
    const { data: userData } = await supabase
      .from("users")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    if (userData?.display_name?.trim()) name = userData.display_name.trim();
    daysSince = Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86_400_000);
  }

  const scenariosHeading = daysSince > 1 ? "О чём поговорим?" : "С чем поговорим?";

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto w-full max-w-[680px] px-5 pt-10 lg:pt-14">

          {/* Заголовок */}
          <h1 className="font-serif text-[40px] lg:text-[52px] font-normal leading-[1.1] tracking-[-0.03em] text-ink-primary mb-2">
            Привет, {name}.
          </h1>
          <p className="mb-10 text-[15px] leading-[1.6] text-ink-secondary">
            Выбери момент — я рядом.
          </p>

          {/* Сценарии */}
          <p className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.15em] text-ink-muted">
            {scenariosHeading}
          </p>

          <div className="flex flex-col gap-2">
            {SCENARIO_ORDER.map((key) => {
              const meta = SCENARIO_META[key];
              return (
                <Link
                  key={key}
                  href={`/chat/${key}`}
                  className="group flex items-center gap-3 rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-5 py-4 transition-all hover:border-[var(--border-default)] hover:shadow-soft"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-serif text-[15px] font-medium text-ink-primary">
                      {meta.title}
                    </div>
                    <div className="text-[12px] text-ink-secondary mt-0.5">
                      {meta.subtitle}
                    </div>
                  </div>
                  <svg
                    width="14" height="14" viewBox="0 0 14 14" fill="none"
                    className="text-ink-faint flex-shrink-0 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  >
                    <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              );
            })}

            {/* Просто поговорить */}
            <Link
              href="/chat/general"
              className="group flex items-center gap-3 rounded-[14px] border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] px-5 py-4 transition-all hover:border-solid hover:border-[var(--border-strong)]"
            >
              <div className="flex-1 min-w-0">
                <div className="font-serif text-[15px] font-medium text-ink-muted">
                  Просто поговорить
                </div>
                <div className="text-[12px] text-ink-faint mt-0.5">
                  Без темы — просто написать
                </div>
              </div>
              <svg
                width="14" height="14" viewBox="0 0 14 14" fill="none"
                className="text-ink-faint flex-shrink-0 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              >
                <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>

          {/* Быстрые ссылки — только мобайл (на десктопе есть сайдбар) */}
          <div className="mt-8 grid grid-cols-3 gap-2.5 lg:hidden">
            {[
              { href: "/journal",   label: "Журнал",    icon: "📋" },
              { href: "/analytics", label: "Аналитика", icon: "📊" },
              { href: "/profile",   label: "Настройки", icon: "⚙️" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center gap-1.5 rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-4 text-center transition-all hover:border-[var(--border-default)]"
              >
                <span className="text-[20px]">{item.icon}</span>
                <span className="text-[12px] text-ink-secondary">{item.label}</span>
              </Link>
            ))}
          </div>

        </div>
      </div>
    </AppLayout>
  );
}
