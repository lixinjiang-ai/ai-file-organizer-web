/**
 * 四级目录智能归档 - AI 分类器
 *
 * 调用 Agnes 2.5 Flash API 对低置信度文件进行分类
 * 支持批量处理 + 指数退避重试
 */

import { localClassify } from "./classifier";
import type { ClassifiedFile } from "./directoryTree";

const AGNES_API_URL = "https://api.agnes-ai.cn/v1/chat/completions";
const MODEL = "agnes-2.5-flash";
const BATCH_SIZE = 10; // 每批处理数量
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export interface AiClassifyOptions {
  apiKey?: string;
  batchSize?: number;
  maxRetries?: number;
}

/**
 * 对低置信度文件调用 AI 分类
 */
export async function aiClassify(
  files: Array<{ name: string; content?: string }>,
  options: AiClassifyOptions = {},
): Promise<ClassifiedFile[]> {
  const { apiKey, batchSize = BATCH_SIZE, maxRetries = MAX_RETRIES } = options;

  if (!apiKey) {
    throw new Error("缺少 API Key，无法调用 AI 分类");
  }

  const results: ClassifiedFile[] = [];
  const batches = [];
  for (let i = 0; i < files.length; i += batchSize) {
    batches.push(files.slice(i, i + batchSize));
  }

  for (let attempt = 0; attempt < batches.length; attempt++) {
    const batch = batches[attempt];
    try {
      const batchResults = await classifyBatch(batch, apiKey, maxRetries);
      results.push(...batchResults);
    } catch (err) {
      console.error(`批次 ${attempt + 1} 分类失败:`, err);
      // 失败的文件回退到本地规则
      for (const file of batch) {
        const local = localClassify(file.name, file.content);
        results.push({ ...local, file: null as any, source: "ai", aiReason: `AI 调用失败，使用本地规则兜底` });
      }
    }

    // 指数退避（批次间）
    if (attempt < batches.length - 1) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      await sleep(delay);
    }
  }

  return results;
}

/**
 * 单批次分类请求
 */
async function classifyBatch(
  batch: Array<{ name: string; content?: string }>,
  apiKey: string,
  maxRetries: number,
): Promise<ClassifiedFile[]> {
  const prompt = buildPrompt(batch);

  for (let retry = 0; retry < maxRetries; retry++) {
    try {
      const response = await fetch(AGNES_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
        }),
      });

      if (response.status === 429) {
        // 限流，退避重试
        const delay = BASE_DELAY_MS * Math.pow(2, retry + 1);
        console.warn(`API 限流，等待 ${delay}ms 后重试...`);
        await sleep(delay);
        continue;
      }

      if (!response.ok) {
        throw new Error(`API 返回 ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      return parseAiResponse(data, batch);
    } catch (err) {
      if (retry === maxRetries - 1) throw err;
      const delay = BASE_DELAY_MS * Math.pow(2, retry + 1);
      await sleep(delay);
    }
  }

  throw new Error("重试次数耗尽");
}

/**
 * 构建分类提示词
 */
function buildPrompt(files: Array<{ name: string; content?: string }>): string {
  const fileList = files.map((f, i) => `${i + 1}. ${f.name}${f.content ? ` (内容摘要: ${f.content.slice(0, 200)}...)` : ""}`).join("\n");

  return `请将以下文件按照四级目录结构进行分类，输出 JSON 格式。

要求：
- 一级分类：4-6个大类（如"财务资料"、"技术文档"、"人事资料"等）
- 二级分类：每类下细分2-4个子类
- 三级分类：按时间或项目细分
- 置信度：0.0-1.0，高置信度给0.85以上

输出格式（仅输出 JSON，不要其他内容）：
{
  "files": [
    {
      "index": 1,
      "level1": "一级分类",
      "level2": "二级分类",
      "level3": "三级分类",
      "confidence": 0.95
    }
  ]
}

待分类文件：
${fileList}`;
}

/**
 * 解析 AI 响应
 */
function parseAiResponse(
  data: any,
  files: Array<{ name: string; content?: string }>,
): ClassifiedFile[] {
  let content: string;
  if (data?.choices?.[0]?.message?.content) {
    content = data.choices[0].message.content;
  } else {
    throw new Error("AI 响应格式异常");
  }

  // 提取 JSON
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("无法解析 AI 响应中的 JSON");

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed.files)) throw new Error("AI 响应缺少 files 数组");

  return parsed.files.map((item: any) => {
    const file = files[item.index - 1];
    const confidence = Math.min(1.0, Math.max(0.0, item.confidence ?? 0.70));
    return {
      originalPath: file.name,
      fileName: file.name,
      fileSize: 0,
      file: null as any,
      confidence,
      level1: item.level1,
      level2: item.level2,
      level3: item.level3,
      targetPath: `${item.level1}/${item.level2}/${item.level3}/${file.name}`,
      source: "ai",
      needsConfirmation: confidence < 0.70,
      aiReason: `AI分类置信度: ${confidence.toFixed(2)}`,
    };
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
