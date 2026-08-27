/**
 * V2-P4: AI 分类器 - 支持可选分类要求 + 目录树模式 + 真实 Agnes API
 *
 * 分类逻辑：
 * 1. 支持"整理要求"可选输入（用户自定义分类规则）
 * 2. 支持两种模式：A=自动智能整理 / B=按现有文件夹结构整理
 * 3. 严格限制最多4级目录，禁止AI创造不存在目录
 * 4. 使用真实 Cloudflare Worker 代理调用 Agnes 2.5 Flash
 * 5. 路径验证 + 失败 fallback
 */

import type { ClassifiedFile, DirectoryNode } from "./directoryTree";
import { validateTargetPath } from "./pathValidator";

// ── Config ───────────────────────────────────────────────────────────────────
const WORKER_URL = "https://agnes-proxy.li7479648769.workers.dev";
const MODEL = "agnes-2.5-flash";
const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

// ── Types ────────────────────────────────────────────────────────────────────
export interface AiClassifyOptions {
  /** Cloudflare Worker 代理 URL（默认使用生产代理） */
  workerUrl?: string;
  /** 用户填写的"整理要求"（可选，不填则完全由AI自动判断） */
  userRequirement?: string;
  /** 目录模式：'auto'=自动智能整理(允许新建目录) / 'existing'=按现有结构整理(只能选已有节点) */
  mode?: "auto" | "existing";
  /** 现有目录树（mode='existing' 时必须提供） */
  existingTree?: DirectoryNode;
  apiKey?: string;
  batchSize?: number;
  maxRetries?: number;
}

export interface AiFileInput {
  /** 文件原始路径（含相对路径前缀） */
  originalPath: string;
  /** 文件名 */
  fileName: string;
  /** 文件扩展名 */
  extension: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** 内容摘要（最多1500字符） */
  contentExcerpt: string;
  /** 文件 MIME 类型 */
  mimeType: string;
}

export interface AiClassificationResult {
  files: ClassifiedFile[];
  fallback: ClassifiedFile[];
  errors: string[];
  stats: {
    total: number;
    aiClassified: number;
    fallbackToLocal: number;
    needsConfirmation: number;
    apiErrors: number;
  };
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * 对文件列表调用 AI 进行分类
 *
 * @param files 文件输入列表
 * @param options 分类选项
 * @returns AI 分类结果
 */
export async function aiClassify(
  files: AiFileInput[],
  options: AiClassifyOptions = {},
): Promise<AiClassificationResult> {
  const {
    workerUrl = WORKER_URL,
    userRequirement = "",
    mode = "auto",
    existingTree,
    apiKey,
    batchSize = BATCH_SIZE,
    maxRetries = MAX_RETRIES,
  } = options;

  const result: AiClassificationResult = {
    files: [],
    fallback: [],
    errors: [],
    stats: {
      total: files.length,
      aiClassified: 0,
      fallbackToLocal: 0,
      needsConfirmation: 0,
      apiErrors: 0,
    },
  };

  // 没有 API Key 时直接返回错误
  if (!apiKey) {
    result.errors.push("缺少 API Key，无法调用 AI 分类");
    return result;
  }

  if (files.length === 0) return result;

  // 构建允许目录列表（仅 mode=existing 时使用）
  const allowedDirectories = mode === "existing" && existingTree
    ? extractAllowedPaths(existingTree)
    : null;

  // 分批处理
  const batches: AiFileInput[][] = [];
  for (let i = 0; i < files.length; i += batchSize) {
    batches.push(files.slice(i, i + batchSize));
  }

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    try {
      const batchResults = await classifyBatch(batch, {
        workerUrl,
        userRequirement,
        mode,
        allowedDirectories,
        apiKey,
        maxRetries,
      });
      result.files.push(...batchResults.matched);
      result.stats.aiClassified += batchResults.matched.length;
      result.stats.fallbackToLocal += batchResults.fallback.length;
      result.stats.apiErrors += batchResults.errors.length;
      result.errors.push(...batchResults.errors);
    } catch (err) {
      result.errors.push(`批次 ${batchIdx + 1} 分类失败: ${String(err)}`);
      result.stats.apiErrors++;
    }

    // 批次间指数退避
    if (batchIdx < batches.length - 1) {
      await sleep(BASE_DELAY_MS * Math.pow(2, batchIdx));
    }
  }

  // 统计需要确认的文件
  result.stats.needsConfirmation = result.files.filter((f) => f.confidence < 0.70).length;

  return result;
}

// ── Batch Classification ─────────────────────────────────────────────────────

interface BatchResult {
  matched: ClassifiedFile[];
  fallback: ClassifiedFile[];
  errors: string[];
}

async function classifyBatch(
  batch: AiFileInput[],
  opts: {
    workerUrl: string;
    userRequirement: string;
    mode: "auto" | "existing";
    allowedDirectories: string[] | null;
    apiKey: string;
    maxRetries: number;
  },
): Promise<BatchResult> {
  const prompt = buildPrompt(batch, opts);

  for (let retry = 0; retry < opts.maxRetries; retry++) {
    try {
      const response = await fetchWithTimeout(
        `${opts.workerUrl}/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );

      // 处理 429 限流
      if (response.status === 429) {
        const delay = BASE_DELAY_MS * Math.pow(2, retry + 1);
        console.warn(`API 限流，等待 ${delay}ms 后重试 (${retry + 1}/${opts.maxRetries})...`);
        await sleep(delay);
        continue;
      }

      // 处理其他错误
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }

      const data = await response.json();
      return parseAiResponse(data, batch, opts);
    } catch (err) {
      if (retry === opts.maxRetries - 1) {
        // 最终失败，整个批次回退到本地分类
        return {
          matched: [],
          fallback: batch.map((f) => createFallbackClassifiedFile(f)),
          errors: [`AI 调用失败: ${String(err)}`],
        };
      }
      const delay = BASE_DELAY_MS * Math.pow(2, retry + 1);
      await sleep(delay);
    }
  }

  throw new Error("重试次数耗尽");
}

// ── Prompt Builder ───────────────────────────────────────────────────────────

function buildPrompt(
  files: AiFileInput[],
  opts: {
    userRequirement: string;
    mode: "auto" | "existing";
    allowedDirectories: string[] | null;
  },
): string {
  const fileSection = files
    .map(
      (f, i) => `
文件 ${i + 1}:
  - 名称: ${f.fileName}
  - 扩展名: .${f.extension}
  - 大小: ${formatFileSize(f.fileSize)}
  - 内容摘要: ${f.contentExcerpt || "[无文本内容]"}
  - 原始路径: ${f.originalPath}`,
    )
    .join("\n");

  const modeInstruction =
    opts.mode === "existing"
      ? `
【目录模式说明】
当前处于"按现有文件夹结构整理"模式。你必须从以下【允许的目录列表】中选择目标路径，
绝对不能创建任何不存在的新目录。如果某个文件无法匹配任何现有目录，请将其放入"未分类/待确认"目录。

允许的目录列表（严格按此选择）：
${opts.allowedDirectories?.join("\n") || "[无可用目录]"}
`
      : `
【目录模式说明】
当前处于"自动智能整理"模式。你可以根据文件内容自行决定合理的目录结构，
但必须遵守以下规则：
1. 最多只能有4级文件夹（不含文件名）
2. 每级目录名不超过50个字符
3. 不能包含 ../ 或绝对路径
4. 目录名应使用中文，简洁明了
`;

  const requirementSection = opts.userRequirement
    ? `
【用户整理要求】（优先遵守）
${opts.userRequirement}
`
    : `
【用户整理要求】
未填写，完全由你根据文件内容自动判断分类。
`;

  return `你是一个专业的文件分类助手。请将以下文件归类到合适的四级目录中。

${modeInstruction}
${requirementSection}
输出格式（仅输出JSON，不要任何其他内容）：
{
  "results": [
    {
      "index": 1,
      "level1": "一级目录名",
      "level2": "二级目录名",
      "level3": "三级目录名（如不需要可填"其他"）",
      "confidence": 0.95,
      "reason": "分类理由（一句话）"
    }
  ]
}

规则：
1. confidence 范围 0.0-1.0
2. 置信度 < 0.70 的文件表示不确定，reason 中说明不确定原因
3. level3 如果不需要细分，填"其他"即可
4. 只输出 JSON，不要 markdown 代码块标记

待分类文件：
${fileSection}`;
}

// ── Response Parser ──────────────────────────────────────────────────────────

function parseAiResponse(
  data: any,
  batch: AiFileInput[],
  opts: {
    mode: "auto" | "existing";
    allowedDirectories: string[] | null;
  },
): BatchResult {
  let content: string;

  // 兼容不同响应格式
  if (data?.ok && data?.data?.choices?.[0]?.message?.content) {
    // Worker 代理格式
    content = data.data.choices[0].message.content;
  } else if (data?.choices?.[0]?.message?.content) {
    // 直接 Agnes 格式
    content = data.choices[0].message.content;
  } else {
    throw new Error("AI 响应格式异常，无法解析");
  }

  // 提取 JSON（可能包裹在 markdown 代码块中）
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("无法从 AI 响应中提取 JSON");

  let parsed: { results?: Array<{ index: number; level1: string; level2: string; level3: string; confidence: number; reason: string }> };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("AI 返回的 JSON 解析失败");
  }

  if (!Array.isArray(parsed.results)) throw new Error("AI 响应缺少 results 数组");

  const matched: ClassifiedFile[] = [];
  const errors: string[] = [];

  for (const item of parsed.results) {
    const file = batch[item.index - 1];
    if (!file) {
      errors.push(`文件索引 ${item.index} 不存在`);
      continue;
    }

    const l1 = sanitizeNodeName(item.level1 || "未分类");
    const l2 = sanitizeNodeName(item.level2 || "待确认");
    const l3 = sanitizeNodeName(item.level3 || "其他");
    const confidence = Math.min(1.0, Math.max(0.0, item.confidence ?? 0.5));

    // 构建目标路径
    const targetPath = `${l1}/${l2}/${l3}/${file.fileName}`;

    // 路径验证
    const validation = validateTargetPath(targetPath);
    if (!validation.valid) {
      errors.push(`${file.fileName}: ${validation.error}`);
      continue;
    }

    // mode=existing 时额外验证路径是否在允许列表中
    if (opts.mode === "existing" && opts.allowedDirectories) {
      const dirPath = `${l1}/${l2}/${l3}`;
      if (!opts.allowedDirectories.includes(dirPath) && !opts.allowedDirectories.some((d) => d.startsWith(dirPath + "/"))) {
        // 路径不在允许列表中，降级为人工确认
        errors.push(`${file.fileName}: 目标路径不在允许目录树中，需人工确认`);
        continue;
      }
    }

    matched.push({
      originalPath: file.originalPath,
      fileName: file.fileName,
      fileSize: file.fileSize,
      file: null as any,
      confidence,
      level1: l1,
      level2: l2,
      level3: l3,
      targetPath,
      source: "ai",
      needsConfirmation: confidence < 0.70,
      aiReason: item.reason || "",
    });
  }

  // 未匹配的文件
  const matchedIndices = new Set(parsed.results.map((r) => r.index));
  const fallback: ClassifiedFile[] = batch
    .filter((_, i) => !matchedIndices.has(i + 1))
    .map((f) => createFallbackClassifiedFile(f));

  return { matched, fallback, errors };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function createFallbackClassifiedFile(file: AiFileInput): ClassifiedFile {
  return {
    originalPath: file.originalPath,
    fileName: file.fileName,
    fileSize: file.fileSize,
    file: null as any,
    confidence: 0.30,
    level1: "未分类",
    level2: "待确认",
    level3: "其他",
    targetPath: `未分类/待确认/其他/${file.fileName}`,
    source: "ai",
    needsConfirmation: true,
    aiReason: "AI 分类失败，回退到本地兜底",
  };
}

function extractAllowedPaths(node: DirectoryNode, prefix = ""): string[] {
  const paths: string[] = [];
  if (!node.children) return paths;

  for (const child of node.children) {
    const path = prefix ? `${prefix}/${child.name}` : child.name;
    if (child.type === "directory" && child.children) {
      paths.push(path);
      paths.push(...extractAllowedPaths(child, path));
    }
  }
  return paths;
}

function sanitizeNodeName(name: string): string {
  // 移除非法字符，截断超长名称
  return name
    .replace(/[\x00-\x1f<>:"|?*\r\n]/g, "")
    .trim()
    .slice(0, 50);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, options: RequestInit & { signal?: AbortSignal }): Promise<Response> {
  const response = await fetch(url, options);
  return response;
}
