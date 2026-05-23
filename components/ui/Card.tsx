import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-card bg-surface-warm p-6 shadow-card",
        className,
      )}
      {...props}
    />
  );
}
