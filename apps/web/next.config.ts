import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pdfkit грузит шрифты (.afm) как файлы рядом с собой в рантайме — при
  // вебпак-бандлинге эти файлы теряются. serverExternalPackages оставляет
  // pdfkit как обычный require из node_modules, standalone-трейсер тогда
  // копирует пакет целиком, включая data/*.afm.
  serverExternalPackages: ["pdfkit"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
};

export default nextConfig;
