// FINAL ACCEPTANCE: 生成真实测试文件（多类型 + 大批量 + AI失败小集）
// 仅生成测试产物，不修改任何产品代码。
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import XLSX from "xlsx";

const ROOT = process.cwd();
const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function makeTxt(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content, "utf8");
}

async function makeDocx(dir, name, text) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:body></w:document>`);
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(path.join(dir, name), buf);
}

function makeXlsx(dir, name, rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(path.join(dir, name), buf);
}

function makePdf(dir, name, text) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  ];
  const stream = `BT /F1 14 Tf 72 720 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  objs.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { pdf += `${String(off).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(pdf, "latin1"));
}

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC";
function makePng(dir, name) {
  fs.writeFileSync(path.join(dir, name), Buffer.from(PNG_B64, "base64"));
}

function mkdirp(d) { fs.mkdirSync(d, { recursive: true }); }

// ── 1. 多类型集（FINAL-1）──
const div = path.join(ROOT, "final-fixtures");
mkdirp(div);
makeTxt(div, "发票_2025-03_乙公司.txt", "增值税普通发票 发票号码：244170000001234 金额：￥12,800.00 销售方：阿克套贸易有限公司 购买方：甲公司");
makeTxt(div, "采购合同_甲方乙公司.txt", "采购合同 甲方：乙公司 乙方：丙公司 标的：碳酸锶原料 数量：500吨 单价：￥2,300/吨 签订日期：2025-03-12");
makeTxt(div, "项目周会纪要_2025Q2.txt", "本周项目周会纪要：讨论了厂区围墙施工进度、给排水管线铺设进度，以及环评报告提交时间节点。");
makeTxt(div, "客户拜访记录_甲公司.txt", "今日拜访甲公司采购负责人，沟通了下季度碳酸锶供货计划，对方表示需求稳定。");
makeTxt(div, "随手记_周末采买.txt", "周末去超市买了些日用品，顺便给宿舍换了灯泡，记录一下花销。");
makeDocx(div, "劳动合同_张三.docx", "劳动合同 甲方：哈萨克斯坦海港SEZ碳酸锶工厂 乙方：张三 岗位：设备工程师 合同期限：2025-2026 薪资：按月发放");
makeDocx(div, "产品需求文档_PRD.docx", "产品需求文档：AI文件整理助手 V2 需支持四级目录、AI自动分类、人工调整、一键导出ZIP。优先级为高。");
makeXlsx(div, "员工工资表_2025Q1.xlsx", [["姓名", "部门", "基本工资", "绩效"], ["张三", "技术部", 18000, 3000], ["李四", "财务部", 15000, 2000], ["王五", "运营部", 14000, 2500]]);
makeXlsx(div, "库存清单_原料.xlsx", [["物料", "规格", "库存量", "单位"], ["碳酸锶", "99%", 320, "吨"], ["包装袋", "50kg", 1200, "个"], ["托盘", "木质", 80, "个"]]);
makePdf(div, "销售发票_2025年3月.pdf", "Sales Invoice No. INV-2025-0312 Amount 12800.00 CNY Buyer Jia Co. Seller Aktau Trade");
makePdf(div, "季度财务报告_Q1.pdf", "Q1 Financial Report Revenue 5.2M Expense 3.1M Net Profit 2.1M");
makePng(div, "现场照片_工地.jpg");
makePng(div, "截图_报表.png");

// ── 2. AI 失败小集（FINAL-2，5 个低置信度文件）──
const fail = path.join(ROOT, "final-fail");
mkdirp(fail);
const failNames = ["随手记_a.txt", "资料_b.txt", "文档_c.txt", "笔记_d.txt", "杂项_e.txt"];
failNames.forEach((n, i) => makeTxt(fail, n, `一些零散内容 ${i}，难以判断归类。`));

// ── 3. 大批量集（FINAL-3，100 个）──
const bulk = path.join(ROOT, "final-bulk");
mkdirp(bulk);
const ruleNames = ["发票", "采购合同", "销售合同", "报销单", "工资条", "银行流水"];
const ambigNames = ["随手记", "资料", "文档", "笔记", "杂项", "待归类", "未知", "零散"];
let n = 0;
// 70 个 TXT（50 规则可识别 + 20 低置信度→走 AI，控制 AI 批次数避免超长退避）
for (let i = 0; i < 70; i++) {
  const useRule = i < 50;
  const base = useRule ? ruleNames[i % ruleNames.length] : ambigNames[i % ambigNames.length];
  const name = `${base}_${String(i).padStart(3, "0")}.txt`;
  const content = useRule
    ? `${base} 编号 ${i} 金额 ￥${(1000 + i * 37) % 9000} 相关方 某公司`
    : `一些零散内容记录 ${i}，暂无明确归类。`;
  makeTxt(bulk, name, content);
  n++;
}
// 12 个 PDF
for (let i = 0; i < 12; i++) {
  makePdf(bulk, `报告_${String(i).padStart(3, "0")}.pdf`, `Report ${i} content sample revenue expense summary`);
  n++;
}
// 6 个 DOCX
for (let i = 0; i < 6; i++) {
  makeDocx(bulk, `文档_${String(i).padStart(3, "0")}.docx`, `这是第 ${i} 份文档内容，用于归档测试。`);
  n++;
}
// 6 个 XLSX
for (let i = 0; i < 6; i++) {
  makeXlsx(bulk, `表格_${String(i).padStart(3, "0")}.xlsx`, [["序号", "名称"], [i, `项目${i}`], [i + 1, `事项${i}`]]);
  n++;
}
// 6 个 PNG
for (let i = 0; i < 6; i++) {
  makePng(bulk, `图片_${String(i).padStart(3, "0")}.png`);
  n++;
}

console.log(`FINAL FIXTURES GENERATED:`);
console.log(`  diverse (final-fixtures): ${fs.readdirSync(div).length} files`);
console.log(`  fail    (final-fail)    : ${fs.readdirSync(fail).length} files`);
console.log(`  bulk    (final-bulk)    : ${fs.readdirSync(bulk).length} files (expected 100, got ${n})`);
