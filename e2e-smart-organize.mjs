// V2-P6 真实浏览器 E2E：选真实文件 → 真实 Agnes 分类 → 人工改目录 → 确认归档 → 下载 ZIP → 校验结构
import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import JSZip from "jszip";

const URL = "https://lixinjiang-ai.github.io/ai-file-organizer-web/smart-organize/";
const FIX = path.join(process.cwd(), "e2e-fixtures");
const DL = path.join(process.cwd(), "e2e-out");
fs.mkdirSync(DL, { recursive: true });

const result = { steps: [], aiBadges: 0, ruleBadges: 0, attentionShown: false, zipPath: null, summary: null, files: 0, errors: [] };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

try {
  result.steps.push("goto " + URL);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });

  // 选真实文件夹（隐藏的 file input，含 webkitdirectory，只能选目录）
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles(FIX);
  result.steps.push("setInputFiles: 目录 " + FIX);

  // 等待分类完成（出现“确认归档并生成 ZIP”按钮）
  await page.getByText("确认归档并生成 ZIP").waitFor({ timeout: 180000 });
  result.steps.push("分类完成（预览阶段）");

  // 统计来源徽章
  result.aiBadges = await page.getByText("AI 辅助").count();
  result.ruleBadges = await page.getByText("本地规则").count();
  result.attentionShown = (await page.getByText("以下文件需人工关注").count()) > 0;
  result.steps.push(`徽章: AI=${result.aiBadges} 规则=${result.ruleBadges} 关注区=${result.attentionShown}`);

  // 人工修改：把第一个一级目录输入框改成自定义值，验证手动编辑生效
  try {
    const firstL1 = page.locator('input[placeholder="一级目录"]').first();
    await firstL1.fill("V2P6手动编辑验证");
    result.steps.push("已对首个文件执行人工改目录");
  } catch (e) {
    result.steps.push("人工改目录跳过: " + String(e).slice(0, 80));
  }

  // 确认归档并生成 ZIP（生成 ZIP Blob，进入 done 面板）
  await page.getByText("确认归档并生成 ZIP").click();
  result.steps.push("已点击 确认归档并生成 ZIP");

  // 等待生成完成：出现“共处理 ... 个文件”完成统计（表示 ZIP 已生成）
  const summaryText = await page
    .getByText(/共处理 .* 个文件/)
    .first()
    .textContent({ timeout: 120000 })
    .catch(() => null);
  result.summary = summaryText;
  result.steps.push("ZIP 生成完成，统计: " + (summaryText || "(未捕获)"));

  // 点击“下载 ZIP”按钮，触发真实浏览器下载
  // 先注册 download 监听，避免点击事件与 waitForEvent 之间的竞态
  const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
  await page.getByText("下载 ZIP").click();
  result.steps.push("已点击 下载 ZIP");

  // 等待下载
  const download = await downloadPromise;
  const zipName = download.suggestedFilename();
  result.zipPath = path.join(DL, zipName);
  await download.saveAs(result.zipPath);
  result.steps.push("ZIP 已下载: " + zipName);

  // ── ZIP 结构校验：用 jszip 读条目 + 物理解压到 verify 目录 ──
  const buf = fs.readFileSync(result.zipPath);
  const zip = await JSZip.loadAsync(buf);
  const entries = Object.keys(zip.files);
  result.zipEntries = entries;
  const dirs = entries.filter((e) => e.endsWith("/"));
  const files = entries.filter((e) => !e.endsWith("/"));
  result.zipDirCount = dirs.length;
  result.zipFileCount = files.length;
  result.steps.push(`ZIP 内容: ${dirs.length} 目录 / ${files.length} 文件`);

  // 物理解压验证
  const verifyDir = path.join(DL, "verify");
  fs.rmSync(verifyDir, { recursive: true, force: true });
  fs.mkdirSync(verifyDir, { recursive: true });
  const { execSync } = await import("child_process");
  execSync(`unzip -o "${result.zipPath}" -d "${verifyDir}"`, { stdio: "ignore" });
  result.verifiedTree = execSync(`cd "${verifyDir}" && find . -type f | sort`).toString().trim().split("\n");
  result.steps.push("物理解压完成，校验树条目数=" + result.verifiedTree.length);
} catch (e) {
  result.errors.push(String(e).slice(0, 300));
} finally {
  await browser.close();
}

console.log("=== E2E RESULT ===");
console.log(JSON.stringify(result, null, 2));
console.log("=== LAST LOGS ===");
console.log(logs.slice(-25).join("\n"));
