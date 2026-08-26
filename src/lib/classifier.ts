/**
 * 四级目录智能归档 - 本地规则分类器
 *
 * 基于文件名、扩展名、内容关键词等规则进行高精度分类
 * 置信度 >= 0.70 时直接采用，< 0.70 时调用 AI 辅助
 */

import type { ClassifiedFile } from "./directoryTree";

/**
 * 本地规则分类器
 */
export function localClassify(
  fileName: string,
  contentExcerpt?: string,
): Omit<ClassifiedFile, "file"> {
  const lower = fileName.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop()! : "";

  // 关键词匹配规则
  const rules: Array<{
    pattern: RegExp;
    l1: string;
    l2: string;
    l3: string;
    weight: number;
  }> = [
    // 财务类
    { pattern: /发票|invoice|receipt|bill|账单|报销/i, l1: "财务资料", l2: "发票凭证", l3: "按年份", weight: 0.95 },
    { pattern: /合同|contract|agreement|协议/i, l1: "商务合同", l2: "合作协议", l3: "按年份", weight: 0.90 },
    { pattern: /报告|report|分析报告/i, l1: "项目文档", l2: "分析报告", l3: "按年份", weight: 0.85 },
    { pattern: /预算|budget|结算|结算单/i, l1: "财务资料", l2: "预算结算", l3: "按年份", weight: 0.90 },
    // 技术文档类
    { pattern: /规格|spec|design|设计稿/i, l1: "技术文档", l2: "设计资料", l3: "按项目", weight: 0.88 },
    { pattern: /手册|manual|guide|指南/i, l1: "技术文档", l2: "操作手册", l3: "按产品", weight: 0.85 },
    { pattern: /图纸|drawing|蓝图/i, l1: "技术文档", l2: "工程图纸", l3: "按项目", weight: 0.90 },
    // 人事类
    { pattern: /简历|resume|cv|履历/i, l1: "人事资料", l2: "招聘入职", l3: "按年份", weight: 0.85 },
    { pattern: /绩效|考核|评估/i, l1: "人事资料", l2: "绩效考核", l3: "按年份", weight: 0.88 },
    // 通用类
    { pattern: /照片|photo|image|图片/i, l1: "图片素材", l2: "原始素材", l3: "按类型", weight: 0.80 },
    { pattern: /视频|video|movie|mp4/i, l1: "音视频资料", l2: "视频文件", l3: "按年份", weight: 0.80 },
    { pattern: /音频|audio|music|mp3/i, l1: "音视频资料", l2: "音频文件", l3: "按类型", weight: 0.80 },
  ];

  // 扩展名推断
  const extRules: Record<string, { l1: string; l2: string; l3: string; weight: number }> = {
    pdf: { l1: "电子文档", l2: "PDF文件", l3: "按年份", weight: 0.75 },
    docx: { l1: "电子文档", l2: "Word文档", l3: "按年份", weight: 0.75 },
    doc: { l1: "电子文档", l2: "Word文档", l3: "按年份", weight: 0.70 },
    xlsx: { l1: "电子表格", l2: "Excel文件", l3: "按年份", weight: 0.75 },
    xls: { l1: "电子表格", l2: "Excel文件", l3: "按年份", weight: 0.70 },
    pptx: { l1: "演示文稿", l2: "PPT文件", l3: "按年份", weight: 0.75 },
    ppt: { l1: "演示文稿", l2: "PPT文件", l3: "按年份", weight: 0.70 },
    zip: { l1: "归档压缩", l2: "ZIP文件", l3: "按类型", weight: 0.70 },
    jpg: { l1: "图片素材", l2: "JPEG图片", l3: "按类型", weight: 0.70 },
    png: { l1: "图片素材", l2: "PNG图片", l3: "按类型", weight: 0.70 },
  };

  let bestRule = rules.find((r) => r.pattern.test(lower)) || rules.find((r) => r.pattern.test(contentExcerpt ?? ""));
  let extRule = extRules[ext];

  if (bestRule && extRule) {
    if (bestRule.weight > extRule.weight) {
      return makeResult(fileName, bestRule.l1, bestRule.l2, bestRule.l3, bestRule.weight, "local");
    }
    return makeResult(fileName, extRule.l1, extRule.l2, extRule.l3, extRule.weight, "local");
  }

  if (bestRule) {
    return makeResult(fileName, bestRule.l1, bestRule.l2, bestRule.l3, bestRule.weight, "local");
  }

  if (extRule) {
    return makeResult(fileName, extRule.l1, extRule.l2, extRule.l3, extRule.weight, "local");
  }

  // 默认低置信度，交由 AI 处理
  return makeResult(fileName, "未分类", "待确认", "其他", 0.40, "local");
}

function makeResult(
  fileName: string,
  l1: string,
  l2: string,
  l3: string,
  confidence: number,
  source: "local" | "ai",
): Omit<ClassifiedFile, "file"> {
  return {
    originalPath: fileName,
    fileName,
    fileSize: 0,
    confidence,
    level1: l1,
    level2: l2,
    level3: l3,
    targetPath: `${l1}/${l2}/${l3}/${fileName}`,
    source,
    needsConfirmation: confidence < 0.70,
  };
}

/**
 * 批量本地分类
 */
export function batchLocalClassify(
  files: Array<{ name: string; content?: string }>,
): Omit<ClassifiedFile, "file">[] {
  return files.map(({ name, content }) => localClassify(name, content));
}
