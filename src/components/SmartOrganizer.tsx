/**
 * V2-P5: 四级目录智能归档 - 完整可交付流程 UI
 *
 * 流程：选择文件 → 解析 → 分类 → 结果预览 → 人工调整 → 确认归档 → 生成 ZIP → 下载
 *
 * 严格保持 V1（FileOrganizer.tsx / OCR / 首页 / 导航）不受影响。
 * ZIP 生成复用 zipEngine（与 V1 同一套 JSZip 逻辑）。
 */

"use client";

import { useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  smartClassify,
  buildOrganizeInput,
  type OrganizeMode,
} from "@/lib/smartOrganizer";
import { buildDirectoryTree, type ClassifiedFile } from "@/lib/directoryTree";
import {
  applyEdits,
  parseTargetPath,
  validateArchiveItems,
  findDuplicatePaths,
  resolveConflicts,
  computeArchiveStats,
  scanZipPathSafety,
  type EditLevels,
} from "@/lib/archiveEngine";
import { buildArchiveZip, downloadBlob, isDownloadSupported, type ZipResult } from "@/lib/zipEngine";

type Status = "idle" | "parsing" | "classifying" | "confirming" | "processing" | "done" | "error";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function SmartOrganizer({ apiKey }: { apiKey?: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>("idle");
  const [classifiedFiles, setClassifiedFiles] = useState<ClassifiedFile[]>([]);
  const [edits, setEdits] = useState<Record<number, EditLevels>>({});
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [zipResult, setZipResult] = useState<ZipResult | null>(null);
  const [summary, setSummary] = useState<{ total: number; success: number; ai: number; rule: number; archived: number } | null>(null);

  // V2-P4 选项
  const [userRequirement, setUserRequirement] = useState("");
  const [mode, setMode] = useState<OrganizeMode>("auto");
  const [keepFilename, setKeepFilename] = useState(false);

  // V2-P5 选项
  const [conflictStrategy, setConflictStrategy] = useState<"auto" | "manual">("auto");
  const [prefix, setPrefix] = useState<EditLevels>({ level1: "", level2: "", level3: "", fileName: "" });

  const inputRef = useRef<HTMLInputElement>(null);

  const quickTemplates = [
    { label: "按业务类型整理", req: "按业务类型整理：发票、合同、报告等分别归类" },
    { label: "按年份+业务整理", req: "按年份和业务类型整理，2025年发票放到 财务/发票/2025，合同按客户分类" },
    { label: "按项目整理", req: "按项目分类，文件名中带有项目编号的归到对应项目目录" },
    { label: "按客户整理", req: "按客户名称整理，同客户的文件放在一起" },
    { label: "按部门整理", req: "按部门分类：财务部、人事部、运营部、技术部等" },
  ];

  function applyTemplate(req: string) {
    setUserRequirement(req);
  }

  // ── 由 base + edits 计算"有效结果" ─────────────────────────────────────────
  const effectiveItems = useMemo(
    () => applyEdits(classifiedFiles, edits, keepFilename),
    [classifiedFiles, edits, keepFilename],
  );
  const stats = useMemo(() => computeArchiveStats(effectiveItems), [effectiveItems]);
  const invalidMap = useMemo(() => {
    const m = new Map<number, string>();
    effectiveItems.forEach((it, i) => {
      const v = validateArchiveItems([it]);
      if (v.invalid.length > 0) m.set(i, v.invalid[0].error);
    });
    return m;
  }, [effectiveItems]);
  const dupPaths = useMemo(
    () => new Set(findDuplicatePaths(effectiveItems.map((i) => i.targetPath))),
    [effectiveItems],
  );

  // 需人工关注的文件：降级/失败/路径非法/待确认
  const failedItems = useMemo(() => {
    const out: Array<{ fileName: string; reason: string }> = [];
    effectiveItems.forEach((it, i) => {
      const invalid = invalidMap.get(i);
      const reason = it.aiReason || (invalid ? "路径非法" : "");
      const needsAttention =
        it.needsConfirmation || invalid !== undefined || /失败|异常|兜底|降级/.test(reason);
      if (needsAttention) {
        out.push({ fileName: it.fileName, reason: reason || "需人工确认" });
      }
    });
    return out;
  }, [effectiveItems, invalidMap]);

  const phaseText =
    status === "parsing"
      ? t("smartOrganize.phase.parsing")
      : status === "classifying"
        ? t("smartOrganize.phase.classifying")
        : status === "processing"
          ? t("smartOrganize.phase.processing")
          : "";

  const isBusy = status === "parsing" || status === "classifying";

  // ── 选择文件 ───────────────────────────────────────────────────────────────
  async function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const items = e.target.files;
    if (!items || items.length === 0) {
      setError(t("smartOrganize.error.noFile"));
      setStatus("error");
      return;
    }
    setStatus("parsing");
    setError(null);
    setZipResult(null);
    setSummary(null);
    setEdits({});

    try {
      const tree = buildDirectoryTree(items);

      setStatus("parsing");
      const fileMetas = await buildOrganizeInput(items, true, (c, total) =>
        setProgress({ current: c, total }),
      );
      setProgress({ current: 0, total: fileMetas.length });

      setStatus("classifying");
      const result = await smartClassify(fileMetas, {
        apiKey,
        aiMinConfidence: 0.70,
        autoConfirm: false,
        mode,
        userRequirement: userRequirement.trim() || undefined,
        existingTree: tree,
        keepFilename,
      });

      setClassifiedFiles(result.files);
      setStatus("confirming");
    } catch (err) {
      console.error("分类失败:", err);
      setError(t("smartOrganize.error.readFail"));
      setStatus("error");
    }
  }

  // ── 单文件编辑 ─────────────────────────────────────────────────────────────
  function updateEdit(index: number, field: keyof EditLevels, value: string) {
    setEdits((prev) => {
      const base = prev[index] ?? parseTargetPath(classifiedFiles[index].targetPath);
      return { ...prev, [index]: { ...base, [field]: value } };
    });
  }

  // ── 批量操作 ───────────────────────────────────────────────────────────────
  function acceptAllAi() {
    setEdits({});
  }
  function useRuleForAll() {
    const next: Record<number, EditLevels> = {};
    classifiedFiles.forEach((cf, i) => {
      next[i] = parseTargetPath(cf.localTargetPath ?? cf.targetPath);
    });
    setEdits(next);
  }
  function restoreAiForAll() {
    const next: Record<number, EditLevels> = {};
    classifiedFiles.forEach((cf, i) => {
      next[i] = parseTargetPath(cf.aiTargetPath ?? cf.targetPath);
    });
    setEdits(next);
  }
  function clearAll() {
    const next: Record<number, EditLevels> = {};
    classifiedFiles.forEach((cf, i) => {
      next[i] = { level1: "未分类", level2: "待确认", level3: "其他", fileName: cf.fileName };
    });
    setEdits(next);
  }
  function applyPrefix() {
    if (!prefix.level1 && !prefix.level2 && !prefix.level3) return;
    const next: Record<number, EditLevels> = {};
    classifiedFiles.forEach((cf, i) => {
      const cur = edits[i] ?? parseTargetPath(cf.targetPath);
      next[i] = {
        level1: prefix.level1 || cur.level1,
        level2: prefix.level2 || cur.level2,
        level3: prefix.level3 || cur.level3,
        fileName: cf.fileName,
      };
    });
    setEdits(next);
  }

  // ── 确认归档并生成 ZIP ─────────────────────────────────────────────────────
  async function confirmAndPackage() {
    setStatus("processing");
    setError(null);
    setSummary(null);
    setProgress({ current: 0, total: 100 });

    // 0. 超大文件检查
    const oversize = effectiveItems.find((it) => it.fileSize > MAX_FILE_SIZE);
    if (oversize) {
      setError(t("smartOrganize.error.tooLarge"));
      setStatus("confirming");
      return;
    }

    // 1. 冻结并二次校验全部路径
    const { valid, invalid } = validateArchiveItems(effectiveItems);
    if (invalid.length > 0) {
      setError(t("smartOrganize.error.pathInvalid"));
      setStatus("confirming");
      return;
    }

    // 2. 冲突处理
    const { resolved, unresolved } = resolveConflicts(valid, conflictStrategy, keepFilename);
    if (unresolved.length > 0) {
      setError(t("smartOrganize.error.dupUnresolved"));
      setStatus("confirming");
      return;
    }

    // 3. 浏览器下载支持
    if (!isDownloadSupported()) {
      setError(t("smartOrganize.zip.noSupport"));
      setStatus("error");
      return;
    }

    // 4. 生成 ZIP（复用 V1 JSZip 能力），实时上报进度
    try {
      const result = await buildArchiveZip(
        resolved,
        `AI文件整理助手_智能归档_${new Date().toISOString().slice(0, 10)}.zip`,
        (pct) => setProgress({ current: pct, total: 100 }),
      );

      // 5. 防御性安全扫描：ZIP 内不得出现绝对/危险路径
      const scan = scanZipPathSafety(resolved.map((i) => i.targetPath));
      if (!scan.safe) {
        console.error("ZIP 路径安全扫描未通过:", scan.violations);
        setError(t("smartOrganize.error.unexpected"));
        setStatus("error");
        return;
      }

      setZipResult(result);
      setSummary({
        total: effectiveItems.length,
        success: valid.length,
        ai: resolved.filter((r) => r.source === "ai").length,
        rule: resolved.filter((r) => r.source === "local").length,
        archived: resolved.length,
      });
      setStatus("done");
    } catch (err) {
      console.error("ZIP 生成失败:", err);
      setError(t("smartOrganize.error.zipFail"));
      setStatus("error");
    }
  }

  function downloadNow() {
    if (!zipResult) return;
    try {
      downloadBlob(zipResult.blob, zipResult.fileName);
    } catch (err) {
      console.error("下载失败:", err);
      setError(t("smartOrganize.zip.noSupport"));
    }
  }

  function reset() {
    setClassifiedFiles([]);
    setEdits({});
    setZipResult(null);
    setSummary(null);
    setError(null);
    setStatus("idle");
  }

  // ── 渲染 ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("smartOrganize.title")}</h1>

      {/* 目录模式 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-sm font-medium text-slate-600">{t("smartOrganize.mode.label")}</p>
        <div className="flex gap-4">
          <label className="flex cursor-pointer items-start gap-2">
            <input type="radio" name="organizeMode" checked={mode === "auto"} onChange={() => setMode("auto")} className="mt-0.5 accent-[#1e5eba]" />
            <div>
              <span className="text-sm font-medium text-slate-700">{t("smartOrganize.mode.auto")}</span>
              <p className="text-xs text-slate-400">AI 根据内容自动创建目录结构</p>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <input type="radio" name="organizeMode" checked={mode === "existing"} onChange={() => setMode("existing")} className="mt-0.5 accent-[#1e5eba]" />
            <div>
              <span className="text-sm font-medium text-slate-700">{t("smartOrganize.mode.existing")}</span>
              <p className="text-xs text-slate-400">AI 只能选择你已有的目录节点</p>
            </div>
          </label>
        </div>
      </div>

      {/* 整理要求 + 模板 + 保留文件名 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <label className="mb-2 block text-sm font-medium text-slate-600">{t("smartOrganize.requirement.label")}</label>
        <textarea
          value={userRequirement}
          onChange={(e) => setUserRequirement(e.target.value)}
          placeholder={t("smartOrganize.requirement.placeholder")}
          rows={3}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-[#1e5eba] focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-400">{t("smartOrganize.requirement.hint")}</p>

        <div className="mt-3">
          <p className="mb-2 text-xs font-medium text-slate-500">{t("smartOrganize.templates.label")}</p>
          <div className="flex flex-wrap gap-2">
            {quickTemplates.map((tpl) => (
              <button key={tpl.label} onClick={() => applyTemplate(tpl.req)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:border-[#1e5eba] hover:text-[#1e5eba] transition">
                {tpl.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input type="checkbox" id="keepFilename" checked={keepFilename} onChange={(e) => setKeepFilename(e.target.checked)} className="h-4 w-4 accent-[#1e5eba]" />
          <label htmlFor="keepFilename" className="text-sm text-slate-600">{t("smartOrganize.keepFilename")}</label>
        </div>
        <p className="mt-2 text-xs text-slate-400">{t("smartOrganize.priority.note")}</p>
      </div>

      {/* 隐私 / API Key 提示 */}
      <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">🔒 {t("smartOrganize.privacy.note")}</div>
      {/* AI 分类由 Cloudflare Worker 提供，密钥不落前端；详见上方说明 */}

      {/* 选择文件 */}
      {status === "idle" || status === "error" ? (
        <div
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition ${
            isBusy ? "border-[#1e5eba] bg-[#e3ecfa]" : "border-slate-300 bg-white hover:border-[#1e5eba]"
          }`}
        >
          <div className="text-4xl">📂</div>
          <p className="mt-2 font-medium text-slate-700">{t("smartOrganize.selectFolder")}</p>
          <p className="mt-1 text-sm text-slate-400">{t("smartOrganize.folderHint")}</p>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={handleFolderSelect} {...({ webkitdirectory: "", directory: "" } as any)} />
        </div>
      ) : (
        <button onClick={reset} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:border-[#1e5eba] hover:text-[#1e5eba]">
          {t("smartOrganize.reselect")}
        </button>
      )}

      {/* 进度 */}
      {(status === "parsing" || status === "classifying" || status === "processing") && (
        <div className="space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-[#1e5eba] transition-all" style={{ width: `${stats.total ? (progress.current / Math.max(progress.total, 1)) * 100 : 0}%` }} />
          </div>
          <p className="text-sm text-slate-500">{progress.current}/{progress.total} · {phaseText}</p>
        </div>
      )}

      {/* 错误 */}
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">⚠️ {error}</p>
      )}

      {/* 统计面板 */}
      {status === "confirming" && effectiveItems.length > 0 && (
        <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-6">
          {[
            ["smartOrganize.stats.total", stats.total],
            ["smartOrganize.stats.classified", stats.classified],
            ["smartOrganize.stats.ai", stats.aiCount],
            ["smartOrganize.stats.rule", stats.ruleCount],
            ["smartOrganize.stats.pending", stats.pending],
            ["smartOrganize.stats.failed", stats.failed],
          ].map(([k, v]) => (
            <div key={k as string} className="text-center">
              <div className="text-2xl font-bold text-[#1e5eba]">{v as number}</div>
              <div className="text-xs text-slate-500">{t(k as string)}</div>
            </div>
          ))}
        </div>
      )}

      {/* 需人工关注的文件（降级/失败/路径非法/待确认） */}
      {status === "confirming" && failedItems.length > 0 && (
        <div className="space-y-2 rounded-xl border border-orange-200 bg-orange-50 p-4">
          <p className="text-sm font-medium text-orange-700">⚠️ {t("smartOrganize.failedTitle")}（{failedItems.length}）</p>
          <ul className="max-h-40 space-y-1 overflow-auto text-xs text-orange-700">
            {failedItems.map((f, i) => (
              <li key={i}>• {f.fileName}：{f.reason}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 批量操作 */}
      {status === "confirming" && effectiveItems.length > 0 && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-600">{t("smartOrganize.batch.label")}</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={acceptAllAi} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:border-[#1e5eba] hover:text-[#1e5eba]">{t("smartOrganize.batch.acceptAi")}</button>
            <button onClick={useRuleForAll} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:border-[#1e5eba] hover:text-[#1e5eba]">{t("smartOrganize.batch.useRule")}</button>
            <button onClick={restoreAiForAll} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:border-[#1e5eba] hover:text-[#1e5eba]">{t("smartOrganize.batch.restoreAi")}</button>
            <button onClick={clearAll} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:border-[#1e5eba] hover:text-[#1e5eba]">{t("smartOrganize.batch.clear")}</button>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="mb-2 text-xs text-slate-500">{t("smartOrganize.batch.prefixHint")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <input value={prefix.level1} onChange={(e) => setPrefix((p) => ({ ...p, level1: e.target.value }))} placeholder={t("smartOrganize.batch.l1")} className="w-28 rounded border border-slate-200 px-2 py-1 text-xs" />
              <input value={prefix.level2} onChange={(e) => setPrefix((p) => ({ ...p, level2: e.target.value }))} placeholder={t("smartOrganize.batch.l2")} className="w-28 rounded border border-slate-200 px-2 py-1 text-xs" />
              <input value={prefix.level3} onChange={(e) => setPrefix((p) => ({ ...p, level3: e.target.value }))} placeholder={t("smartOrganize.batch.l3")} className="w-28 rounded border border-slate-200 px-2 py-1 text-xs" />
              <button onClick={applyPrefix} className="rounded-lg bg-[#1e5eba] px-3 py-1.5 text-xs text-white hover:bg-[#0e4aa0]">{t("smartOrganize.batch.applyPrefix")}</button>
            </div>
          </div>
        </div>
      )}

      {/* 结果预览 + 人工编辑 */}
      {status === "confirming" && effectiveItems.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t("smartOrganize.preview")}</h2>
          <div className="space-y-2">
            {effectiveItems.map((item, i) => {
              const edit = edits[i] ?? parseTargetPath(item.targetPath);
              const invalid = invalidMap.get(i);
              const isDup = dupPaths.has(item.targetPath);
              return (
                <div key={i} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium text-slate-700">{item.fileName}</span>
                    <span className="text-slate-400">{formatBytes(item.fileSize)}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{item.source === "local" ? "本地规则" : "AI 辅助"}</span>
                    <span className={`rounded-full px-2 py-0.5 ${item.confidence >= 0.9 ? "bg-green-100 text-green-700" : item.confidence >= 0.7 ? "bg-blue-100 text-blue-700" : "bg-yellow-100 text-yellow-700"}`}>
                      {(item.confidence * 100).toFixed(0)}%
                    </span>
                    {invalid ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">{t("smartOrganize.edit.invalid")}</span>
                    ) : isDup ? (
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-700">{t("smartOrganize.warn.dup")}</span>
                    ) : item.needsConfirmation ? (
                      <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-yellow-700">待确认</span>
                    ) : (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">已就绪</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <input value={edit.level1} onChange={(e) => updateEdit(i, "level1", e.target.value)} placeholder={t("smartOrganize.edit.level1")} className="rounded border border-slate-200 px-2 py-1 text-xs" />
                    <input value={edit.level2} onChange={(e) => updateEdit(i, "level2", e.target.value)} placeholder={t("smartOrganize.edit.level2")} className="rounded border border-slate-200 px-2 py-1 text-xs" />
                    <input value={edit.level3} onChange={(e) => updateEdit(i, "level3", e.target.value)} placeholder={t("smartOrganize.edit.level3")} className="rounded border border-slate-200 px-2 py-1 text-xs" />
                    <input
                      value={keepFilename ? item.fileName : edit.fileName}
                      onChange={(e) => updateEdit(i, "fileName", e.target.value)}
                      disabled={keepFilename}
                      placeholder={t("smartOrganize.edit.fileName")}
                      className="rounded border border-slate-200 px-2 py-1 text-xs disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>
                  {invalid && <p className="mt-1 text-xs text-red-600">{invalid}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 冲突策略 + 确认归档 */}
      {status === "confirming" && effectiveItems.length > 0 && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-600">{t("smartOrganize.conflict.label")}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="radio" name="conflict" checked={conflictStrategy === "auto"} onChange={() => setConflictStrategy("auto")} className="accent-[#1e5eba]" />
                {t("smartOrganize.conflict.auto")}
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="radio" name="conflict" checked={conflictStrategy === "manual"} onChange={() => setConflictStrategy("manual")} className="accent-[#1e5eba]" />
                {t("smartOrganize.conflict.manual")}
              </label>
            </div>
          </div>
          <button
            onClick={confirmAndPackage}
            disabled={status !== "confirming"}
            className="w-full rounded-xl bg-[#1e5eba] px-5 py-3 font-semibold text-white transition hover:bg-[#0e4aa0] disabled:opacity-60"
          >
            {t("smartOrganize.confirmBtn")}
          </button>
        </div>
      )}

      {/* 完成 */}
      {status === "done" && zipResult && (
        <div className="space-y-4 rounded-xl border border-green-200 bg-green-50 p-6">
          <p className="text-lg font-bold text-green-700">✅ {t("smartOrganize.zip.title")}</p>
          {summary && (
            <p className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-green-800">
              {t("smartOrganize.summary")
                .replace("{total}", String(summary.total))
                .replace("{success}", String(summary.success))
                .replace("{ai}", String(summary.ai))
                .replace("{rule}", String(summary.rule))
                .replace("{archived}", String(summary.archived))}
            </p>
          )}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-slate-500">{t("smartOrganize.zip.name")}</dt><dd className="font-medium text-slate-700">{zipResult.fileName}</dd></div>
            <div><dt className="text-slate-500">{t("smartOrganize.zip.files")}</dt><dd className="font-medium text-slate-700">{zipResult.fileCount}</dd></div>
            <div><dt className="text-slate-500">{t("smartOrganize.zip.size")}</dt><dd className="font-medium text-slate-700">{formatBytes(zipResult.zipSize)}</dd></div>
            <div><dt className="text-slate-500">{t("smartOrganize.zip.dirs")}</dt><dd className="font-medium text-slate-700">{zipResult.dirCount}</dd></div>
          </dl>
          <div className="flex gap-3">
            <button onClick={downloadNow} className="rounded-xl bg-[#1e5eba] px-5 py-2.5 font-semibold text-white hover:bg-[#0e4aa0]">{t("smartOrganize.zip.download")}</button>
            <button onClick={reset} className="rounded-xl border border-slate-300 px-5 py-2.5 text-slate-600 hover:border-[#1e5eba] hover:text-[#1e5eba]">{t("smartOrganize.zip.reorganize")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
