import { pluralConversations } from "@/lib/analytics";

export function PatternCard({ count, topWord }: { count: number; topWord?: string }) {
  return (
    <div>
      {topWord ? (
        <p className="text-base leading-relaxed text-ink-primary">
          Чаще всего звучало <em className="italic">«{topWord}»</em>.
        </p>
      ) : (
        <p className="text-base leading-relaxed text-ink-secondary">
          Наблюдения появятся, когда наберётся больше разговоров.
        </p>
      )}
      <p className="mt-2 text-sm text-ink-secondary">Просто факт. Я не делаю выводов — это твоё.</p>
      <p className="mt-3 text-xs text-ink-muted">
        {count} {pluralConversations(count)} · окно 14 дней
      </p>
    </div>
  );
}
