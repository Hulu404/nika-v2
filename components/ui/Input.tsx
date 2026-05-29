import { InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-card bg-surface-warm px-4 py-3 text-ink-primary outline-none transition placeholder:text-ink-muted focus:ring-2 focus:ring-[#C8553D]/40",
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";
