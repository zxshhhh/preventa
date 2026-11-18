import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["http://localhost:3000", "192.168.56.1", "preventa.zhoulopagalan13.workers.dev"],
  devIndicators: false,
  env: {
  NEXT_PUBLIC_FIREBASE_API_KEY: "AIzaSyC_xy9zo6gFQQpt8iLt3tnDrsF1SUFQ27E",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "preventa-b3634.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "preventa-b3634",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "364891268058",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:364891268058:web:35ef101a64bdc1d56896e3",
  NEXT_PUBLIC_FIREBASE_VAPID_KEY: "BC1LAS7MPfHmpUfuAuMYj6QR8eYtD7Va_Vv6G6jK14RPm73Z28JbM_f-ydm-GiX2Gn9DYG9GtP6Azc92G_sBA9g",
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: "G-0Z7K9X1J3C",
  },
  async redirects() {
    return [{ source: '/', destination: '/login', permanent: false }]
  },
};

export default nextConfig;
