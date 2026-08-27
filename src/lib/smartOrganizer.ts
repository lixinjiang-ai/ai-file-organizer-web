/**
 * V2-P4: 智能归档主分类器 - 支持两种模式 + 可选整理要求
 *
 * 模式 A: 自动智能整理 - AI 根据文件内容自动形成合理目录
 * 模式 B: 按现有文件夹结构整理 - AI 只能选择已有目录节点
 *
 * 流程：
 * 1. 本地规则分类所有文件（高置信度直接采用）
 * 2. 低置信度文件 → 调用 AI（带整理要求和/或目录树约束）
 * 3. 路径验证 + 去重
 * 4. 返回最终分类结果
 */

import { batchLocalClassify } from "./classifier";
import { aiClassify } from "./aiClassifier";
import type { AiFileInput } from "./aiClassifier";
import { validateTargetPath, validateClassificationIndex, makeUniquePath } from "./pathValidator";
import type { ClassifiedFile, ClassificationResult, DirectoryNode } from "./directoryTree";
import { parseFile } from "./parsers";

// ── Types ────────────────────────────────────────────────────────────────────

export type OrganizeMode = "auto" | "existing";

export interface SmartOrganizeOptions {
  /** API Key（用于调用 AI，可选） */
  apiKey?: string;
  /** 最低置信度阈值，低于此值才调用 AI */
  aiMinConfidence?: number;
  /** 是否自动确认（跳过人工确认步骤） */
  autoConfirm?: boolean;
  /** 整理模式：'auto'=自动智能整理 / 'existing'=按现有结构整理 */
  mode?: OrganizeMode;
  /** 用户填写的整理要求（可选） */
  userRequirement?: string;
  /** 现有目录树（mode='existing' 时使用） */
  existingTree?: DirectoryNode;
}

// ── Main Entry ───────────────────────────────────────────────────────────────

/**
 * 智能分类主函数
 */
export async function smartClassify(
  files: Array<{ name: string; file: File; content?: string }>,
  options: SmartOrganizeOptions = {},
): Promise<ClassificationResult> {
  const {
    apiKey,
    aiMinConfidence = 0.70,
    autoConfirm = false,
    mode = "auto",
    userRequirement = "",
    existingTree,
  } = options;

  const allFiles: ClassifiedFile[] = [];
  const usedPaths = new Set<string>();
  const errors: string[] = [];

  if (files.length === 0) {
    return { files: [], stats: { total: 0, localClassified: 0, aiClassified: 0, needsConfirmation: 0, errors: 0 } };
  }

  // 1. 构建 AI 输入数据（从 File 对象提取必要信息）
  const aiInputs: AiFileInput[] = files.map((f) => ({
    originalPath: f.name,
    fileName: f.name.includes("/") ? f.name.split("/").pop()! : f.name,
    extension: f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "",
    fileSize: f.file.size,
    contentExcerpt: f.content || "",
    mimeType: f.file.type || "application/octet-stream",
  }));

  // 2. 本地规则分类
  const localResults = batchLocalClassify(files.map((f) => ({ name: f.name, content: f.content })));

  // 3. 分离高/低置信度文件
  const highConfidence: Array<{ index: number; name: string; file: File }> = [];
  const lowConfidence: Array<{ index: number; name: string; file: File }> = [];

  for (let i = 0; i < localResults.length; i++) {
    if (localResults[i].confidence >= aiMinConfidence) {
      highConfidence.push({ index: i, name: files[i].name, file: files[i].file });
    } else {
      lowConfidence.push({ index: i, name: files[i].name, file: files[i].file });
    }
  }

  // 4. 处理高置信度文件（本地规则）
  for (const { index, name, file } of highConfidence) {
    const origResult = localResults[index];
    if (!origResult) continue;

    let path = origResult.targetPath;
    const validation = validateTargetPath(path);
    if (!validation.valid) {
      errors.push(`${name}: ${validation.error}`);
      continue;
    }

    path = makeUniquePath(path, usedPaths);
    usedPaths.add(path);

    allFiles.push({
      ...origResult,
      file,
      fileSize: file.size,
      targetPath: path,
      needsConfirmation: autoConfirm ? false : origResult.confidence < 0.90,
    });
  }

  // 5. 处理低置信度文件（AI 分类）
  let aiResults: Awaited<ReturnType<typeof aiClassify>> | null = null;
  if (apiKey && lowConfidence.length > 0) {
    try {
      const aiFileInputs = lowConfidence.map(({ index, name: _name }) => aiInputs[index]);
      aiResults = await aiClassify(aiFileInputs, {
        apiKey,
        workerUrl: "https://agnes-proxy.li7479648769.workers.dev",
        userRequirement,
        mode,
        existingTree,
      });

      // 合并 AI 结果到主结果
      for (const aiFile of aiResults.files) {
        const idx = lowConfidence.findIndex((f) => f.name === aiFile.originalPath);
        if (idx === -1) continue;

        const originalFile = files[lowConfidence[idx].index];
        if (!originalFile) continue;

        let path = aiFile.targetPath;
        const validation = validateTargetPath(path);
        if (!validation.valid) {
          errors.push(`${aiFile.fileName}: ${validation.error}`);
          continue;
        }

        path = makeUniquePath(path, usedPaths);
        usedPaths.add(path);

        allFiles.push({
          ...aiFile,
          file: originalFile.file,
          fileSize: originalFile.file.size,
          targetPath: path,
        });
      }

      // 添加 fallback 文件
      for (const fallback of aiResults.fallback) {
        const idx = lowConfidence.findIndex((f) => f.name === fallback.originalPath);
        if (idx === -1) continue;
        const originalFile = files[lowConfidence[idx].index];
        if (!originalFile) continue;

        let path = fallback.targetPath;
        path = makeUniquePath(path, usedPaths);
        usedPaths.add(path);

        allFiles.push({
          ...fallback,
          file: originalFile.file,
          fileSize: originalFile.file.size,
          targetPath: path,
          needsConfirmation: true,
        });
      }

      errors.push(...aiResults.errors);
    } catch (err) {
      errors.push(`AI 分类失败: ${String(err)}`);
      // 整个批次降级为待确认
      for (const { index: _index, name, file } of lowConfidence) {
        allFiles.push({
          originalPath: name,
          fileName: name.includes("/") ? name.split("/").pop()! : name,
          fileSize: file.size,
          file,
          confidence: 0.30,
          level1: "未分类",
          level2: "待确认",
          level3: "其他",
          targetPath: `未分类/待确认/其他/${name.includes("/") ? name.split("/").pop()! : name}`,
          source: "ai",
          needsConfirmation: true,
          aiReason: "AI 调用异常，需人工确认",
        });
      }
    }
  } else if (lowConfidence.length > 0 && !apiKey) {
    // 无 API Key，低置信度文件全部待确认
    for (const { name, file } of lowConfidence) {
      allFiles.push({
        originalPath: name,
        fileName: name.includes("/") ? name.split("/").pop()! : name,
        fileSize: file.size,
        file,
        confidence: 0.40,
        level1: "未分类",
        level2: "待确认",
        level3: "其他",
        targetPath: `未分类/待确认/其他/${name.includes("/") ? name.split("/").pop()! : name}`,
        source: "local",
        needsConfirmation: true,
        aiReason: "未配置 AI API Key，需人工确认",
      });
    }
  }

  // 6. 验证所有路径无冲突
  const paths = allFiles.map((f) => f.targetPath);
  const { conflicts } = validateClassificationIndex(paths, usedPaths);
  if (conflicts.length > 0) {
    errors.push(`路径冲突: ${conflicts.slice(0, 5).join(", ")}${conflicts.length > 5 ? "..." : ""}`);
  }

  // 7. 统计
  const aiClassifiedCount = aiResults
    ? (aiResults as any).files.length + (aiResults as any).fallback.length
    : 0;
  const stats = {
    total: files.length,
    localClassified: highConfidence.length,
    aiClassified: aiClassifiedCount,
    needsConfirmation: allFiles.filter((f) => f.needsConfirmation).length,
    errors: errors.length,
  };

  return { files: allFiles, stats };
}

// ── Directory Tree Utilities ─────────────────────────────────────────────────

/**
 * 从 FileList 构建目录树
 */
export async function buildOrganizeInput(
  items: DataTransferItemList | FileList,
  parseContent = true,
): Promise<Array<{ name: string; file: File; content?: string }>> {
  const result: Array<{ name: string; file: File; content?: string }> = [];

  const fileList: File[] = [];
  if (typeof DataTransferItemList !== "undefined" && items instanceof DataTransferItemList) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) fileList.push(file);
      }
    }
  } else {
    fileList.push(...Array.from(items as FileList));
  }

  // 限制文件数量（避免浏览器卡死）
  const MAX_FILES = 200;
  const limitedFiles = fileList.slice(0, MAX_FILES);

  if (fileList.length > MAX_FILES) {
    console.warn(`文件数量超过 ${MAX_FILES} 个，仅处理前 ${MAX_FILES} 个`);
  }

  // 解析文件内容
  for (const file of limitedFiles) {
    let content: string | undefined;
    if (parseContent) {
      try {
        const parsed = await parseFile(file);
        content = parsed.textExcerpt;
      } catch {
        content = undefined;
      }
    }
    result.push({ name: file.name, file, content });
  }

  return result;
}
