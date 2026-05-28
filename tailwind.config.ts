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
        // Основной фон (страница / iPhone-экран в прототипе)
        canvas: "#FAF7F1",
        // Фон канваса прототипа — используется для боковой панели на десктопе
        "canvas-outer": "#EFE7D7",
        // Поднятые поверхности (инпуты, карточки)
        elevated: "#FFFCF6",
        ink: {
          primary: "#1F1B16",
          secondary: "#5C534A",
          muted: "#9A9085",
          faint: "#C2B7A6",
        },
        accent: {
          DEFAULT: "#C8553D",
          deep: "#B0392A",
          soft: "#E8B7A8",
        },
        surface: {
          warm: "#F4E4D6",
          nika: "#F4EFE6",
          deep: "#E9DFCB",
        },
        // Цвета рамок (border-*)
        line: {
          subtle: "#EFE9DD",
          default: "#E5DDD0",
          strong: "#D4C9B5",
        },
        // Пузыри пользователя
        bubble: {
          bg: "#1F1B16",
          fg: "#FAF7F1",
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
