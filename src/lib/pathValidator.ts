/**
 * 四级目录智能归档 - 路径验证器
 *
 * 防止路径遍历攻击、非法路径、重复创建目录等问题
 */

/**
 * 验证目标路径安全性
 */
export function validateTargetPath(path: string): { valid: boolean; error?: string } {
  // 1. 禁止路径穿越
  if (path.includes("..") || path.includes("~") || path.startsWith("/")) {
    return { valid: false, error: "路径包含非法字符（禁止 ../、绝对路径）" };
  }

  // 2. 禁止特殊字符
  if (/[\x00-\x1f<>:"|?*]/.test(path)) {
    return { valid: false, error: "路径包含非法字符" };
  }

  // 3. 检查层级深度（不超过4级）
  const parts = path.split("/").filter(Boolean);
  if (parts.length > 4) {
    return { valid: false, error: "路径层级超过4级" };
  }

  // 4. 检查每级名称长度
  for (const part of parts) {
    if (part.length > 100) {
      return { valid: false, error: `目录名过长: ${part}` };
    }
    if (!part.trim()) {
      return { valid: false, error: "目录名不能为空" };
    }
  }

  return { valid: true };
}

/**
 * 验证分类结果的一致性（目录是否已存在于索引中）
 */
export function validateClassificationIndex(
  newPaths: string[],
  existingIndex: Set<string>,
): { conflicts: string[]; errors: string[] } {
  const conflicts: string[] = [];
  const errors: string[] = [];

  for (const path of newPaths) {
    if (existingIndex.has(path)) {
      conflicts.push(path);
    }
    const validation = validateTargetPath(path);
    if (!validation.valid) {
      errors.push(`${path}: ${validation.error}`);
    }
  }

  return { conflicts, errors };
}

/**
 * 生成唯一路径（处理文件名冲突）
 */
export function makeUniquePath(
  basePath: string,
  usedPaths: Set<string>,
): string {
  if (!usedPaths.has(basePath)) {
    return basePath;
  }

  const parts = basePath.split("/");
  const fileName = parts.pop()!;
  const extIndex = fileName.lastIndexOf(".");
  const baseName = extIndex > 0 ? fileName.slice(0, extIndex) : fileName;
  const ext = extIndex > 0 ? fileName.slice(extIndex) : "";

  let counter = 1;
  while (true) {
    const newName = `${baseName}_${counter}${ext}`;
    const newPath = [...parts, newName].join("/");
    if (!usedPaths.has(newPath)) {
      return newPath;
    }
    counter++;
  }
}
