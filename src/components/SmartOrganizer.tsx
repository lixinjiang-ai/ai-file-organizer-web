/**
 * V2-P4: 四级目录智能归档 - UI 组件
 *
 * 支持：
 * 1. 可选"整理要求"输入框
 * 2. 两种目录模式（A=自动/ B=现有结构）
 * 3. AI 隐私提示
 * 4. 分类结果预览 + 人工确认
 * 5. ZIP 打包下载
 */

"use client";

import { useRef, useState } from "react";
import JSZip from "jszip";
import { useI18n } from "@/lib/i18n";
import { smartClassify, type OrganizeMode, buildOrganizeInput } from "@/lib/smartOrganizer";
import { buildDirectoryTree } from "@/lib/directoryTree";
import type { ClassifiedFile } from "@/lib/directoryTree";

type Status = "idle" | "parsing" | "classifying" | "confirming" | "processing" | "done" | "error";

interface SmartOrganizerProps {
  apiKey?: string;
}

export function SmartOrganizer({ apiKey }: SmartOrganizerProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>("idle");
  const [classifiedFiles, setClassifiedFiles] = useState<ClassifiedFile[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // V2-P4: 整理要求和目录模式
  const [userRequirement, setUserRequirement] = useState("");
  const [mode, setMode] = useState<OrganizeMode>("auto");
  const [existingTree, setExistingTree] = useState<any>(null);
  const [keepFilename, setKeepFilename] = useState(false);

  // V2-P4: 快速模板
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

  // 手动确认状态
  const [confirmedPaths, setConfirmedPaths] = useState<Set<string>>(new Set());

  /**
   * 处理文件夹选择
   */
  async function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const items = e.target.files;
    if (!items || items.length === 0) return;

    setStatus("parsing");
    setError(null);

    try {
      // 1. 构建目录树（用于 mode=existing）
      const tree = buildDirectoryTree(items);
      setExistingTree(tree);

      // 2. 解析文件（提取文本内容）
      setStatus("parsing");
      const fileMetas = await buildOrganizeInput(items, true);

      // 3. 智能分类
      setStatus("classifying");
      setProgress({ current: 0, total: fileMetas.length });

      const result = await smartClassify(fileMetas, {
        apiKey,
        aiMinConfidence: 0.70,
        autoConfirm: false,
        mode,
        userRequirement: userRequirement.trim() || undefined,
        existingTree,
        keepFilename,
      });

      setClassifiedFiles(result.files);
      setStats(result.stats);
      setStatus("confirming");
    } catch (err) {
      console.error("分类失败:", err);
      setError(String(err));
      setStatus("error");
    }
  }

  /**
   * 切换确认状态
   */
  function toggleConfirm(path: string) {
    setConfirmedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  /**
   * 确认并打包
   */
  async function confirmAndPackage() {
    setStatus("processing");
    setError(null);

    try {
      const zip = new JSZip();
      const usedPaths = new Set<string>();
      let processed = 0;
      const total = classifiedFiles.length;

      for (const item of classifiedFiles) {
        if (item.needsConfirmation && !confirmedPaths.has(item.targetPath)) {
          continue;
        }

        let path = item.targetPath;
        path = makeUniquePath(path, usedPaths);
        usedPaths.add(path);

        const buf = new Uint8Array(await item.file.arrayBuffer());
        zip.file(path, buf);

        processed++;
        setProgress({ current: processed, total });
      }

      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, "AI文件整理助手_智能归档.zip");
      setStatus("done");
    } catch (err) {
      console.error("打包失败:", err);
      setError(String(err));
      setStatus("error");
    }
  }

  function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function makeUniquePath(basePath: string, usedPaths: Set<string>): string {
    if (!usedPaths.has(basePath)) return basePath;
    const parts = basePath.split("/");
    const fileName = parts.pop()!;
    const dot = fileName.lastIndexOf(".");
    const base = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : "";
    let i = 1;
    while (true) {
      const newName = `${base}_${i}${ext}`;
      const newPath = [...parts, newName].join("/");
      if (!usedPaths.has(newPath)) return newPath;
      i++;
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("smartOrganize.title")}</h1>

      {/* V2-P4: 目录模式选择 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-sm font-medium text-slate-600">{t("smartOrganize.mode.label")}</p>
        <div className="flex gap-4">
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="organizeMode"
              checked = {mode === "auto"}
              onChange={() => setMode("auto")}
              className="mt-0.5 accent-[#1e5eba]"
            />
            <div>
              <span className="text-sm font-medium text-slate-700">{t("smartOrganize.mode.auto")}</span>
              <p className="text-xs text-slate-400">AI 根据内容自动创建目录结构</p>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="organizeMode"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              className="mt-0.5 accent-[#1e5eba]"
            />
            <div>
              <span className="text-sm font-medium text-slate-700">{t("smartOrganize.mode.existing")}</span>
              <p className="text-xs text-slate-400">AI 只能选择你已有的目录节点</p>
            </div>
          </label>
        </div>
      </div>

      {/* V2-P4: 整理要求输入框 + 快速模板 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <label className="mb-2 block text-sm font-medium text-slate-600">
          {t("smartOrganize.requirement.label")}
        </label>
        <textarea
          value={userRequirement}
          onChange={(e) => setUserRequirement(e.target.value)}
          placeholder={t("smartOrganize.requirement.placeholder")}
          rows={3}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-[#1e5eba] focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-400">{t("smartOrganize.requirement.hint")}</p>

        {/* V2-P4: 快速模板按钮 */}
        <div className="mt-3">
          <p className="mb-2 text-xs font-medium text-slate-500">{t("smartOrganize.templates.label")}</p>
          <div className="flex flex-wrap gap-2">
            {quickTemplates.map((tpl) => (
              <button
                key={tpl.label}
                onClick={() => applyTemplate(tpl.req)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:border-[#1e5eba] hover:text-[#1e5eba] transition"
              >
                {tpl.label}
              </button>
            ))}
          </div>
        </div>

        {/* V2-P4: 保留原文件名选项 */}
        <div className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            id="keepFilename"
            checked={keepFilename}
            onChange={(e) => setKeepFilename(e.target.checked)}
            className="h-4 w-4 accent-[#1e5eba]"
          />
          <label htmlFor="keepFilename" className="text-sm text-slate-600">
            {t("smartOrganize.keepFilename")}
          </label>
        </div>

        <p className="mt-2 text-xs text-slate-400">{t("smartOrganize.priority.note")}</p>
      </div>

      {/* 隐私提示 */}
      <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
        🔒 {t("smartOrganize.privacy.note")}
      </div>

      {/* API Key 提示 */}
      {!apiKey && (
        <div className="rounded-lg bg-yellow-50 px-4 py-3 text-sm text-yellow-700">
          ⚠️ {t("smartOrganize.noApiKey")}
        </div>
      )}

      {/* 文件夹选择 */}
      <div
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition ${
          status === "parsing" || status === "classifying"
            ? "border-[#1e5eba] bg-[#e3ecfa]"
            : "border-slate-300 bg-white hover:border-[#1e5eba]"
        }`}
      >
        <div className="text-4xl">📂</div>
        <p className="mt-2 font-medium text-slate-700">{t("smartOrganize.selectFolder")}</p>
        <p className="mt-1 text-sm text-slate-400">{t("smartOrganize.folderHint")}</p>
        <input
          ref={inputRef}
          type="file"
          // @ts-expect-error - webkitdirectory is browser-specific
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={handleFolderSelect}
        />
      </div>

      {/* 进度显示 */}
      {(status === "parsing" || status === "classifying" || status === "processing") && (
        <div className="space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-[#1e5eba] transition-all"
              style={{ width: `${stats ? (progress.current / Math.max(progress.total, 1)) * 100 : 0}%` }}
            />
          </div>
          <p className="text-sm text-slate-500">
            {progress.current}/{progress.total}
          </p>
        </div>
      )}

      {/* 错误信息 */}
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">⚠️ {error}</p>
      )}

      {/* 分类结果预览 */}
      {status === "confirming" && classifiedFiles.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t("smartOrganize.preview")}
            </h2>
            <span className="text-xs text-slate-400">
              本地: {stats?.localClassified} | AI: {stats?.aiClassified} | 待确认: {stats?.needsConfirmation}
            </span>
          </div>

          <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left">文件</th>
                  <th className="px-4 py-2 text-left">目录</th>
                  <th className="px-4 py-2 text-center">置信度</th>
                  <th className="px-4 py-2 text-center">来源</th>
                  <th className="px-4 py-2 text-center">确认</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {classifiedFiles.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-700">{item.fileName}</td>
                    <td className="px-4 py-2 text-slate-500 text-xs">{item.targetPath}</td>
                    <td className="px-4 py-2 text-center">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                          item.confidence >= 0.9
                            ? "bg-green-100 text-green-700"
                            : item.confidence >= 0.7
                            ? "bg-blue-100 text-blue-700"
                            : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {(item.confidence * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className="text-xs text-slate-400">{item.source === "local" ? "本地规则" : "AI辅助"}</span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {item.needsConfirmation && (
                        <button
                          onClick={() => toggleConfirm(item.targetPath)}
                          className={`rounded px-2 py-1 text-xs ${
                            confirmedPaths.has(item.targetPath)
                              ? "bg-green-500 text-white"
                              : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                          }`}
                        >
                          {confirmedPaths.has(item.targetPath) ? "✓ 已确认" : "确认"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={confirmAndPackage}
            disabled={status !== "confirming"}
            className="rounded-xl bg-[#1e5eba] px-5 py-2.5 font-semibold text-white transition hover:bg-[#0e4aa0] disabled:opacity-60"
          >
            确认并打包
          </button>
        </div>
      )}

      {/* 完成状态 */}
      {status === "done" && (
        <p className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">
          ✅ {t("smartOrganize.done")}
        </p>
      )}
    </div>
  );
}
