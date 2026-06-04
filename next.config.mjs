/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  async rewrites() {
    return {
      // Срабатывает до поиска страниц — / отдаёт лендинг из /public
      beforeFiles: [
        { source: "/", destination: "/landing.html" },
      ],
    };
  },
};

export default nextConfig;
