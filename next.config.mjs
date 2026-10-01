/**
 * Базовые security-заголовки для всех маршрутов.
 * CSP намеренно НЕ задаём здесь — приложение активно использует inline-стили,
 * строгий CSP их сломает; политику нужно вводить отдельно и аккуратно.
 */
const securityHeaders = [
  // Запрет MIME-sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Защита от clickjacking (встраивание в чужие iframe).
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Не утекать полный URL в Referer на сторонние домены.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Отключаем неиспользуемые мощные API.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Принудительный HTTPS (Railway отдаёт по HTTPS).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Включает instrumentation.ts — стартовый хук сервера. В Next 14 он ещё за
    // флагом. Там регистрируется вебхук Telegram и тикер напоминаний кофе-рана:
    // приложение запущено — бот на связи, отдельных процессов не нужно.
    instrumentationHook: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Лендинг (статический HTML, отдаётся со сжатием: compress включён по умолчанию).
      // Вход через "/" получает те же заголовки из middleware.ts.
      {
        source: "/landing.html",
        headers: [
          { key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=86400" },
        ],
      },
      // Своя копия three.js r128 для лендинга; файлы не меняются без смены версии.
      {
        source: "/landing/vendor/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
      // Юридические страницы: обновляются редко, короткий кэш, чтобы правки доходили быстро
      {
        source: "/legal/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=86400" }],
      },
      // Старые версии лендинга лежат для истории, наружу они не нужны
      {
        source: "/_archive/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      // Страницы кофе-ранов живут по ссылке из бота, в поиске им не место:
      // без JavaScript поисковик видел «This page requires JavaScript».
      ...["/coffeerunsurfsport", "/coffeerunluzhniki"].flatMap((p) => [p, `${p}/:path*`]).map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, follow" }],
      })),
      // Приложение (новая версия): HTML не индексировать и не кешировать
      {
        source: "/app/index.html",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
      { source: "/start", headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }] },
      // Звук практик и иконки меняются только с новым именем файла
      { source: "/app/audio/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=604800" }] },
    ];
  },
  // Старое приложение заменено новой версией (public/app/index.html).
  // Старые адреса ведут в нужный раздел нового: ссылки из Telegram-бота,
  // push-уведомлений и закладок продолжают работать.
  async redirects() {
    const to = (source, destination) => ({ source, destination, permanent: false });
    return [
      to("/authv1", "/start"),
      to("/authv1/:path*", "/start"),
      to("/auth", "/start?login=1"),
      to("/signup", "/start"),
      to("/forgot-password", "/start?login=1"),
      to("/onboarding", "/start"),
      to("/today", "/"),
      to("/day1", "/"),
      to("/chat", "/?go=nika"),
      to("/chat/:path*", "/?go=nika"),
      to("/journal", "/?go=diary"),
      to("/journal/:path*", "/?go=diary"),
      to("/tips", "/?go=diary"),
      to("/analytics", "/?go=diary"),
      to("/rhythm", "/?go=rhythm"),
      to("/rhythm/:path*", "/?go=rhythm"),
      to("/meditations", "/?go=library"),
      to("/profile", "/?go=profile"),
      to("/profile/:path*", "/?go=profile"),
      to("/upgrade", "/?go=pro"),
      to("/sprint", "/"),
      to("/sprint/:path*", "/"),
      to("/manifesto", "/"),
      to("/install", "/"),
      to("/landing", "/"),
    ];
  },
  async rewrites() {
    return [
      // Лендинги кофе-ранов: /coffeerun<спот> → его index.html, без редиректа.
      // Кусок пути после «coffeerun» — тот же слаг, что в lib/coffeerun/run.ts
      // (CoffeeRun.landing): по нему бот собирает ссылку на нужную страницу.
      {
        source: "/coffeerunsurfsport",
        destination: "/coffeerunsurfsport/index.html",
      },
      {
        source: "/coffeerunluzhniki",
        destination: "/coffeerunluzhniki/index.html",
      },
      // Юридические страницы: /legal/privacy → /legal/privacy.html, без редиректа
      { source: "/legal/privacy", destination: "/legal/privacy.html" },
      { source: "/legal/consent", destination: "/legal/consent.html" },
      { source: "/legal/oferta", destination: "/legal/oferta.html" },
      // Вход, регистрация, онбординг и новый пароль живут в приложении
      { source: "/start", destination: "/app/index.html" },
      { source: "/reset-password", destination: "/app/index.html" },
    ];
  },
};

export default nextConfig;
