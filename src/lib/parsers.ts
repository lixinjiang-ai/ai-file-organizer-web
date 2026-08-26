/**
 * V2-P2: Local file content parser
 * Extracts text excerpts from various file formats for AI classification.
 * All parsing happens in the browser - no files uploaded to server.
 */

export const MAX_EXCERPT = 1500;
export const PDF_MAX_PAGES = 5;
export const XLSX_MAX_ROWS = 100;
export const FILE_READ_TIMEOUT_MS = 10_000;
export const OCR_TIMEOUT_MS = 30_000;
export const MAX_TEXT_FILE_SIZE = 2 * 1024 * 1024; // 2MB for text files

export type ExtractionMethod =
  | "text"
  | "pdf"
  | "docx"
  | "xlsx"
  | "ocr"
  | "none";

export interface ParsedFile {
  fileName: string;
  extension: string;
  mimeType: string;
  size: number;
  textExcerpt: string;
  textLength: number;
  extractionMethod: ExtractionMethod;
  extractionError?: string;
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "csv", "json", "xml", "html", "htm",
  "js", "ts", "tsx", "jsx", "py", "java", "c", "cpp",
  "h", "hpp", "cs", "go", "rs", "rb", "php", "swift",
  "kt", "sh", "bash", "zsh", "bat", "ps1", "yaml", "yml",
  "toml", "ini", "cfg", "conf", "log", "sql", "r",
]);

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "webp", "bmp", "gif",
]);

const PDF_EXTENSIONS = new Set(["pdf"]);
const DOCX_EXTENSIONS = new Set(["docx", "doc"]);
const XLSX_EXTENSIONS = new Set(["xlsx", "xls", "numbers"]);

function getExtension(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

function truncateExcerpt(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  // Try to break at natural boundaries
  const cutoff = Math.max(0, maxLength - 3);
  let truncated = text.slice(0, cutoff);

  // Look for sentence boundary
  const sentenceEnd = Math.max(
    truncated.lastIndexOf("."),
    truncated.lastIndexOf("。"),
    truncated.lastIndexOf("\n"),
    truncated.lastIndexOf(" "),
  );

  if (sentenceEnd > maxLength * 0.5) {
    truncated = truncated.slice(0, sentenceEnd + 1);
  } else {
    truncated = truncated + "...";
  }

  return truncated;
}

async function readFileAsText(file: File, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const timer = setTimeout(() => {
      reader.abort();
      reject(new Error("Read timeout"));
    }, timeoutMs);

    reader.onload = () => {
      clearTimeout(timer);
      resolve(reader.result as string);
    };
    reader.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Read error"));
    };
    reader.readAsText(file);
  });
}

async function parseTextFile(file: File): Promise<ParsedFile> {
  const text = await readFileAsText(file, FILE_READ_TIMEOUT_MS);
  const excerpt = truncateExcerpt(text, MAX_EXCERPT);
  return {
    fileName: file.name,
    extension: getExtension(file.name),
    mimeType: file.type || "text/plain",
    size: file.size,
    textExcerpt: excerpt,
    textLength: text.length,
    extractionMethod: "text",
  };
}

async function parseDocxFile(file: File): Promise<ParsedFile> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const text = result.value || "";
  const excerpt = truncateExcerpt(text, MAX_EXCERPT);
  return {
    fileName: file.name,
    extension: getExtension(file.name),
    mimeType: file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: file.size,
    textExcerpt: excerpt,
    textLength: text.length,
    extractionMethod: "docx",
  };
}

async function parseXlsxFile(file: File): Promise<ParsedFile> {
  const XLSX = await import("xlsx");
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const lines: string[] = [];

  for (const sheetName of workbook.SheetNames.slice(0, 3)) {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
    const rows = data.slice(0, XLSX_MAX_ROWS);
    lines.push(`# ${sheetName}`);
    lines.push(...rows.map((row) => row.join("\t")));
  }

  const text = lines.join("\n");
  const excerpt = truncateExcerpt(text, MAX_EXCERPT);
  return {
    fileName: file.name,
    extension: getExtension(file.name),
    mimeType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: file.size,
    textExcerpt: excerpt,
    textLength: text.length,
    extractionMethod: "xlsx",
  };
}

async function parsePdfFile(file: File): Promise<ParsedFile> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
  const numPages = Math.min(pdf.numPages, PDF_MAX_PAGES);
  const pages: string[] = [];

  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(" ");
      pages.push(pageText);
    } catch {
      pages.push("[Page read error]");
    }
  }

  const text = pages.join("\n\n");
  const excerpt = truncateExcerpt(text, MAX_EXCERPT);
  return {
    fileName: file.name,
    extension: getExtension(file.name),
    mimeType: file.type || "application/pdf",
    size: file.size,
    textExcerpt: excerpt,
    textLength: text.length,
    extractionMethod: "pdf",
  };
}

async function parseImageFile(file: File): Promise<ParsedFile> {
  // Use existing Tesseract.js if available, otherwise skip
  try {
    const Tesseract = await import("tesseract.js");
     
    const result = await (Tesseract as any).recognize(file, "chi_sim+eng", {
      logger: () => {}, // silent
    });
    const text = result.data.text || "";
    const excerpt = truncateExcerpt(text, MAX_EXCERPT);
    return {
      fileName: file.name,
      extension: getExtension(file.name),
      mimeType: file.type || "image/png",
      size: file.size,
      textExcerpt: excerpt,
      textLength: text.length,
      extractionMethod: "ocr",
    };
  } catch {
    return {
      fileName: file.name,
      extension: getExtension(file.name),
      mimeType: file.type || "image/png",
      size: file.size,
      textExcerpt: "",
      textLength: 0,
      extractionMethod: "none",
      extractionError: "OCR failed or not available",
    };
  }
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const ext = getExtension(file.name);

  // Check for unsupported binary
  if (!TEXT_EXTENSIONS.has(ext) && !DOCX_EXTENSIONS.has(ext) &&
      !XLSX_EXTENSIONS.has(ext) && !PDF_EXTENSIONS.has(ext) &&
      !IMAGE_EXTENSIONS.has(ext)) {
    return {
      fileName: file.name,
      extension: ext,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      textExcerpt: "",
      textLength: 0,
      extractionMethod: "none",
      extractionError: "Unsupported format",
    };
  }

  try {
    if (TEXT_EXTENSIONS.has(ext)) {
      // Limit text file size
      if (file.size > MAX_TEXT_FILE_SIZE) {
        return {
          fileName: file.name,
          extension: ext,
          mimeType: file.type || "text/plain",
          size: file.size,
          textExcerpt: "[File too large to read]",
          textLength: 0,
          extractionMethod: "text",
          extractionError: "File exceeds size limit",
        };
      }
      return await parseTextFile(file);
    }

    if (DOCX_EXTENSIONS.has(ext)) {
      return await parseDocxFile(file);
    }

    if (XLSX_EXTENSIONS.has(ext)) {
      return await parseXlsxFile(file);
    }

    if (PDF_EXTENSIONS.has(ext)) {
      return await parsePdfFile(file);
    }

    if (IMAGE_EXTENSIONS.has(ext)) {
      return await parseImageFile(file);
    }

    // Fallback
    return {
      fileName: file.name,
      extension: ext,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      textExcerpt: "",
      textLength: 0,
      extractionMethod: "none",
      extractionError: "Unknown format",
    };
  } catch (error: any) {
    return {
      fileName: file.name,
      extension: ext,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      textExcerpt: "",
      textLength: 0,
      extractionMethod: "none",
      extractionError: error?.message || "Parse error",
    };
  }
}

export async function parseFiles(files: File[]): Promise<ParsedFile[]> {
  const results: ParsedFile[] = [];

  for (const file of files) {
    try {
      const parsed = await parseFile(file);
      results.push(parsed);
    } catch {
      // Single file failure should not stop batch processing
      results.push({
        fileName: file.name,
        extension: getExtension(file.name),
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        textExcerpt: "",
        textLength: 0,
        extractionMethod: "none",
        extractionError: "Batch parse error",
      });
    }
  }

  return results;
}
