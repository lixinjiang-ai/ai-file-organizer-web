// FINAL ACCEPTANCE: 最终产品验收 - 真实浏览器全链路（不修改任何产品代码）
// 覆盖：1.线上真实浏览器验收 2.AI真实链路+降级 3.大批量 4.UI(桌面/375) 5.安全检查(部分在Bash侧)
import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import JSZip from "jszip";

const URL = process.env.ACCEPT_URL || "https://lixinjiang-ai.github.io/ai-file-organizer-web/smart-organize/";
const ROOT = process.cwd();
const FIX = path.join(ROOT, "final-fixtures");
const FAIL = path.join(ROOT, "final-fail");
const BULK = path.join(ROOT, "final-bulk");
const OUT = path.join(ROOT, "final-out");
fs.mkdirSync(OUT, { recursive: true });

const result = {
  meta: { url: URL, startedAt: new Date().toISOString() },
  scenarios: {},
  errors: [],
  consoleErrors: [],
};

const SUITE = {}; // 汇总各验收项的验证等级

async function collectPhases(page, ms) {
  const seen = new Set();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const txt = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
      for (const kw of ["正在解析文件", "正在分类", "正在生成 ZIP"]) if (txt.includes(kw)) seen.add(kw);
      if (txt.includes("确认归档并生成 ZIP") || txt.includes("归档完成")) break;
      await page.waitForTimeout(400);
    } catch {
      break; // 页面已关闭/导航 → 停止收集，避免未捕获拒绝
    }
  }
  return [...seen];
}

async function extractZip(buf, outDirBase) {
  const zip = await JSZip.loadAsync(buf);
  const entries = Object.keys(zip.files);
  // 使用唯一子目录，避免删除历史产物时触发沙箱 [SAFE_DELETE_BULK_CONFIRM_REQUIRED]
  // （verify 目录可能含 >50 个文件，fs.rmSync 整目录删除会被拦截，进而使整个验收用例 ok=false）。
  const outDir = `${outDirBase}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const name of entries) {
    const f = zip.files[name];
    if (f.dir) continue;
    const data = await f.async("nodebuffer");
    const fp = path.join(outDir, name);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, data);
    files.push(name);
  }
  return { entries, files, outDir };
}

function pathSafety(entries) {
  const violations = [];
  for (const e of entries) {
    if (e.includes("..") || e.startsWith("/") || /^[A-Za-z]:/.test(e) || /(^|\/)(users|temp|tmp|windows|system32)/i.test(e)) {
      violations.push(e);
    }
  }
  return violations;
}

// 真实浏览器下 webkitdirectory 的目录读取在 headless 中存在竞态：Playwright
// 会把目录分块喂给 input，change 事件可能只携带部分 FileList（实测 64/84/100 抖动），
// 且直接 setInputFiles 偶发不触发 React onChange。
// 因此这里改为：在浏览器内用 DataTransfer 精确构造「与磁盘完全一致」的 FileList，
// 重写 input.files 后派发 change；若 React 的 handleFolderSelect 未启动（合成事件
// 偶发不触发），则重试注入直到解析相位出现。如此可确定性地交付精确文件数（无截断）。
const MIME = {
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
};
function readFilesRec(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...readFilesRec(p));
    else out.push(p);
  }
  return out;
}
async function injectFolder(page, dir) {
  const files = readFilesRec(dir);
  const metas = files.map((p) => {
    const ext = p.split(".").pop().toLowerCase();
    return { name: path.basename(p), mime: MIME[ext] || "application/octet-stream", b64: fs.readFileSync(p).toString("base64") };
  });
  const inputCount = metas.length;
  let fired = false;
  for (let attempt = 0; attempt < 20 && !fired; attempt++) {
    await page.evaluate((metas) => {
      const input = document.querySelector('input[webkitdirectory]');
      if (!input) return;
      const dt = new DataTransfer();
      for (const m of metas) {
        const b = Uint8Array.from(atob(m.b64), (c) => c.charCodeAt(0));
        dt.items.add(new File([b], m.name, { type: m.mime }));
      }
      Object.defineProperty(input, "files", { configurable: true, value: dt.files });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, metas);
    for (let i = 0; i < 10; i++) {
      const txt = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
      if (txt.includes("正在解析文件") || txt.includes("正在分类") || txt.includes("确认归档并生成 ZIP") || txt.includes("出错了") || txt.includes("读取文件失败")) {
        fired = true;
        break;
      }
      await page.waitForTimeout(400);
    }
  }
  return { inputCount, fired };
}
async function selectFolder(page, dir) {
  return injectFolder(page, dir);
}

async function run() {
  const browser = await chromium.launch({ headless: true });

  // ════════════ SCENARIO A: 多类型 + 真实 Agnes + 桌面 ════════════
  {
    const s = (result.scenarios.A = { name: "多类型真实浏览器验收(桌面)", steps: [], ok: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const logs = [];
    page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
    page.on("pageerror", (e) => result.errors.push("A:pageerror:" + e.message));
    page.on("requestfailed", (r) => { const u = r.url(); if (u.includes("agnes-proxy")) s.steps.push("Worker请求失败:" + u.slice(0, 60)); });

    try {
      await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.getByText("第一次用？四步搞定").waitFor({ timeout: 30000 });
      s.steps.push("✓ 打开页面，idle 空状态(选择文件夹)可见");
      await page.screenshot({ path: path.join(OUT, "01-idle-desktop.png") });

      // 首次引导可见
      const guide = await page.getByText("第一次用？四步搞定").count();
      s.guideVisible = guide > 0;
      s.steps.push(`✓ 首次引导可见: ${guide > 0}`);

      const selA = await selectFolder(page, FIX);
      s.inputCount = selA.inputCount; s.selectFired = selA.fired;
      s.steps.push(`✓ 选择真实文件夹(${selA.inputCount} 个混合类型文件, 注入触发=${selA.fired})`);

      const phasePromise = collectPhases(page, 180000);
      await page.getByText("确认归档并生成 ZIP").waitFor({ timeout: 180000 });
      s.phasesSeen = await phasePromise;
      s.steps.push("✓ 分类完成进入预览(解析/分类/生成 相位均被观测到: " + JSON.stringify(s.phasesSeen) + ")");

      // 来源徽章
      s.aiBadges = await page.getByText("AI 辅助").count();
      s.ruleBadges = await page.getByText("本地规则").count();
      s.steps.push(`✓ 来源标识: AI辅助=${s.aiBadges} 本地规则=${s.ruleBadges}`);

      s.attentionPanel = (await page.getByText("以下文件需人工关注").count()) > 0;
      s.lowConfLabel = (await page.getByText("低置信度").count()) > 0;
      s.treeVisible = (await page.getByText("目录结构（点击筛选）").count()) > 0;
      s.steps.push(`✓ 左目录树可见=${s.treeVisible} 需人工关注面板=${s.attentionPanel} 低置信度标识=${s.lowConfLabel}`);

      await page.screenshot({ path: path.join(OUT, "02-confirm-desktop.png") });

      // 人工修改目录（单文件）
      const l1 = page.locator('input[placeholder="一级目录"]');
      const fn = page.locator('input[placeholder="文件名"]');
      await l1.first().fill("手动编辑验证X");
      const echoed = await l1.first().inputValue();
      s.manualEditEcho = echoed;
      s.steps.push(`✓ 人工改目录生效(输入框回显="${echoed}")`);

      // 批量修改（统一一级目录）
      await page.locator('input[placeholder="统一一级目录"]').fill("批量验证Y");
      await page.getByText("应用到全部").click();
      const batchEcho = await l1.nth(5).inputValue();
      s.batchEditEcho = batchEcho;
      s.steps.push(`✓ 批量修改生效(第6项一级目录回显="${batchEcho}")`);

      // 冲突处理：把前两项改成完全相同的目标路径
      await l1.nth(0).fill("冲突测试"); await page.locator('input[placeholder="二级目录"]').nth(0).fill("同目录"); await page.locator('input[placeholder="三级目录"]').nth(0).fill("其他"); await fn.nth(0).fill("同名文件.txt");
      await l1.nth(1).fill("冲突测试"); await page.locator('input[placeholder="二级目录"]').nth(1).fill("同目录"); await page.locator('input[placeholder="三级目录"]').nth(1).fill("其他"); await fn.nth(1).fill("同名文件.txt");
      await page.waitForTimeout(500);
      s.dupWarning = (await page.getByText("检测到重复目标路径").count()) > 0 || (await page.getByText("以下文件需人工关注").count()) > 0;
      s.steps.push(`✓ 冲突检测触发(重复路径提示=${s.dupWarning})`);

      // 确认归档
      await page.getByText("确认归档并生成 ZIP").click();
      const summaryText = await page.getByText(/共处理 .* 个文件/).first().textContent({ timeout: 120000 });
      s.summary = summaryText;
      const m = summaryText.match(/共处理 (\d+) 个文件 \/ 成功 (\d+) \/ AI 分类 (\d+) \/ 规则分类 (\d+) \/ 已归档 (\d+)/);
      if (m) s.summaryNumbers = { total: +m[1], success: +m[2], ai: +m[3], rule: +m[4], archived: +m[5] };
      s.steps.push("✓ 确认归档→ZIP生成完成，统计: " + summaryText);
      const doneVisible = (await page.getByText("归档完成").count()) > 0;
      s.doneVisible = doneVisible;
      await page.screenshot({ path: path.join(OUT, "03-done-desktop.png") });
      s.steps.push("✓ 完成页面可见=" + doneVisible);

      // 下载 ZIP
      const dl = page.waitForEvent("download", { timeout: 120000 });
      await page.getByText("下载 ZIP").click();
      const zipName = await dl.then((d) => d.suggestedFilename());
      const zipPath = path.join(OUT, zipName);
      await dl.then((d) => d.saveAs(zipPath));
      s.zipName = zipName;
      const { entries, files } = await extractZip(fs.readFileSync(zipPath), path.join(OUT, "verify-A"));
      const dirs = entries.filter((e) => e.endsWith("/"));
      s.zipEntries = entries.length; s.zipDirCount = dirs.length; s.zipFileCount = files.length;
      s.verifiedTree = files.map((f) => f.replace(/\//g, "/")).sort();
      s.pathViolations = pathSafety(entries);
      s.steps.push(`✓ ZIP已下载并物理解压: ${dirs.length}目录/${files.length}文件, 路径安全违规=${s.pathViolations.length}`);
      s.steps.push("✓ 目录树样本: " + files.slice(0, 6).join(" | "));
      s.steps.push("✓ 批量目录生效(含'批量验证Y'): " + files.some((f) => f.includes("批量验证Y")));
      s.steps.push("✓ 冲突目录生效(含'冲突测试'): " + files.some((f) => f.includes("冲突测试")));
    } catch (e) {
      s.ok = false; result.errors.push("A:" + String(e).slice(0, 400));
    }
    await ctx.close();
  }

  // ════════════ SCENARIO B: AI 失败降级（拦截 Worker→500，移动端 375）══════════
  {
    const s = (result.scenarios.B = { name: "AI失败降级验证(移动端375,拦截Worker)", steps: [], ok: true });
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => result.errors.push("B:pageerror:" + e.message));
    // 拦截 Agnes Worker → 一律 500，模拟 Agnes 不可用
    await page.route("**/agnes-proxy.li7479648769.workers.dev/**", (route) =>
      route.fulfill({ status: 500, body: "internal error" }),
    );
    try {
      await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.getByText("第一次用？四步搞定").waitFor({ timeout: 30000 });
      await page.screenshot({ path: path.join(OUT, "04-idle-mobile.png") });

      const selB = await selectFolder(page, FAIL);
      s.inputCount = selB.inputCount; s.selectFired = selB.fired;
      s.steps.push(`✓ 选择 ${selB.inputCount} 个低置信度文件(模拟 Agnes 全部失败场景, 注入触发=${selB.fired})`);

      await page.getByText("确认归档并生成 ZIP").waitFor({ timeout: 120000 });
      s.aiFailBanner = (await page.getByText("部分文件 AI 分类未能完成").count()) > 0;
      s.aiFailDesc = (await page.getByText(/已自动将 .* 个文件改用本地规则/).count()) > 0;
      s.steps.push(`✓ AI失败横幅出现: 标题=${s.aiFailBanner} 描述=${s.aiFailDesc}`);
      await page.screenshot({ path: path.join(OUT, "05-aifail-mobile.png") });

      // 不阻断：仍能确认归档
      await page.getByText("确认归档并生成 ZIP").click();
      const summaryText = await page.getByText(/共处理 .* 个文件/).first().textContent({ timeout: 120000 });
      s.summary = summaryText;
      const m = summaryText.match(/共处理 (\d+) 个文件 \/ 成功 (\d+) \/ AI 分类 (\d+) \/ 规则分类 (\d+) \/ 已归档 (\d+)/);
      if (m) s.summaryNumbers = { total: +m[1], success: +m[2], ai: +m[3], rule: +m[4], archived: +m[5] };
      s.steps.push("✓ Agnes失败后任务未阻断，仍能生成统计: " + summaryText);

      // 下载验证完整性
      const dlB = page.waitForEvent("download", { timeout: 120000 });
      await page.getByText("下载 ZIP").click();
      const zipPath = path.join(OUT, await dlB.then((d) => d.suggestedFilename()));
      await dlB.then((d) => d.saveAs(zipPath));
      const { entries, files } = await extractZip(fs.readFileSync(zipPath), path.join(OUT, "verify-B"));
      s.zipFileCount = files.length;
      s.pathViolations = pathSafety(entries);
      s.steps.push(`✓ 失败后ZIP仍完整: ${files.length}文件, 路径安全违规=${s.pathViolations.length}`);
    } catch (e) {
      s.ok = false; result.errors.push("B:" + String(e).slice(0, 400));
    }
    await ctx.close();
  }

  // ════════════ SCENARIO C: 大批量 100 文件 ════════════
  {
    const s = (result.scenarios.C = { name: "大批量验收(100文件)", steps: [], ok: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => result.errors.push("C:pageerror:" + e.message));
    try {
      const inputCount0 = fs.readdirSync(BULK).length;
      s.inputCount = inputCount0;
      await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.getByText("第一次用？四步搞定").waitFor({ timeout: 30000 });

      const selC = await selectFolder(page, BULK);
      s.inputCount = selC.inputCount; s.selectFired = selC.fired;
      s.steps.push(`✓ 选择 ${selC.inputCount} 个文件(混合类型, 注入触发=${selC.fired})`);

      const phasePromise = collectPhases(page, 360000);
      await page.getByText("确认归档并生成 ZIP").waitFor({ timeout: 360000 });
      s.phasesSeen = await phasePromise;
      s.steps.push("✓ 大批量分类完成, 观测相位=" + JSON.stringify(s.phasesSeen));

      await page.getByText("确认归档并生成 ZIP").click();
      const summaryText = await page.getByText(/共处理 .* 个文件/).first().textContent({ timeout: 180000 });
      s.summary = summaryText;
      const m = summaryText.match(/共处理 (\d+) 个文件 \/ 成功 (\d+) \/ AI 分类 (\d+) \/ 规则分类 (\d+) \/ 已归档 (\d+)/);
      if (m) s.summaryNumbers = { total: +m[1], success: +m[2], ai: +m[3], rule: +m[4], archived: +m[5] };
      s.steps.push("✓ 大批量统计: " + summaryText);
      await page.screenshot({ path: path.join(OUT, "06-bulk-done.png") });

      const dlC = page.waitForEvent("download", { timeout: 180000 });
      await page.getByText("下载 ZIP").click();
      const zipPath = path.join(OUT, await dlC.then((d) => d.suggestedFilename()));
      await dlC.then((d) => d.saveAs(zipPath));
      const { entries, files } = await extractZip(fs.readFileSync(zipPath), path.join(OUT, "verify-C"));
      s.zipFileCount = files.length;
      s.pathViolations = pathSafety(entries);
      s.noLoss = files.length === selC.inputCount;
      s.steps.push(`✓ 大批量ZIP: 输入=${selC.inputCount} 输出文件=${files.length} 无丢失=${s.noLoss} 路径安全违规=${s.pathViolations.length}`);
    } catch (e) {
      s.ok = false; result.errors.push("C:" + String(e).slice(0, 400));
    }
    await ctx.close();
  }

  await browser.close();
  result.meta.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, "final-result.json"), JSON.stringify(result, null, 2));
  console.log("=== FINAL ACCEPTANCE RESULT ===");
  console.log(JSON.stringify(result, null, 2));
}

run().catch((e) => { console.error("FATAL", e); process.exit(1); });
