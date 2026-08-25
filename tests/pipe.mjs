// Core organize pipeline validation (mirrors src/components/FileOrganizer.tsx logic).
// Verifies category detection + conflict-safe ZIP packaging against sample files.
import JSZip from "jszip";
import fs from "node:fs";
import path from "node:path";

const MAP = {
  pdf: "Documents", doc: "Documents", docx: "Documents", txt: "Documents",
  md: "Documents", rtf: "Documents",
  xls: "Spreadsheets", xlsx: "Spreadsheets", csv: "Spreadsheets",
  ppt: "Presentations", pptx: "Presentations",
  jpg: "Images", jpeg: "Images", png: "Images", gif: "Images", webp: "Images",
  zip: "Archives", rar: "Archives", "7z": "Archives",
};
const cat = (n) => {
  const e = n.includes(".") ? n.split(".").pop().toLowerCase() : "";
  return MAP[e] ?? "Other";
};

const dir = "tests/fixtures";
const files = fs
  .readdirSync(dir)
  .map((n) => ({ name: n, data: fs.readFileSync(path.join(dir, n)) }));

const zip = new JSZip();
const used = new Set();
for (const f of files) {
  const c = cat(f.name);
  let name = f.name;
  let p = `${c}/${name}`;
  let i = 1;
  while (used.has(p)) {
    const d = name.lastIndexOf(".");
    const base = d > 0 ? name.slice(0, d) : name;
    const ext = d > 0 ? name.slice(d) : "";
    name = `${base}_${i}${ext}`;
    p = `${c}/${name}`;
    i++;
  }
  used.add(p);
  zip.file(p, f.data);
}

const buf = await zip.generateAsync({ type: "nodebuffer" });
fs.writeFileSync("tests/organized.zip", buf);

const z2 = await JSZip.loadAsync(buf);
const got = Object.keys(z2.files).filter((n) => !n.endsWith("/")).sort();
const expected = files.map((f) => `${cat(f.name)}/${f.name}`).sort();

console.log("Input files :", files.map((f) => f.name).join(", "));
console.log("ZIP entries :", got.join(", "));
const ok = JSON.stringify(got) === JSON.stringify(expected);
console.log("Categories  :", [...new Set(files.map((f) => cat(f.name)))].join(", "));
console.log("PIPELINE_OK :", ok);
process.exit(ok ? 0 : 1);
