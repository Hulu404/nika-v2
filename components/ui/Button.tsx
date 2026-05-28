import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "outline";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  pill?: boolean;
}

const variantStyles: Record<Variant, string> = {
  primary: "bg-ink-primary text-canvas hover:bg-accent active:scale-95",
  ghost: "bg-transparent text-ink-primary hover:bg-surface-nika",
  outline: "border border-line-default text-ink-primary hover:bg-surface-nika",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", pill = false, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50",
        pill ? "rounded-pill" : "rounded-card",
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  ),
);

Button.displayName = "Button";
