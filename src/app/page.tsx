"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";

export default function Home() {
  const { t } = useI18n();
  return (
    <div className="space-y-10">
      <section className="rounded-3xl bg-gradient-to-br from-[#1e5eba] to-[#16263d] px-8 py-14 text-center text-white">
        <h1 className="text-3xl font-bold sm:text-4xl">{t("home.title")}</h1>
        <p className="mx-auto mt-3 max-w-xl text-base text-white/85">
          {t("home.subtitle")}
        </p>
        <Link
          href="/file-organizer"
          className="mt-6 inline-block rounded-xl bg-white px-6 py-3 font-semibold text-[#1e5eba] transition hover:bg-slate-100"
        >
          {t("home.cta")}
        </Link>
        <p className="mx-auto mt-4 max-w-md text-xs text-white/70">
          {t("home.local")}
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { icon: "🤖", t1: "home.feat1.title", t2: "home.feat1.desc" },
          { icon: "📦", t1: "home.feat2.title", t2: "home.feat2.desc" },
          { icon: "🔒", t1: "home.feat3.title", t2: "home.feat3.desc" },
        ].map((f) => (
          <div key={f.t1} className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="text-3xl">{f.icon}</div>
            <h3 className="mt-3 font-semibold text-slate-800">{t(f.t1)}</h3>
            <p className="mt-1 text-sm text-slate-500">{t(f.t2)}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
