import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Role } from "@/types/conversation";

export function MessageBubble({
  role,
  children,
}: {
  role: Role;
  children: ReactNode;
}) {
  const isNika = role === "assistant";
  return (
    <div className={cn("flex", isNika ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[78%] whitespace-pre-wrap break-words px-4 py-3 text-[15.5px] leading-relaxed",
          isNika
            ? // НИКА: тёплый фон, серифный шрифт, скруглён снизу-слева меньше
              "rounded-bubble rounded-bl-[6px] bg-surface-nika font-serif text-[16px] tracking-[-0.005em] text-ink-primary"
            : // Пользователь: тёмный фон, санс, скруглён снизу-справа меньше
              "rounded-bubble rounded-br-[6px] bg-bubble-bg text-bubble-fg",
        )}
      >
        {children}
      </div>
    </div>
  );
}
