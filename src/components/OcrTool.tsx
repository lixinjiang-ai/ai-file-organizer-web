"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

type OcrLang = "eng" | "chi_sim";
type Status = "idle" | "running" | "done" | "error";

export function OcrTool() {
  const { t } = useI18n();
  const [img, setImg] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");
  const [ocrLang, setOcrLang] = useState<OcrLang>("chi_sim");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function onSelect(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    setImg(f);
    setText("");
    setStatus("idle");
    setCopied(false);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
  }

  async function run() {
    if (!img) return;
    setStatus("running");
    setText("");
    try {
      const Tesseract = (await import("tesseract.js")).default;
      const worker = await Tesseract.createWorker(ocrLang);
      const { data } = await worker.recognize(img);
      setText(data.text || "");
      await worker.terminate();
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  function downloadText() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "文字识别结果.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("ocr.title")}</h1>

      <div
        onClick={() => inputRef.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white p-10 text-center hover:border-[#1e5eba]"
      >
        <div className="text-4xl">🖼️</div>
        <p className="mt-2 font-medium text-slate-700">{t("ocr.drop")}</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onSelect(e.target.files)}
        />
      </div>

      <p className="text-xs text-slate-400">🔒 {t("ocr.note")}</p>

      {img && (
        <div className="space-y-4">
          {preview && (
            <img
              src={preview}
              alt="preview"
              className="max-h-64 rounded-xl border border-slate-200"
            />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-600">
              {t("ocr.lang")}:
              <select
                value={ocrLang}
                onChange={(e) => setOcrLang(e.target.value as OcrLang)}
                className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5"
              >
                <option value="eng">英文</option>
                <option value="chi_sim">中文（简体）</option>
              </select>
            </label>
            <button
              onClick={run}
              disabled={status === "running"}
              className="rounded-xl bg-[#1e5eba] px-5 py-2.5 font-semibold text-white transition hover:bg-[#0e4aa0] disabled:opacity-60"
            >
              {status === "running" ? t("ocr.running") : t("ocr.run")}
            </button>
          </div>

          {status === "error" && (
            <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
              ⚠️ {t("ocr.error")}
            </p>
          )}

          {text && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {t("ocr.result")}
                </h2>
                <div className="flex gap-2">
                  <button
                    onClick={copy}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                  >
                    {copied ? t("ocr.copied") : t("ocr.copy")}
                  </button>
                  <button
                    onClick={downloadText}
                    className="rounded-lg bg-[#16263d] px-3 py-1.5 text-sm font-medium text-white hover:bg-black"
                  >
                    {t("ocr.download")}
                  </button>
                </div>
              </div>
              <textarea
                readOnly
                value={text}
                className="h-48 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"
              />
            </div>
          )}
        </div>
      )}

      {!img && <p className="text-center text-slate-400">{t("ocr.empty")}</p>}
    </div>
  );
}
