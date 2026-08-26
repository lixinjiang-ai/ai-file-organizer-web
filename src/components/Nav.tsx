"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";

export function Nav() {
  const { t } = useI18n();
  const pathname = usePathname();

  const links = [
    { href: "/", key: "nav.home" },
    { href: "/file-organizer", key: "nav.organize" },
    { href: "/smart-organize", key: "nav.smartOrganize" },
    { href: "/ocr", key: "nav.ocr" },
    { href: "/help", key: "nav.help" },
  ];

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex w-full max-w-5xl items-center gap-1 px-4 py-3">
        <Link href="/" className="mr-2 flex items-center gap-2 font-bold text-[#1e5eba]">
          <span className="text-lg">🗂️</span>
          <span className="hidden sm:inline">AI 文件整理助手</span>
        </Link>
        <div className="flex flex-1 items-center gap-1">
          {links.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  active
                    ? "bg-[#1e5eba] text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t(l.key)}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
