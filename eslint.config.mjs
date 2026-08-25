import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const spread = (c) => (Array.isArray(c) ? c : [c]);

const config = [
  ...spread(nextCoreWebVitals),
  ...spread(nextTypescript),
  {
    ignores: ["node_modules.broken", "out", ".next", "_tgzs", "_nmcache"],
    rules: {
      "@next/next/no-img-element": "off",
      "react/no-unescaped-entities": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default config;
