import type { Metadata } from "next";
import { headers } from "next/headers";
import { Fraunces } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ServiceWorkerRegistration } from "@/components/install/ServiceWorkerRegistration";
import { IosInstallSheet } from "@/components/install/IosInstallSheet";
import { AndroidInstallBanner } from "@/components/install/AndroidInstallBanner";
import { NotificationPermissionPrompt } from "@/components/install/NotificationPermissionPrompt";
import { YandexMetrika } from "@/components/analytics/YandexMetrika";
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
  // nonce из middleware (CSP). На страницах вне matcher'а middleware его нет —
  // тогда undefined, и скрипт рендерится без nonce (там и CSP не выставляется).
  const nonce = headers().get("x-nonce") ?? undefined;

  return (
    <html
      lang="ru"
      className={`${serif.variable} ${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content="#C8553D" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="НИКА" />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: darkModeScript }} />
      </head>
      <body className="min-h-screen text-ink-primary antialiased">
        {/* Yandex.Metrika: загрузка счётчика + hit при клиентской навигации */}
        <YandexMetrika nonce={nonce} />
        {children}
        {/* PWA: регистрация SW и глобальные install-баннеры */}
        <ServiceWorkerRegistration />
        <IosInstallSheet readyToShow={true} />
        <AndroidInstallBanner readyToShow={true} />
        <NotificationPermissionPrompt />
      </body>
    </html>
  );
}
