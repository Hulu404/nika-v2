import Link from "next/link";
import { redirect } from "next/navigation";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { Day1InstallCard } from "@/components/onboarding/Day1InstallCard";
import { createServerComponentClient } from "@/lib/supabase";

// ── Иконки карточек ───────────────────────────────────────────────────────────

function IcChat() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H10l-4 4v-4H5a1 1 0 0 1-1-1V5Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
function IcClock() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function IcManifesto() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 4h14v16l-7-3.5L5 20V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ── Страница ─────────────────────────────────────────────────────────────────

export default async function Day1Page() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let name = "друг";
  let isDay1 = true;
  let hasConversations = false;

  if (user) {
    const [{ data: userData }, { data: convData }] = await Promise.all([
      supabase
        .from("users")
        .select("display_name, created_at")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("conversations")
        .select("id")
        .eq("user_id", user.id)
        .limit(1),
    ]);

    if (userData?.display_name?.trim()) name = userData.display_name.trim();

    if (userData?.created_at) {
      const hoursSince = (Date.now() - new Date(userData.created_at).getTime()) / (1000 * 60 * 60);
      isDay1 = hoursSince < 24;
    }

    hasConversations = (convData?.length ?? 0) > 0;

    // Пользователи старше 24 часов попадают сюда только в первый день,
    // иначе их место на /today.
    if (!isDay1) redirect("/today");
  }

  // Карточки 2×2 (первые 3 — статичные, 4-я — Day1InstallCard, клиентская)
  const STATIC_CARDS = [
    {
      href: "/chat/morning",
      title: "Начать разговор",
      body: "Просто напиши — о чём угодно. Я отвечу.",
      warm: true,
      icon: <IcChat />,
    },
    {
      href: "/journal",
      title: "Первая пробежка",
      body: "Я останусь рядом. Не буду подгонять.",
      warm: false,
      icon: <IcClock />,
    },
    {
      href: "/manifesto",
      title: "Что НИКА не делает",
      body: "Чтобы не было ложных ожиданий. Это важно.",
      warm: false,
      icon: <IcManifesto />,
    },
  ];

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto w-full max-w-[680px] px-5 pt-10 lg:pt-14 xl:max-w-[900px] xl:px-8 2xl:max-w-[1120px] 2xl:px-10">

          {/* Бейдж (только день 1) */}
          {isDay1 && (
            <div className="flex items-center gap-2 mb-5">
              <span className="h-[18px] w-[18px] flex-shrink-0 rounded-full bg-nika-avatar" />
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">
                День 1 · мы только познакомились
              </span>
            </div>
          )}

          {/* Заголовок */}
          <h1 className="font-serif text-[44px] lg:text-[52px] font-normal leading-[1.1] tracking-[-0.03em] text-ink-primary mb-4">
            Привет, {name}.<br />
            <em className="italic text-accent">Я тут.</em>
          </h1>
          <p className="text-[15px] leading-[1.6] text-ink-secondary mb-8">
            {isDay1 && !hasConversations
              ? "Сегодня ничего не нужно делать. Ни бежать, ни планировать. Просто посмотри как я устроена — и приходи когда захочется."
              : "Выбери момент — я рядом."}
          </p>

          {/* Карточки 2×2 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            {STATIC_CARDS.map((card) => (
              <Link
                key={card.title}
                href={card.href}
                className="group flex items-center gap-4 rounded-[18px] border px-5 py-4 text-left transition-all hover:shadow-card"
                style={
                  card.warm
                    ? { background: "var(--surface-warm)", borderColor: "rgba(200,85,61,0.18)" }
                    : { background: "var(--bg-elevated)", borderColor: "var(--border-subtle)" }
                }
              >
                <div
                  className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[13px] text-accent transition-colors"
                  style={
                    card.warm
                      ? { background: "rgba(255,255,255,0.5)" }
                      : { background: "var(--surface-nika)" }
                  }
                >
                  {card.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-serif text-[16px] lg:text-[18px] font-medium leading-tight text-ink-primary">
                    {card.title}
                  </div>
                  <div className="mt-1 text-[12.5px] leading-[1.45] text-ink-secondary">
                    {card.body}
                  </div>
                </div>
              </Link>
            ))}
            {/* 4-я карточка: установка PWA (или «Настройки» если уже установлено) */}
            <Day1InstallCard />
          </div>

          {/* Доп. сценарии */}
          <div className="mt-10 mb-3">
            <p className="font-serif text-[18px] font-medium text-ink-primary mb-1">
              Или выбери момент
            </p>
            <p className="text-[13px] text-ink-muted">С чем хочешь поговорить прямо сейчас?</p>
          </div>

          <div className="flex flex-col gap-2.5 pb-4">
            {[
              { href: "/chat/after_skip",    label: "После пропуска",  sub: "Когда сорвался с плана" },
              { href: "/chat/after_run",     label: "После пробежки",  sub: "Прожить и закрепить" },
              { href: "/chat/pre_race",      label: "Перед стартом",   sub: "Когда волнуешься" },
              { href: "/chat/after_failure", label: "После неудачи",   sub: "Травма или провал" },
            ].map(({ href, label, sub }) => (
              <Link
                key={href}
                href={href}
                className="group flex items-center gap-3 rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-4 transition-all hover:border-[var(--border-default)] hover:shadow-soft"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-serif text-[15px] font-medium text-ink-primary">{label}</div>
                  <div className="text-[12px] text-ink-secondary">{sub}</div>
                </div>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-ink-faint flex-shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden>
                  <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            ))}
          </div>

        </div>
      </div>
    </AppLayout>
  );
}
