import Link from "next/link";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { createServerComponentClient } from "@/lib/supabase";

// Карточки 2×2
const CARDS = [
  {
    href: "/chat/morning",
    title: "Начать разговор",
    body: "Просто напиши — о чём угодно. Я отвечу.",
    warm: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
        <path d="M3 17V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-5 3v-3Z"
          stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "#",
    title: "Первая пробежка",
    body: "Я останусь рядом — буду писать в нужный момент.",
    warm: false,
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
        <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M11 7v4l2.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "#",
    title: "Что НИКА не делает",
    body: "Чтобы не было ложных ожиданий. Это важно.",
    warm: false,
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
        <path d="M5 4h12v14l-6-3-6 3V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "#",
    title: "Настройки",
    body: "Тон, когда писать первой, тёмная тема.",
    warm: false,
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
        <circle cx="11" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 19c.6-3.5 3.7-5 7-5s6.4 1.5 7 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default async function Day1Page() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let name = "друг";
  if (user) {
    const { data } = await supabase
      .from("users")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    if (data?.display_name?.trim()) {
      name = data.display_name.trim();
    }
  }

  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto max-w-lg px-5 pt-10 lg:pt-12">

          {/* Бейдж */}
          <div className="flex items-center gap-2 mb-4">
            <span className="h-[18px] w-[18px] flex-shrink-0 rounded-full bg-nika-avatar" />
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">
              День 1 · мы только познакомились
            </span>
          </div>

          {/* Заголовок */}
          <h1 className="font-serif text-[30px] font-normal leading-[1.2] tracking-[-0.02em] text-ink-primary mb-3">
            Привет, {name}.<br />
            <em className="italic text-accent">Я тут.</em>
          </h1>
          <p className="text-[14.5px] leading-[1.55] text-ink-secondary mb-8">
            Сегодня ничего не нужно делать. Ни бежать, ни планировать.
            Просто посмотри как я устроена — и приходи когда захочется.
          </p>

          {/* Сетка 2×2 */}
          <div className="grid grid-cols-2 gap-3">
            {CARDS.map((card) => (
              <Link
                key={card.title}
                href={card.href}
                className="group flex flex-col gap-3 rounded-card border p-4 transition-all"
                style={
                  card.warm
                    ? { background: "var(--surface-warm)", borderColor: "rgba(200,85,61,0.18)" }
                    : { background: "var(--bg-elevated)", borderColor: "var(--border-subtle)" }
                }
              >
                {/* Иконка */}
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-[12px] text-accent transition-colors"
                  style={
                    card.warm
                      ? { background: "rgba(255,255,255,0.5)" }
                      : { background: "var(--surface-nika)" }
                  }
                >
                  {card.icon}
                </div>

                {/* Текст */}
                <div>
                  <div className="font-serif text-[15px] font-medium leading-tight text-ink-primary mb-1">
                    {card.title}
                  </div>
                  <div className="text-[12px] leading-[1.4] text-ink-secondary">
                    {card.body}
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* Доп. сценарии */}
          <div className="mt-8 mb-2">
            <p className="font-serif text-[16px] font-medium text-ink-primary mb-0.5">
              Или выбери момент
            </p>
            <p className="text-[12px] text-ink-muted">С чем хочешь поговорить прямо сейчас?</p>
          </div>

          <div className="flex flex-col gap-2.5 pb-4">
            {[
              { href: "/chat/after_skip",   label: "После пропуска",   sub: "Когда сорвался с плана" },
              { href: "/chat/after_run",    label: "После пробежки",   sub: "Прожить и закрепить" },
              { href: "/chat/pre_race",     label: "Перед стартом",    sub: "Когда волнуешься" },
              { href: "/chat/after_failure",label: "После неудачи",    sub: "Травма или провал" },
            ].map(({ href, label, sub }) => (
              <Link
                key={href}
                href={href}
                className="group flex items-center gap-3 rounded-card border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3.5 transition-all hover:border-[var(--border-default)]"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-serif text-[14px] font-medium text-ink-primary">{label}</div>
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
