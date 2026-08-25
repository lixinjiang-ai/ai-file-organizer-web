import type { NextConfig } from "next";

// AI File Organizer Web — pure client-side static export.
// Deploys to GitHub Pages (GITHUB_PAGES=1) or any static host / Vercel.
const githubPages = process.env.GITHUB_PAGES === "1";
const basePath = githubPages ? "/ai-file-organizer-web" : "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath,
  images: { unoptimized: true },
};

export default nextConfig;
