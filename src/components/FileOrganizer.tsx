"use client";

import { useRef, useState } from "react";
import JSZip from "jszip";
import { useI18n } from "@/lib/i18n";
import {
  categoryOf,
  humanSize,
  CATEGORIES,
  Category,
} from "@/lib/categories";

type Item = { id: string; file: File; category: Category };
type Status = "idle" | "processing" | "done" | "error";

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

export function FileOrganizer() {
  const { t } = useI18n();
  const [items, setItems] = useState<Item[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next: Item[] = Array.from(list).map((f) => ({
      id:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${f.name}-${f.size}-${Math.random()}`,
      file: f,
      category: categoryOf(f.name),
    }));
    setItems((prev) => [...prev, ...next]);
    setStatus("idle");
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  async function organize() {
    if (items.length === 0) return;
    setStatus("processing");
    try {
      const zip = new JSZip();
      const used = new Set<string>();
      for (const it of items) {
        let name = it.file.name;
        let path = `${it.category}/${name}`;
        let i = 1;
        while (used.has(path)) {
          const dot = name.lastIndexOf(".");
          const base = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : "";
          name = `${base}_${i}${ext}`;
          path = `${it.category}/${name}`;
          i++;
        }
        used.add(path);
        zip.file(path, it.file);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, "AI-File-Organizer.zip");
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  const grouped: Record<Category, Item[]> = Object.fromEntries(
    CATEGORIES.map((c) => [c, [] as Item[]]),
  ) as Record<Category, Item[]>;
  for (const it of items) grouped[it.category].push(it);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("organize.title")}</h1>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition ${
          dragOver
            ? "border-[#1e5eba] bg-[#e3ecfa]"
            : "border-slate-300 bg-white hover:border-[#1e5eba]"
        }`}
      >
        <div className="text-4xl">📥</div>
        <p className="mt-2 font-medium text-slate-700">{t("organize.drop")}</p>
        <p className="mt-1 text-sm text-slate-400">{t("organize.hint")}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      <p className="text-xs text-slate-400">🔒 {t("organize.local")}</p>

      {items.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-slate-400">
          {t("organize.empty")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              <b className="text-[#1e5eba]">{items.length}</b> {t("organize.files")}
            </p>
            <button
              onClick={organize}
              disabled={status === "processing"}
              className="rounded-xl bg-[#1e5eba] px-5 py-2.5 font-semibold text-white transition hover:bg-[#0e4aa0] disabled:opacity-60"
            >
              {status === "processing" ? t("organize.processing") : t("organize.organizeBtn")}
            </button>
          </div>

          {status === "done" && (
            <p className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">
              ✅ {t("organize.done")}
            </p>
          )}
          {status === "error" && (
            <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
              ⚠️ {t("organize.error")}
            </p>
          )}

          <div className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t("organize.byCategory")}
            </h2>
            {CATEGORIES.filter((c) => grouped[c].length > 0).map((c) => (
              <div
                key={c}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white"
              >
                <div className="flex items-center justify-between bg-slate-50 px-4 py-2">
                  <span className="font-medium text-slate-700">
                    📁 {c}
                  </span>
                  <span className="text-xs text-slate-400">
                    {grouped[c].length}
                  </span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {grouped[c].map((it) => (
                    <li
                      key={it.id}
                      className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                    >
                      <span className="truncate text-slate-700">
                        {it.file.name}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-xs text-slate-400">
                          {humanSize(it.file.size)}
                        </span>
                        <button
                          onClick={() => removeItem(it.id)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          {t("organize.remove")}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
