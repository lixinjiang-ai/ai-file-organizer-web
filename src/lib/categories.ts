export type Category =
  | "Documents"
  | "Spreadsheets"
  | "Presentations"
  | "Images"
  | "Archives"
  | "Audio"
  | "Video"
  | "Code"
  | "Other";

export const CATEGORIES: Category[] = [
  "Documents",
  "Spreadsheets",
  "Presentations",
  "Images",
  "Archives",
  "Audio",
  "Video",
  "Code",
  "Other",
];

// 中文分类标签（用于界面显示与 ZIP 文件夹名）
export const CATEGORY_LABELS: Record<Category, string> = {
  Documents: "文档",
  Spreadsheets: "表格",
  Presentations: "演示",
  Images: "图片",
  Archives: "压缩包",
  Audio: "音频",
  Video: "视频",
  Code: "代码",
  Other: "其他",
};

const EXT_MAP: Record<string, Category> = {
  pdf: "Documents",
  doc: "Documents",
  docx: "Documents",
  txt: "Documents",
  md: "Documents",
  rtf: "Documents",
  odt: "Documents",
  pages: "Documents",
  xls: "Spreadsheets",
  xlsx: "Spreadsheets",
  csv: "Spreadsheets",
  ppt: "Presentations",
  pptx: "Presentations",
  key: "Presentations",
  jpg: "Images",
  jpeg: "Images",
  png: "Images",
  gif: "Images",
  webp: "Images",
  bmp: "Images",
  svg: "Images",
  heic: "Images",
  zip: "Archives",
  rar: "Archives",
  "7z": "Archives",
  tar: "Archives",
  gz: "Archives",
  zst: "Archives",
  mp3: "Audio",
  wav: "Audio",
  m4a: "Audio",
  flac: "Audio",
  mp4: "Video",
  mov: "Video",
  webm: "Video",
  mkv: "Video",
  js: "Code",
  ts: "Code",
  py: "Code",
  json: "Code",
  html: "Code",
  css: "Code",
  java: "Code",
  c: "Code",
  cpp: "Code",
  go: "Code",
  rs: "Code",
  sh: "Code",
};

export function categoryOf(fileName: string): Category {
  const ext = fileName.includes(".")
    ? fileName.split(".").pop()!.toLowerCase()
    : "";
  return EXT_MAP[ext] ?? "Other";
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
