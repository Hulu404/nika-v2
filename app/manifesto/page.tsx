import Link from "next/link";
import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";

const ITEMS = [
  {
    title: "НИКА не тренер",
    body: "Я не составляю планы тренировок, не контролирую пульс и темп, не даю советов по технике бега.",
  },
  {
    title: "НИКА не психолог",
    body: "Я не ставлю диагнозы и не заменяю специалиста. Если тебе тяжело — я рядом, но серьёзные вещи требуют реальной помощи.",
  },
  {
    title: "НИКА не судья",
    body: "Я не оцениваю твои результаты, не сравниваю тебя с другими и не говорю «ты должен был».",
  },
  {
    title: "НИКА не спамит",
    body: "Я не пишу каждый день, если ты не просил. Только тогда, когда ты сам задал расписание.",
  },
  {
    title: "НИКА не знает всего о тебе",
    body: "Я работаю на основе того, что ты пишешь. Никаких данных с внешних устройств пока нет.",
  },
];

export default function ManifestoPage() {
  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10">
        <div className="mx-auto max-w-lg px-5 pb-12 pt-10 lg:pt-14">

          {/* Назад */}
          <Link
            href="/day1"
            className="inline-flex items-center gap-1.5 mb-8 text-[13px] text-ink-secondary transition-colors hover:text-ink-primary"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M10 3L6 8l4 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Назад
          </Link>

          {/* Заголовок */}
          <h1 className="font-serif text-[40px] font-normal leading-[1.1] tracking-[-0.025em] text-ink-primary mb-4">
            Что НИКА<br />
            <em className="italic text-accent">не делает</em>
          </h1>
          <p className="mb-10 text-[15px] leading-[1.6] text-ink-secondary">
            Честно — чтобы не было ложных ожиданий. Это важно.
          </p>

          {/* Список */}
          <div className="flex flex-col gap-4">
            {ITEMS.map((item) => (
              <div
                key={item.title}
                className="rounded-[16px] border border-line-default bg-elevated px-6 py-5"
              >
                <p className="font-serif text-[17px] font-medium text-ink-primary mb-2">
                  {item.title}
                </p>
                <p className="text-[14px] leading-[1.6] text-ink-secondary">
                  {item.body}
                </p>
              </div>
            ))}
          </div>

          {/* Итог */}
          <div className="mt-10 rounded-[16px] bg-surface-warm px-6 py-5">
            <p className="font-serif text-[17px] font-medium text-ink-primary mb-2">
              Зачем тогда НИКА?
            </p>
            <p className="text-[14px] leading-[1.6] text-ink-secondary">
              Чтобы ты не бросил. Я рядом — слушаю, не осуждаю,
              помогаю пережить трудный момент и вернуться к бегу.
            </p>
          </div>

        </div>
      </div>
    </AppLayout>
  );
}
