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
      // /authv1 — прототип, не индексировать, не кешировать
      {
        source: "/authv1/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
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
      // /authv1 → /authv1/index.html (прототип НИКА Лайт)
      {
        source: "/authv1",
        destination: "/authv1/index.html",
      },
    ];
  },
};

export default nextConfig;
