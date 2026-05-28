import type { Config } from "tailwindcss";

/**
 * Дизайн-система НИКИ.
 * Hex-значения здесь должны совпадать с CSS-переменными в app/globals.css.
 * Имена ключей подобраны так, чтобы утилиты читались естественно:
 *   bg-canvas, text-ink-primary, text-ink-secondary, text-ink-muted,
 *   bg-accent, bg-accent-deep, bg-surface-warm, bg-surface-nika.
 */
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
        canvas: "#FAF7F1",
        ink: {
          primary: "#1A1A1A",
          secondary: "#6B6560",
          muted: "#9A928A",
        },
        accent: {
          DEFAULT: "#C8553D",
          deep: "#9B3D28",
        },
        surface: {
          warm: "#F3EDE3",
          nika: "#F5E4DC",
        },
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Tiempos", "Georgia", "serif"],
        sans: ["var(--font-sans)", "Inter", "-apple-system", "sans-serif"],
        mono: ["var(--font-mono)", "SF Mono", "monospace"],
      },
      borderRadius: {
        card: "var(--radius-card)",
        bubble: "var(--radius-bubble)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        card: "0 1px 2px rgba(26, 26, 26, 0.04), 0 8px 24px rgba(26, 26, 26, 0.05)",
        soft: "0 1px 3px rgba(26, 26, 26, 0.06)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
