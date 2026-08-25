import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "AI 文件整理助手",
  description:
    "在浏览器中更快整理你的文件。无需安装，本地处理，保护隐私。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <I18nProvider>
          <div className="flex min-h-screen flex-col">
            <Nav />
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
              {children}
            </main>
            <footer className="border-t border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500">
              AI 文件整理助手 ·{" "}
              <span>文件在浏览器本地处理，不会上传。</span>
            </footer>
          </div>
        </I18nProvider>
      </body>
    </html>
  );
}
