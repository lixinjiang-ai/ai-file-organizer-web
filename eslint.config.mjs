import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const spread = (c) => (Array.isArray(c) ? c : [c]);

const config = [
  {
    // 全局忽略：非应用代码（Node/Cloudflare 部署与本地开发脚本，使用 require() 属正常写法）
    ignores: [
      "**/node_modules.broken",
      "**/out",
      "**/.next",
      "**/_tgzs",
      "**/_nmcache",
      "**/local_server.cjs",
      "**/netlify/**",
      "**/worker/**",
    ],
  },
  ...spread(nextCoreWebVitals),
  ...spread(nextTypescript),
  {
    rules: {
      "@next/next/no-img-element": "off",
      "react/no-unescaped-entities": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default config;
