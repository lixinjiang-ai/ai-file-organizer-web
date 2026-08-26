/**
 * 四级目录智能归档 - 主分类器
 *
 * 整合本地规则分类 + AI 分类 + 路径验证
 */

import { batchLocalClassify } from "./classifier";
import { aiClassify } from "./aiClassifier";
import { validateTargetPath, validateClassificationIndex, makeUniquePath } from "./pathValidator";
import type { ClassifiedFile, ClassificationResult, DirectoryNode } from "./directoryTree";

export interface SmartOrganizeOptions {
  apiKey?: string;
  aiMinConfidence?: number; // 低于此置信度才调用 AI
  autoConfirm?: boolean; // 是否自动确认
}

/**
 * 智能分类主函数
 *
 * 流程：
 * 1. 本地规则分类所有文件
 * 2. 对低置信度文件调用 AI 分类
 * 3. 路径验证 + 去重
 * 4. 返回最终分类结果
 */
export async function smartClassify(
  files: Array<{ name: string; file: File; content?: string }>,
  options: SmartOrganizeOptions = {},
): Promise<ClassificationResult> {
  const { apiKey, aiMinConfidence = 0.70, autoConfirm = false } = options;

  const allFiles: ClassifiedFile[] = [];
  const usedPaths = new Set<string>();
  const errors: string[] = [];

  // 1. 本地规则分类
  const localResults = batchLocalClassify(files.map((f) => ({ name: f.name, content: f.content })));

  // 2. 分离高/低置信度文件
  const highConfidence: Array<{ name: string; file: File }> = [];
  const lowConfidence: Array<{ name: string; content?: string }> = [];

  for (let i = 0; i < localResults.length; i++) {
    const result = localResults[i];
    const file = files[i];

    if (result.confidence >= aiMinConfidence) {
      highConfidence.push({ name: file.name, file: file as unknown as File });
    } else {
      lowConfidence.push({ name: file.name, content: result.aiReason });
    }
  }

  // 3. 处理高置信度文件（本地规则）
  for (const { name, file } of highConfidence) {
    const idx = files.findIndex((f) => f.name === name);
    const origResult = localResults[idx];

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

  // 4. 处理低置信度文件（AI 分类）
  if (apiKey && lowConfidence.length > 0) {
    try {
      const aiResults = await aiClassify(lowConfidence, { apiKey });

      for (const aiResult of aiResults) {
        const file = files.find((f) => f.name === aiResult.originalPath);
        if (!file) continue;
        const safeFile = file as unknown as File;

        let path = aiResult.targetPath;
        const validation = validateTargetPath(path);
        if (!validation.valid) {
          errors.push(`${file.name}: ${validation.error}`);
          continue;
        }

        path = makeUniquePath(path, usedPaths);
        usedPaths.add(path);

        allFiles.push({
          ...aiResult,
          file: safeFile,
          fileSize: safeFile.size,
          targetPath: path,
        });
      }
    } catch (err) {
      errors.push(`AI 分类失败: ${String(err)}`);
    }
  }

  // 5. 验证所有路径无冲突
  const paths = allFiles.map((f) => f.targetPath);
  const { conflicts } = validateClassificationIndex(paths, usedPaths);
  if (conflicts.length > 0) {
    errors.push(`路径冲突: ${conflicts.slice(0, 5).join(", ")}${conflicts.length > 5 ? "..." : ""}`);
  }

  // 6. 统计
  const stats = {
    total: files.length,
    localClassified: highConfidence.length,
    aiClassified: lowConfidence.length,
    needsConfirmation: allFiles.filter((f) => f.needsConfirmation).length,
    errors: errors.length,
  };

  return { files: allFiles, stats };
}

/**
 * 从目录树提取文件列表
 */
export function extractFilesFromTree(
  tree: DirectoryNode,
  prefix = "",
): Array<{ name: string; file?: File; content?: string }> {
  const files: Array<{ name: string; file?: File; content?: string }> = [];

  if (!tree.children) return files;

  for (const child of tree.children) {
    const path = prefix ? `${prefix}/${child.name}` : child.name;
    if (child.type === "file") {
      files.push({ name: path });
    } else {
      files.push(...extractFilesFromTree(child, path));
    }
  }

  return files;
}
