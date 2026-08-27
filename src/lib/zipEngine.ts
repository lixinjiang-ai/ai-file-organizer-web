/**
 * V2-P5: 可复用的 ZIP 引擎
 *
 * 该模块复用 V1（FileOrganizer.tsx）的同一套 JSZip 打包逻辑：
 *   - 显式读取文件字节（Uint8Array）后再写入 zip，避免 JSZip 内部对 Blob/File 的类型探测
 *   - 使用相对路径（不含绝对路径 / 盘符），保证 ZIP 内部结构干净
 *
 * 注意：本文件是"调用适配层"，不修改 V1 的核心实现；V1 组件仍保留其内联逻辑。
 */

import JSZip from "jszip";
import type { ClassifiedFile } from "./directoryTree";

export interface ZipResult {
  /** 生成的 ZIP Blob */
  blob: Blob;
  /** ZIP 文件名（含 .zip） */
  fileName: string;
  /** ZIP 内文件数量 */
  fileCount: number;
  /** ZIP 大小（字节） */
  zipSize: number;
  /** ZIP 内出现的目录数量（不含根） */
  dirCount: number;
}

/**
 * 浏览器是否支持下载（URL.createObjectURL）
 */
export function isDownloadSupported(): boolean {
  try {
    return (
      typeof document !== "undefined" &&
      typeof URL !== "undefined" &&
      typeof URL.createObjectURL === "function" &&
      typeof document.createElement === "function"
    );
  } catch {
    return false;
  }
}

/**
 * 触发浏览器下载
 */
export function downloadBlob(blob: Blob, name: string): void {
  if (!isDownloadSupported()) {
    throw new Error("当前浏览器不支持文件下载");
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/**
 * 根据分类结果生成 ZIP
 *
 * @param items    已通过校验、去重后的文件列表（targetPath 必须为相对路径）
 * @param zipName  ZIP 文件名（默认 "AI文件整理助手_智能归档.zip"）
 */
export async function buildArchiveZip(
  items: ClassifiedFile[],
  zipName = "AI文件整理助手_智能归档.zip",
  onProgress?: (percent: number) => void,
): Promise<ZipResult> {
  if (items.length === 0) {
    throw new Error("没有可打包的文件");
  }

  const zip = new JSZip();
  const dirs = new Set<string>();

  for (const item of items) {
    const buf = new Uint8Array(await item.file.arrayBuffer());
    zip.file(item.targetPath, buf);

    // 统计目录层级
    const idx = item.targetPath.lastIndexOf("/");
    if (idx > 0) {
      const dir = item.targetPath.slice(0, idx);
      let acc = "";
      for (const seg of dir.split("/")) {
        acc = acc ? `${acc}/${seg}` : seg;
        dirs.add(acc);
      }
    }
  }

  const blob = await zip.generateAsync(
    { type: "blob" },
    onProgress
      ? (meta) => onProgress(Math.round((meta.percent ?? 0) * 100))
      : undefined,
  );

  return {
    blob,
    fileName: zipName,
    fileCount: items.length,
    zipSize: blob.size,
    dirCount: dirs.size,
  };
}
