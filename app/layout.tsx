import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const serif = Fraunces({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "НИКА — ментальный ассистент для бегунов",
  description: "НИКА помогает бегунам-любителям не бросить бег. Тёплый собеседник, а не тренер.",
};

// Скрипт запускается до рендера — предотвращает мигание при смене темы.
const darkModeScript = `(function(){
  var t = localStorage.getItem('nika-theme');
  var p = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (t === 'dark' || (!t && p)) document.documentElement.classList.add('dark');
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${serif.variable} ${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: darkModeScript }} />
      </head>
      <body className="min-h-screen text-ink-primary antialiased">
        {children}
      </body>
    </html>
  );
}
