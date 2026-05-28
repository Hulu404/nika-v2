import type { Metadata } from "next";
import { Cormorant_Garamond } from "next/font/google";
// Geist отсутствует в next/font/google для Next.js 14 — используем
// официальный пакет Vercel. Он экспортирует --font-geist-sans / --font-geist-mono,
// которые мы связываем с дизайн-токенами --font-sans / --font-mono в globals.css.
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { UserMenu } from "@/components/UserMenu";
import "./globals.css";

// Серифный заголовочный шрифт.
const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "НИКА — ментальный ассистент для бегунов",
  description:
    "НИКА помогает бегунам-любителям не бросить бег. Тёплый собеседник, а не тренер.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ru"
      className={`${serif.variable} ${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="min-h-screen bg-canvas text-ink-primary antialiased">
        <UserMenu />
        {children}
      </body>
    </html>
  );
}
