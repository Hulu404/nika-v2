import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Fraunces } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ServiceWorkerRegistration } from "@/components/install/ServiceWorkerRegistration";
import { IosInstallSheet } from "@/components/install/IosInstallSheet";
import { AndroidInstallBanner } from "@/components/install/AndroidInstallBanner";
import { NotificationPermissionPrompt } from "@/components/install/NotificationPermissionPrompt";
import { AnalyticsGate } from "@/components/analytics/AnalyticsGate";
import { CookieBanner } from "@/components/consent/CookieBanner";
import "./globals.css";

const serif = Fraunces({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.mynika.online"),
  title: "NIKA | YOU'LL NEVER MOVE ALONE",
  description:
    "НИКА учит слышать тело во время бега: утренний вопрос о самочувствии, практики дыхания в наушниках и разговор после пробежки.",
  applicationName: "NIKA",
  // Экраны приложения (вход, профиль и т. п.) в поиск не нужны: в выдаче только лендинг и документы
  robots: { index: false, follow: true },
  openGraph: {
    type: "website",
    siteName: "NIKA",
    locale: "ru_RU",
    title: "NIKA | YOU'LL NEVER MOVE ALONE",
    description: "The world gave athletes more data. We want to give them back their sense.",
    images: [{ url: "/og/nika-og.jpg", width: 1200, height: 630, alt: "NIKA | YOU'LL NEVER MOVE ALONE" }],
  },
  twitter: { card: "summary_large_image", images: ["/og/nika-og.jpg"] },
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
        {/* Аналитика грузится только после «Принять» в баннере cookie */}
        <AnalyticsGate nonce={nonce} />
        {children}
        <CookieBanner />
        {/* PWA: регистрация SW и глобальные install-баннеры */}
        <ServiceWorkerRegistration />
        <IosInstallSheet readyToShow={true} />
        <AndroidInstallBanner readyToShow={true} />
        <NotificationPermissionPrompt />
      </body>
    </html>
  );
}
