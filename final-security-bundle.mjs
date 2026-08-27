// FINAL-5 安全检查：在浏览器内抓取线上所有 JS bundle + 页面 HTML，grep 是否泄露密钥。
// 用浏览器而非 curl，因为本沙箱 curl 无法获取 GitHub Pages 响应体（仅浏览器可达）。
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const URL = "https://lixinjiang-ai.github.io/ai-file-organizer-web/smart-organize/";
const OUT = path.join(process.cwd(), "final-out");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

const srcs = await page.evaluate(() =>
  Array.from(document.querySelectorAll("script[src]")).map((s) => s.src),
);
const html = await page.content();

const report = {
  totalBundles: srcs.length,
  agnesKeyInHtml: /AGNES_API_KEY/.test(html),
  skTokenInHtml: (html.match(/sk-[A-Za-z0-9]{20,}/g) || []).length,
  bearerInHtml: /Bearer\s+/i.test(html) || /Authorization/i.test(html),
  workerUrlInHtml: /agnes-proxy/.test(html),
  bundles: [],
  totals: { agnesKey: 0, skToken: 0, bearer: 0, workerUrl: 0 },
};

for (const src of srcs) {
  const txt = await page.evaluate(async (u) => {
    try { const r = await fetch(u); return await r.text(); } catch (e) { return "FETCH_ERR:" + e.message; }
  }, src);
  const hasKey = /AGNES_API_KEY/.test(txt);
  const sk = (txt.match(/sk-[A-Za-z0-9]{20,}/g) || []).length;
  const bearer = /Bearer\s+/i.test(txt) || /Authorization/i.test(txt);
  const worker = /agnes-proxy/.test(txt);
  if (hasKey) report.totals.agnesKey++;
  report.totals.skToken += sk;
  if (bearer) report.totals.bearer++;
  if (worker) report.totals.workerUrl++;
  report.bundles.push({ file: src.split("/").pop(), len: txt.length, agnesKey: hasKey, sk, bearer, worker });
}

report.pass = report.totals.agnesKey === 0 && report.totals.skToken === 0 && !report.agnesKeyInHtml && report.skTokenInHtml === 0;
fs.writeFileSync(path.join(OUT, "security-bundle.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
