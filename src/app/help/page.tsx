"use client";

import { useI18n } from "@/lib/i18n";

export default function HelpPage() {
  const { t } = useI18n();
  const steps = ["help.step1", "help.step2", "help.step3"];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("help.title")}</h1>

      <p className="rounded-2xl bg-white p-5 text-sm text-slate-600">
        {t("help.intro")}
      </p>

      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li
            key={s}
            className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4"
          >
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#1e5eba] text-sm font-bold text-white">
              {i + 1}
            </span>
            <span className="text-sm text-slate-700">{t(s)}</span>
          </li>
        ))}
      </ol>

      <p className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">
        🔒 {t("help.privacy")}
      </p>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-800">🍎 {t("help.mac.title")}</h2>
        <p className="mt-2 text-sm text-slate-500">{t("help.mac.desc")}</p>
      </div>

      <p className="text-center text-xs text-slate-400">{t("help.footer")}</p>
    </div>
  );
}
