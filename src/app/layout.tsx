import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "AI File Organizer",
  description:
    "Organize your files faster with AI-powered tools. Runs entirely in your browser.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <I18nProvider>
          <div className="flex min-h-screen flex-col">
            <Nav />
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
              {children}
            </main>
            <footer className="border-t border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500">
              AI File Organizer ·{" "}
              <span>Use files locally in your browser. Nothing is uploaded.</span>
            </footer>
          </div>
        </I18nProvider>
      </body>
    </html>
  );
}
