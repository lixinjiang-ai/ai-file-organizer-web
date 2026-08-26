/**
 * 四级目录智能归档 - 目录树构建模块
 *
 * 四级目录结构：
 *   Level 1: 一级分类（如"财务资料"、"项目文档"）
 *   Level 2: 二级分类（如"合同"、"发票"）
 *   Level 3: 三级分类（如"2024年"、"2025年"）
 *   Level 4: 文件名
 */

export interface DirectoryNode {
  name: string;
  type: "file" | "directory";
  children?: DirectoryNode[];
  size?: number;
  lastModified?: number;
}

export interface ClassifiedFile {
  originalPath: string;
  fileName: string;
  fileSize: number;
  file: File;
  confidence: number;
  level1: string;
  level2: string;
  level3: string;
  targetPath: string;
  source: "local" | "ai";
  needsConfirmation?: boolean;
  aiReason?: string;
}

export interface ClassificationResult {
  files: ClassifiedFile[];
  stats: {
    total: number;
    localClassified: number;
    aiClassified: number;
    needsConfirmation: number;
    errors: number;
  };
}

/**
 * 从 FileList 构建目录树
 */
export function buildDirectoryTree(
  items: DataTransferItemList | FileList | File[],
): DirectoryNode {
  const root: DirectoryNode = { name: "root", type: "directory", children: [] };

  function addFile(path: string, file: File) {
    const parts = path.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = current.children!.find((c) => c.name === part);
      if (!child) {
        child = isLast
          ? { name: part, type: "file", size: file.size, lastModified: file.lastModified }
          : { name: part, type: "directory", children: [] };
        current.children!.push(child);
      }
      if (!isLast) current = child;
    }
  }

  // DataTransferItemList 在 Node.js 环境未定义，需要安全检测
  if (typeof DataTransferItemList !== "undefined" && items instanceof DataTransferItemList) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) addFile(file.name, file);
      }
    }
  } else if (items instanceof FileList) {
    for (const file of Array.from(items)) {
      addFile(file.name, file);
    }
  } else {
    // File[] 数组
    for (const file of items as File[]) {
      addFile(file.name, file);
    }
  }

  return root;
}

/**
 * 从目录树中提取所有文件路径
 */
export function extractFilePaths(node: DirectoryNode, prefix = ""): string[] {
  const paths: string[] = [];
  if (!node.children) return paths;
  for (const child of node.children) {
    const path = prefix ? `${prefix}/${child.name}` : child.name;
    if (child.type === "file") {
      paths.push(path);
    } else {
      paths.push(...extractFilePaths(child, path));
    }
  }
  return paths;
}

/**
 * 从路径中获取文件名
 */
export function getFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * 从路径中获取目录部分
 */
export function getDirectoryPath(path: string): string {
  const parts = path.split("/");
  return parts.slice(0, -1).join("/");
}
