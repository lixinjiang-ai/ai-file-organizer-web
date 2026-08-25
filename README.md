# AI File Organizer Web

International web version of **AI File Organizer**. Organize, sort, and package your files — entirely in the browser.

- 🌐 English / 中文 UI
- 🗂️ File Organizer: drag & drop → auto-categorize → one-click ZIP
- 🔍 OCR: extract text from images (Tesseract.js, in-browser)
- 🔒 Privacy first: no upload, no account, no database. Files are processed locally.

## Tech stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4. Pure client-side, static export.

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static export to out/
npm run lint
npm run typecheck
```

## Deploy

GitHub Pages via `.github/workflows/deploy.yml` (auto on push to `main`).
Build sets `GITHUB_PAGES=1` so `basePath`/`assetPrefix` point at `/ai-file-organizer-web`.

Public URL: https://lixinjiang-ai.github.io/ai-file-organizer-web/

## Pages

- `/` Home
- `/file-organizer` File Organizer
- `/ocr` OCR
- `/help` Help

This web project is independent from the desktop (macOS DMG) repository and does not modify it.
