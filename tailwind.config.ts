import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Все токены ссылаются на CSS-переменные из globals.css, которые
        // переключаются классом html.dark — поэтому text-ink-primary,
        // bg-surface-warm и т.п. автоматически theme-aware.
        canvas: "var(--bg-primary)",
        "canvas-outer": "var(--bg-canvas)",
        elevated: "var(--bg-elevated)",
        ink: {
          primary: "var(--ink-primary)",
          secondary: "var(--ink-secondary)",
          muted: "var(--ink-muted)",
          faint: "var(--ink-faint)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          deep: "var(--accent-deep)",
          soft: "var(--accent-soft)",
        },
        surface: {
          warm: "var(--surface-warm)",
          nika: "var(--surface-nika)",
          deep: "var(--surface-deep)",
        },
        // Цвета рамок (border-*)
        line: {
          subtle: "var(--border-subtle)",
          default: "var(--border-default)",
          strong: "var(--border-strong)",
        },
        // Пузыри пользователя
        bubble: {
          bg: "var(--user-bubble-bg)",
          fg: "var(--user-bubble-fg)",
        },
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Fraunces", "Georgia", "serif"],
        sans: ["var(--font-sans)", "Geist", "Inter", "-apple-system", "sans-serif"],
        mono: ["var(--font-mono)", "Geist Mono", "SF Mono", "monospace"],
      },
      borderRadius: {
        card: "16px",
        bubble: "18px",
        pill: "999px",
        input: "14px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(31,27,22,0.04), 0 8px 24px rgba(31,27,22,0.06)",
        soft: "0 1px 3px rgba(31,27,22,0.06)",
      },
      backgroundImage: {
        "canvas-gradient":
          "radial-gradient(circle at 20% 0%, rgba(200,85,61,0.05), transparent 40%), radial-gradient(circle at 80% 100%, rgba(31,27,22,0.04), transparent 40%)",
        "nika-avatar":
          "linear-gradient(135deg, #F4E4D6 0%, #E8B7A8 60%, #C8553D 130%)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
      },
      spacing: {
        safe: "env(safe-area-inset-bottom, 0px)",
      },
    },
  },
  plugins: [],
};

export default config;
