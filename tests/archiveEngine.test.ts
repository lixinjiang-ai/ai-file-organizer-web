/**
 * V2-P5: 归档执行引擎测试套件
 *
 * 覆盖：预览统计、单文件/批量修改、恢复 AI 建议、pathValidator 二次验证、
 * 各类非法路径拒绝、重复检测、冲突自动处理、keepFilename、ZIP 内部结构安全等。
 */

import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import type { ClassifiedFile } from "../src/lib/directoryTree";
import {
  applyEdits,
  parseTargetPath,
  validateEdit,
  validateArchiveItems,
  findDuplicatePaths,
  resolveConflicts,
  computeArchiveStats,
  scanZipPathSafety,
} from "../src/lib/archiveEngine";
import { validateTargetPath } from "../src/lib/pathValidator";
import { buildArchiveZip, isDownloadSupported } from "../src/lib/zipEngine";

function makeFile(name: string, content = "x"): File {
  return new File([content], name);
}

function makeClassified(over: Partial<ClassifiedFile> & { targetPath: string }): ClassifiedFile {
  const parts = over.targetPath.split("/");
  const fileName = parts.pop() ?? over.targetPath;
  const level3 = parts.pop() ?? "";
  const level2 = parts.pop() ?? "";
  const level1 = parts.pop() ?? "";
  return {
    originalPath: over.targetPath,
    fileName,
    fileSize: over.fileSize ?? 100,
    file: over.file ?? makeFile(fileName),
    confidence: over.confidence ?? 0.9,
    level1,
    level2,
    level3,
    targetPath: over.targetPath,
    source: over.source ?? "local",
    needsConfirmation: over.needsConfirmation ?? false,
    localTargetPath: over.localTargetPath ?? over.targetPath,
    aiTargetPath: over.aiTargetPath ?? over.targetPath,
  };
}

describe("V2-P5: 预览与统计", () => {
  it("预览结果应正确反映分类（预览统计准确）", () => {
    const base = [
      makeClassified({ targetPath: "财务资料/发票/2025/发票_01.pdf", source: "ai", confidence: 0.94 }),
      makeClassified({ targetPath: "商务合同/合作协议/2024/合同A.docx", source: "local", confidence: 0.9 }),
      makeClassified({ targetPath: "未分类/待确认/其他/神秘.xyz", source: "local", confidence: 0.4, needsConfirmation: true }),
    ];
    const stats = computeArchiveStats(base);
    expect(stats.total).toBe(3);
    expect(stats.aiCount).toBe(1);
    expect(stats.ruleCount).toBe(2);
    expect(stats.pending).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.classified).toBe(3);
  });

  it("路径非法的文件计入分类失败", () => {
    const base = [makeClassified({ targetPath: "../secret.txt" })];
    const stats = computeArchiveStats(base);
    expect(stats.failed).toBe(1);
    expect(stats.classified).toBe(0);
  });
});

describe("V2-P5: 人工修改目录", () => {
  it("单文件修改目录应更新目标路径", () => {
    const base = [makeClassified({ targetPath: "财务资料/发票/2025/发票_01.pdf" })];
    const next = applyEdits(base, { 0: { level1: "财务", level2: "发票凭证", level3: "2024", fileName: "发票_01.pdf" } }, false);
    expect(next[0].targetPath).toBe("财务/发票凭证/2024/发票_01.pdf");
    expect(next[0].needsConfirmation).toBe(false);
  });

  it("批量修改目录应统一设置层级", () => {
    const base = [
      makeClassified({ targetPath: "A/B/C/1.pdf" }),
      makeClassified({ targetPath: "D/E/F/2.pdf" }),
    ];
    const edits: Record<number, any> = {};
    base.forEach((cf, i) => {
      const cur = parseTargetPath(cf.targetPath);
      edits[i] = { level1: "统一一级", level2: cur.level2, level3: cur.level3, fileName: cf.fileName };
    });
    const next = applyEdits(base, edits, false);
    expect(next[0].targetPath).toBe("统一一级/B/C/1.pdf");
    expect(next[1].targetPath).toBe("统一一级/E/F/2.pdf");
  });

  it("恢复 AI 建议应回到 aiTargetPath", () => {
    const base = [
      makeClassified({
        targetPath: "财务资料/发票/2025/发票_01.pdf",
        localTargetPath: "财务资料/发票/2025/发票_01.pdf",
        aiTargetPath: "财务/发票/2025/发票_01.pdf",
      }),
    ];
    const next = applyEdits(base, { 0: parseTargetPath(base[0].aiTargetPath!) }, false);
    expect(next[0].targetPath).toBe("财务/发票/2025/发票_01.pdf");
  });
});

describe("V2-P5: pathValidator 二次验证", () => {
  it("合法路径通过校验", () => {
    const base = [makeClassified({ targetPath: "财务/发票/2025/发票.pdf" })];
    const { invalid } = validateArchiveItems(base);
    expect(invalid).toHaveLength(0);
  });

  it("../ 路径被拒绝", () => {
    expect(validateEdit({ level1: "..", level2: "x", level3: "y", fileName: "a.pdf" }, false).valid).toBe(false);
    expect(validateTargetPath("foo/../../etc/passwd").valid).toBe(false);
  });

  it("Windows 绝对路径被拒绝", () => {
    expect(validateEdit({ level1: "C:", level2: "x", level3: "y", fileName: "a.pdf" }, false).valid).toBe(false);
    expect(validateTargetPath("D:/Downloads/a.pdf").valid).toBe(false);
  });

  it("四级以上路径被拒绝", () => {
    expect(validateTargetPath("a/b/c/d/e").valid).toBe(false);
    expect(validateTargetPath("a/b/c/d.pdf").valid).toBe(true);
  });

  it("空层级或空文件名被拒绝", () => {
    expect(validateEdit({ level1: "", level2: "x", level3: "y", fileName: "a.pdf" }, false).valid).toBe(false);
    expect(validateEdit({ level1: "x", level2: "y", level3: "z", fileName: "" }, false).valid).toBe(false);
  });
});

describe("V2-P5: 重复目标路径与冲突处理", () => {
  it("应能检测重复目标路径", () => {
    const dups = findDuplicatePaths(["a/b/c.pdf", "a/b/c.pdf", "a/b/d.pdf"]);
    expect(dups).toContain("a/b/c.pdf");
    expect(dups).toHaveLength(1);
  });

  it("策略 A 自动追加序号解决冲突", () => {
    const base = [
      makeClassified({ targetPath: "财务/发票/2025/发票.pdf" }),
      makeClassified({ targetPath: "财务/发票/2025/发票.pdf" }),
    ];
    const { resolved, unresolved } = resolveConflicts(base, "auto", false);
    expect(unresolved).toHaveLength(0);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].targetPath).toBe("财务/发票/2025/发票.pdf");
    expect(resolved[1].targetPath).toBe("财务/发票/2025/发票_1.pdf");
  });

  it("策略 B 返回人工修改", () => {
    const base = [
      makeClassified({ targetPath: "财务/发票/2025/发票.pdf" }),
      makeClassified({ targetPath: "财务/发票/2025/发票.pdf" }),
    ];
    const { resolved, unresolved } = resolveConflicts(base, "manual", false);
    expect(resolved).toHaveLength(1);
    expect(unresolved).toHaveLength(1);
  });

  it("keepFilename=true 时冲突无法自动解决则交回用户（不静默覆盖）", () => {
    const base = [
      makeClassified({ targetPath: "财务/发票/2025/发票.pdf" }),
      makeClassified({ targetPath: "财务/发票/2025/发票.pdf" }),
    ];
    const { unresolved } = resolveConflicts(base, "auto", true);
    // 四级别已满，加冲突目录会超 4 级 → 交回用户
    expect(unresolved.length).toBeGreaterThan(0);
  });

  it("keepFilename=true 时文件名锁定为原文件名", () => {
    const base = [makeClassified({ targetPath: "财务/发票/2025/发票_01.pdf" })];
    const next = applyEdits(base, { 0: { level1: "财务", level2: "发票", level3: "2025", fileName: "被改的名字.pdf" } }, true);
    expect(next[0].fileName).toBe("发票_01.pdf");
    expect(next[0].targetPath).toBe("财务/发票/2025/发票_01.pdf");
  });

  it("keepFilename=false 时文件名可被修改", () => {
    const base = [makeClassified({ targetPath: "财务/发票/2025/发票_01.pdf" })];
    const next = applyEdits(base, { 0: { level1: "财务", level2: "发票", level3: "2025", fileName: "新名字.pdf" } }, false);
    expect(next[0].targetPath).toBe("财务/发票/2025/新名字.pdf");
  });
});

describe("V2-P5: ZIP 内部结构与安全", () => {
  it("ZIP 内部不得出现绝对路径 / 盘符 / ../", async () => {
    const base = [
      makeClassified({ targetPath: "财务/发票/2025/发票_01.pdf" }),
      makeClassified({ targetPath: "合同/客户A/项目合同.docx" }),
      makeClassified({ targetPath: "报告/年度/2024/总结.pdf" }),
    ];
    const result = await buildArchiveZip(base, "test.zip");
    const zip = await JSZip.loadAsync(result.blob);
    const entries = Object.keys(zip.files);
    // 目录结构正确
    expect(entries).toContain("财务/发票/2025/发票_01.pdf");
    expect(entries).toContain("合同/客户A/项目合同.docx");
    expect(entries).toContain("报告/年度/2024/总结.pdf");
    // 无绝对路径 / 盘符 / ../
    expect(entries.some((e) => e.startsWith("/") || /^[A-Za-z]:/.test(e))).toBe(false);
    expect(entries.some((e) => e.includes(".."))).toBe(false);
  });

  it("scanZipPathSafety 能识别危险路径", () => {
    const bad = scanZipPathSafety(["C:/Users/me/a.pdf", "/etc/passwd", "a/../../b.pdf", "财务/发票/2025/a.pdf"]);
    expect(bad.safe).toBe(false);
    expect(bad.violations.length).toBe(3);
    const good = scanZipPathSafety(["财务/发票/2025/a.pdf"]);
    expect(good.safe).toBe(true);
  });

  it("ZIP 结果包含正确的文件数 / 目录数", async () => {
    const base = [
      makeClassified({ targetPath: "财务/发票/2025/发票_01.pdf" }),
      makeClassified({ targetPath: "财务/发票/2025/发票_02.pdf" }),
      makeClassified({ targetPath: "合同/客户A/合同.docx" }),
    ];
    const result = await buildArchiveZip(base, "multi.zip");
    expect(result.fileCount).toBe(3);
    expect(result.dirCount).toBeGreaterThanOrEqual(2); // 财务/发票/2025 + 合同/客户A
    expect(result.fileName).toBe("multi.zip");
    expect(result.zipSize).toBeGreaterThan(0);
  });
});

describe("V2-P5: 边界与错误处理", () => {
  it("空文件列表应拒绝打包", async () => {
    await expect(buildArchiveZip([], "empty.zip")).rejects.toThrow();
  });

  it("文件读取失败应导致 ZIP 生成失败", async () => {
    const broken = makeClassified({ targetPath: "财务/发票/2025/发票.pdf" });
    // 模拟读取失败
    (broken as any).file = { arrayBuffer: () => Promise.reject(new Error("read fail")) } as any;
    await expect(buildArchiveZip([broken], "broken.zip")).rejects.toThrow();
  });

  it("浏览器下载支持检测返回布尔值", () => {
    expect(typeof isDownloadSupported()).toBe("boolean");
  });

  it("完成状态下所有路径唯一且无冲突", () => {
    const base = [
      makeClassified({ targetPath: "财务/发票/2025/发票.pdf" }),
      makeClassified({ targetPath: "财务/发票/2025/发票.pdf" }),
      makeClassified({ targetPath: "合同/A/合同.docx" }),
    ];
    const resolved = resolveConflicts(base, "auto", false).resolved;
    const paths = resolved.map((r) => r.targetPath);
    expect(new Set(paths).size).toBe(paths.length); // 全部唯一
  });
});
