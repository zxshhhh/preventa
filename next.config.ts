import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["http://localhost:3000", "192.168.56.1", "preventa.zhoulopagalan13.workers.dev"],
  devIndicators: false,
  async redirects() {
    return [{ source: '/', destination: '/login', permanent: false }]
  },
};

export default nextConfig;
