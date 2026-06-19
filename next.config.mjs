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
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
