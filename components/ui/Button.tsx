import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "outline";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Скруглить в «таблетку» (radius-pill) вместо radius-card. */
  pill?: boolean;
}

const variantStyles: Record<Variant, string> = {
  primary: "bg-accent text-canvas hover:bg-accent-deep",
  ghost: "bg-transparent text-ink-primary hover:bg-surface-warm",
  outline:
    "border border-ink-muted/40 text-ink-primary hover:bg-surface-warm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", pill = false, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        pill ? "rounded-pill" : "rounded-card",
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  ),
);

Button.displayName = "Button";
