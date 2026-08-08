import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Fraunces } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ServiceWorkerRegistration } from "@/components/install/ServiceWorkerRegistration";
import { IosInstallSheet } from "@/components/install/IosInstallSheet";
import { AndroidInstallBanner } from "@/components/install/AndroidInstallBanner";
import { NotificationPermissionPrompt } from "@/components/install/NotificationPermissionPrompt";
import { YandexMetrika } from "@/components/analytics/YandexMetrika";
import { GoogleAnalytics } from "@/components/analytics/GoogleAnalytics";
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

// maximum-scale=1 / user-scalable=false — гасит iOS-авто-зум при фокусе на
// input/textarea с шрифтом < 16px (наш дизайн намеренно мельче). Заодно снимает
// артефакт «замороженной» backdrop-blur панели (BottomNav) при этом зуме.
// На iOS ручной pinch-zoom по-прежнему доступен (система игнорирует запрет ради
// доступности); на Android — компромисс ради стабильного ввода в PWA.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Без cover в установленном PWA на iPhone с чёлкой iOS «письмецует» контент
  // (полосы сверху/снизу, приложение меньше экрана — выглядит как неверный
  // масштаб). Cover растягивает на весь экран и включает реальные
  // env(safe-area-inset-*), которыми пользуются pb-safe/pb-tabbar/pt-safe-top.
  viewportFit: "cover",
  // Клавиатура должна ужимать сам layout-вьюпорт, а не только видимую область.
  // С дефолтным resizes-visual 100dvh при открытой клавиатуре остаётся во весь
  // экран, поле ввода уезжает под неё, и браузер прокручивает страницу, чтобы
  // его показать. Chrome/Android это понимает; iOS директиву игнорирует —
  // там ту же работу делает KeyboardInsets через visualViewport.
  interactiveWidget: "resizes-content",
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
        {/* Аналитика: загрузка счётчиков + хит при клиентской навигации */}
        <YandexMetrika nonce={nonce} />
        <GoogleAnalytics nonce={nonce} />
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
