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
          "max-w-[80%] whitespace-pre-wrap break-words rounded-bubble px-4 py-3 text-[15px] leading-relaxed",
          isNika
            ? "bg-surface-nika text-ink-primary"
            : "bg-accent text-canvas",
        )}
      >
        {children}
      </div>
    </div>
  );
}
