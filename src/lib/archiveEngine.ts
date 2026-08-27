/**
 * V2-P5: 智能归档 - 归档执行引擎（纯逻辑，可单测）
 *
 * 职责：
 * 1. 把用户的"人工编辑"合并进分类结果，重新生成目标路径
 * 2. 二次路径安全校验（复用 pathValidator）
 * 3. 重复目标路径检测
 * 4. 冲突处理策略 A（自动追加序号 / keepFilename 时安全父目录）与策略 B（返回人工修改）
 * 5. 归档统计
 *
 * 本模块不直接操作 DOM；ZIP 生成由 zipEngine 负责。
 */

import type { ClassifiedFile } from "./directoryTree";
import { validateTargetPath, makeUniquePath } from "./pathValidator";

/** 用户可编辑的层级 */
export interface EditLevels {
  level1: string;
  level2: string;
  level3: string;
  fileName: string;
}

/** 把"一级/二级/三级/文件名"拼接成目标路径 */
export function buildTargetPath(l: EditLevels): string {
  return [l.level1, l.level2, l.level3, l.fileName].filter(Boolean).join("/");
}

/** 把目标路径拆回可编辑层级 */
export function parseTargetPath(path: string): EditLevels {
  const parts = path.split("/");
  const fileName = parts.pop() ?? "";
  const level3 = parts.pop() ?? "";
  const level2 = parts.pop() ?? "";
  const level1 = parts.pop() ?? "";
  return { level1, level2, level3, fileName };
}

/**
 * 校验一次人工编辑是否合法
 * - 三个层级与文件名均不能为空（严格四级：一级/二级/三级/文件名）
 * - 复用 pathValidator：禁止 ../、绝对路径、Windows 盘符、特殊字符、超过 4 级
 */
export function validateEdit(
  l: EditLevels,
  keepFilename: boolean,
): { valid: boolean; error?: string; path?: string } {
  if (!l.level1 || !l.level2 || !l.level3) {
    return { valid: false, error: "目录层级不完整（需一级/二级/三级）" };
  }
  if (!l.fileName) {
    return { valid: false, error: "文件名不能为空" };
  }
  if (keepFilename && !l.level1) {
    // keepFilename 仅锁定文件名，层级仍可被用户改；这里只保证层级非空即可
    return { valid: false, error: "目录层级不完整（需一级/二级/三级）" };
  }
  const target = buildTargetPath(l);
  const v = validateTargetPath(target);
  if (!v.valid) return { valid: false, error: v.error };
  return { valid: true, path: target };
}

/**
 * 把用户编辑合并进分类结果，生成"有效分类结果"
 * keepFilename=true 时，文件名始终锁定为原始文件名，忽略编辑中的文件名
 */
export function applyEdits(
  base: ClassifiedFile[],
  edits: Record<number, EditLevels>,
  keepFilename: boolean,
): ClassifiedFile[] {
  return base.map((cf, i) => {
    const edit = edits[i];
    if (!edit) return cf;
    const levels: EditLevels = keepFilename
      ? { ...edit, fileName: cf.fileName }
      : edit;
    return {
      ...cf,
      level1: levels.level1,
      level2: levels.level2,
      level3: levels.level3,
      fileName: keepFilename ? cf.fileName : levels.fileName,
      targetPath: buildTargetPath(levels),
      needsConfirmation: false,
    };
  });
}

export interface InvalidItem {
  item: ClassifiedFile;
  error: string;
}

/**
 * 归档前二次校验：对所有有效结果做路径安全校验
 */
export function validateArchiveItems(items: ClassifiedFile[]): {
  valid: ClassifiedFile[];
  invalid: InvalidItem[];
} {
  const valid: ClassifiedFile[] = [];
  const invalid: InvalidItem[] = [];
  for (const item of items) {
    const v = validateTargetPath(item.targetPath);
    if (v.valid) {
      valid.push(item);
    } else {
      invalid.push({ item, error: v.error ?? "路径非法" });
    }
  }
  return { valid, invalid };
}

/** 找出所有出现超过一次的目标路径（重复） */
export function findDuplicatePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const p of paths) {
    if (seen.has(p)) dup.add(p);
    else seen.add(p);
  }
  return [...dup];
}

/**
 * 冲突处理
 * @param strategy "auto"=自动追加序号（默认）；"manual"=返回人工修改
 * @param keepFilename 锁定文件名模式
 *
 * 返回 resolved（已去重、可打包）与 unresolved（仍需人工处理）。
 * keepFilename 模式下无法在不破坏 4 级限制的前提下自动改文件名，
 * 若安全父目录方案仍超出 4 级，则归入 unresolved 交由用户处理（绝不静默覆盖）。
 */
export function resolveConflicts(
  items: ClassifiedFile[],
  strategy: "auto" | "manual",
  keepFilename: boolean,
): { resolved: ClassifiedFile[]; unresolved: InvalidItem[] } {
  const usedPaths = new Set<string>();
  const resolved: ClassifiedFile[] = [];
  const unresolved: InvalidItem[] = [];

  for (const item of items) {
    if (!usedPaths.has(item.targetPath)) {
      usedPaths.add(item.targetPath);
      resolved.push(item);
      continue;
    }

    if (strategy === "manual") {
      unresolved.push({ item, error: "重复目标路径，请返回手动修改" });
      continue;
    }

    // 策略 A：自动处理
    if (keepFilename) {
      // 不能改文件名 → 尝试在父目录内创建安全冲突目录
      const dir = item.targetPath.slice(0, item.targetPath.lastIndexOf("/"));
      let n = 1;
      let candidate = "";
      let ok = false;
      while (n <= 999) {
        candidate = `${dir}/冲突${n}/${item.fileName}`;
        if (!usedPaths.has(candidate) && validateTargetPath(candidate).valid) {
          ok = true;
          break;
        }
        n++;
      }
      if (ok) {
        usedPaths.add(candidate);
        resolved.push({ ...item, targetPath: candidate });
      } else {
        unresolved.push({
          item,
          error: "保留原文件名时无法自动解决冲突（会超出 4 级限制），请手动调整目录",
        });
      }
    } else {
      const newPath = makeUniquePath(item.targetPath, usedPaths);
      usedPaths.add(newPath);
      resolved.push({ ...item, targetPath: newPath });
    }
  }

  return { resolved, unresolved };
}

export interface ArchiveStats {
  total: number;
  classified: number;
  aiCount: number;
  ruleCount: number;
  pending: number;
  failed: number;
}

/**
 * 计算归档统计
 * - classified：路径合法的文件数量
 * - failed：路径非法的文件数量
 * - pending：仍需确认（needsConfirmation）的数量
 */
export function computeArchiveStats(items: ClassifiedFile[]): ArchiveStats {
  let aiCount = 0;
  let ruleCount = 0;
  let pending = 0;
  let failed = 0;

  for (const item of items) {
    if (item.source === "ai") aiCount++;
    else ruleCount++;
    if (item.needsConfirmation) pending++;
    if (!validateTargetPath(item.targetPath).valid) failed++;
  }

  return {
    total: items.length,
    classified: items.length - failed,
    aiCount,
    ruleCount,
    pending,
    failed,
  };
}

/**
 * 检查 ZIP 内部是否出现任何绝对/危险路径特征
 * 用于测试与上线前自检：绝不能包含 C:/ D:/ /Users/ ../ 等
 */
export function scanZipPathSafety(paths: string[]): { safe: boolean; violations: string[] } {
  const violations: string[] = [];
  const dangerous = [
    (p: string) => /^[A-Za-z]:[\\/]/.test(p), // Windows 盘符 C:\ D:\
    (p: string) => p.startsWith("/"), // 绝对路径
    (p: string) => p.includes(".."), // 路径穿越
    (p: string) => /(users|temp|tmp|windows|system32)/i.test(p.split("/")[0] ?? ""), // 危险根目录名
  ];
  for (const p of paths) {
    for (const test of dangerous) {
      if (test(p)) {
        violations.push(p);
        break;
      }
    }
  }
  return { safe: violations.length === 0, violations };
}
