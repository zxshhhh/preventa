import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["http://localhost:3000", "192.168.56.1"],
  devIndicators: false,
};

export default nextConfig;
