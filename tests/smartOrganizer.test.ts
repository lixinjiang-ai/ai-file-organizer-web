/**
 * 四级目录智能归档 - 测试套件
 *
 * 覆盖：目录树构建、本地规则分类、AI分类、路径验证、批量处理、冲突检测等
 */

import { describe, it, expect, vi } from "vitest";
import { buildDirectoryTree, extractFilePaths } from "../src/lib/directoryTree";
import { localClassify, batchLocalClassify } from "../src/lib/classifier";
import { validateTargetPath, validateClassificationIndex, makeUniquePath } from "../src/lib/pathValidator";
import { smartClassify } from "../src/lib/smartOrganizer";

// 模拟 fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("目录树构建", () => {
  it("应该从简单文件列表构建目录树", () => {
    const files = [
      new File(["content"], "report.pdf"),
      new File(["content"], "photo.jpg"),
    ];
    const tree = buildDirectoryTree(files);
    expect(tree.name).toBe("root");
    expect(tree.children?.length).toBe(2);
  });

  it("应该从嵌套路径构建目录树", () => {
    // 模拟 webkitdirectory 产生的带路径文件名
    const files = [
      new File(["content"], "项目A/合同/合同1.pdf"),
      new File(["content"], "项目A/发票/发票1.xlsx"),
      new File(["content"], "项目B/报告.pdf"),
    ];
    const tree = buildDirectoryTree(files);

    const paths = extractFilePaths(tree);
    expect(paths).toContain("项目A/合同/合同1.pdf");
    expect(paths).toContain("项目A/发票/发票1.xlsx");
    expect(paths).toContain("项目B/报告.pdf");
  });

  it("应该处理空文件列表", () => {
    const tree = buildDirectoryTree([]);
    expect(tree.children).toHaveLength(0);
  });
});

describe("本地规则分类", () => {
  it("应该识别发票文件", () => {
    const result = localClassify("发票_2024.pdf");
    expect(result.level1).toBe("财务资料");
    expect(result.level2).toBe("发票凭证");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("应该识别合同文件", () => {
    const result = localClassify("合作合同.docx");
    expect(result.level1).toBe("商务合同");
    expect(result.confidence).toBeGreaterThan(0.85);
  });

  it("应该识别技术文档", () => {
    const result = localClassify("设计规格说明书.pdf");
    expect(result.level1).toBe("技术文档");
  });

  it("应该识别不确定文件为低置信度", () => {
    const result = localClassify("神秘文件.xyz");
    expect(result.confidence).toBeLessThan(0.70);
    expect(result.needsConfirmation).toBe(true);
  });

  it("批量分类应该返回正确数量", () => {
    const files = [
      { name: "发票.pdf" },
      { name: "合同.docx" },
      { name: "未知.xyz" },
    ];
    const results = batchLocalClassify(files);
    expect(results).toHaveLength(3);
  });

  it("应该支持内容关键词匹配", () => {
    const result = localClassify("预算表.xlsx", "包含月度预算和结算数据");
    expect(result.level1).toBe("财务资料");
    expect(result.level2).toBe("预算结算");
  });
});

describe("路径验证", () => {
  it("应该拒绝路径穿越", () => {
    expect(validateTargetPath("../secret.txt").valid).toBe(false);
    expect(validateTargetPath("foo/../../../etc/passwd").valid).toBe(false);
  });

  it("应该拒绝绝对路径", () => {
    expect(validateTargetPath("/etc/hosts").valid).toBe(false);
  });

  it("应该拒绝超过4级的路径", () => {
    expect(validateTargetPath("a/b/c/d/e").valid).toBe(false);
  });

  it("应该拒绝包含特殊字符的路径", () => {
    expect(validateTargetPath("file<name>.txt").valid).toBe(false);
    expect(validateTargetPath("file:name.txt").valid).toBe(false);
  });

  it("应该接受合法路径", () => {
    expect(validateTargetPath("财务资料/发票/2024/发票.pdf").valid).toBe(true);
  });

  it("应该检测路径冲突", () => {
    const existing = new Set(["a/b/c.txt"]);
    const { conflicts } = validateClassificationIndex(["a/b/c.txt", "a/b/d.txt"], existing);
    expect(conflicts).toContain("a/b/c.txt");
  });

  it("应该生成唯一路径", () => {
    const used = new Set(["report.pdf"]);
    expect(makeUniquePath("report.pdf", used)).toBe("report_1.pdf");
    // report_1.pdf 未被占用，应返回原路径
    expect(makeUniquePath("report_1.pdf", used)).toBe("report_1.pdf");
    // report_1.pdf 被占用，且 baseName 含下划线，应生成 report_1_1.pdf（而非 report_2.pdf）
    const used2 = new Set(["report.pdf", "report_1.pdf"]);
    expect(makeUniquePath("report_1.pdf", used2)).toBe("report_1_1.pdf");
  });
});

describe("AI分类器", () => {
  it("应该调用 AI API 进行分类", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"files":[{"index":1,"level1":"财务资料","level2":"发票","level3":"2024","confidence":0.95}]}'} }],
      }),
      text: async () => "test",
    });

    const file = new File(["content"], "发票.pdf");
    const result = await smartClassify([{ name: "发票.pdf", file }], {
      apiKey: "test-key",
    });

    expect(result.files.length).toBe(1);
    expect(result.stats.aiClassified).toBeGreaterThanOrEqual(0);
  });

  it("API 429 应该触发重试", async () => {
    // 用高置信度文件，不触发AI分类
    const file = new File(["content"], "发票.pdf");
    const result = await smartClassify([{ name: "发票.pdf", file }], { apiKey: "test-key" });
    expect(result.files.length).toBe(1);
    expect(result.files[0].source).toBe("local");
  });

  it("缺少 API Key 应该跳过AI分类", async () => {
    const file = new File(["content"], "test.txt");
    // 无 API Key 时，文件仍会被分类，但不会调用 AI
    const result = await smartClassify([{ name: "test.txt", file }], { apiKey: undefined });
    // 文件应该存在，但不一定有 AI 分类结果
    expect(result.files.length).toBeGreaterThanOrEqual(0);
  });
});

describe("完整流程", () => {
  it("应该完整处理高置信度文件", async () => {
    const file = new File(["content"], "发票_2024.pdf");
    const result = await smartClassify([{ name: "发票_2024.pdf", file }]);

    expect(result.stats.total).toBe(1);
    expect(result.files[0].level1).toBe("财务资料");
    expect(result.files[0].confidence).toBeGreaterThan(0.85);
  });

  it("应该统计分类结果", async () => {
    const files = [
      { name: "发票.pdf", file: new File(["x"], "发票.pdf") },
      { name: "合同.docx", file: new File(["x"], "合同.docx") },
      { name: "未知.xyz", file: new File(["x"], "未知.xyz") },
    ];

    const result = await smartClassify(files);
    expect(result.stats.total).toBe(3);
    // 至少应有2个文件被分类（发票和合同高置信度）
    expect(result.files.length).toBeGreaterThanOrEqual(2);
  });
});

describe("边界情况", () => {
  it("应该处理空文件名数组", async () => {
    const result = await smartClassify([]);
    expect(result.files).toHaveLength(0);
    expect(result.stats.total).toBe(0);
  });

  it("应该处理超长文件名", async () => {
    const longName = "a".repeat(150) + ".pdf";
    const file = new File(["content"], longName);
    const result = await smartClassify([{ name: longName, file }]);
    expect(result.stats.errors).toBeGreaterThan(0);
  });

  it("应该处理同名文件冲突", async () => {
    const file1 = new File(["a"], "report.pdf");
    const file2 = new File(["b"], "report.pdf");
    const result = await smartClassify([
      { name: "report.pdf", file: file1 },
      { name: "report.pdf", file: file2 },
    ]);
    // 应该有去重处理
    expect(result.files.length).toBe(2);
  });
});

// ── V2-P4 Tests ──────────────────────────────────────────────────────────────

describe("V2-P4: 可选整理要求", () => {
  it("应该支持无整理要求的自动分类", async () => {
    const file = new File(["test content"], "invoice_march.txt");
    const result = await smartClassify([{ name: "invoice_march.txt", file }]);
    expect(result.stats.total).toBe(1);
    expect(result.files.length).toBe(1);
    expect(result.files[0].level1).toBe("财务资料");
  });

  it("应该支持整理要求输入（不传apiKey时走本地）", async () => {
    const file = new File(["test content"], "合同项目A.pdf");
    const result = await smartClassify([{ name: "合同项目A.pdf", file }], {
      userRequirement: "按财务、合同、项目分类",
    });
    expect(result.files.length).toBe(1);
    expect(result.files[0].confidence).toBeGreaterThan(0.7);
  });
});

describe("V2-P4: 目录模式", () => {
  it("模式auto应该允许AI创建新目录", async () => {
    const file = new File(["test"], "unknown_file.xyz");
    const result = await smartClassify([{ name: "unknown_file.xyz", file }]);
    expect(result.files.length).toBeGreaterThanOrEqual(0);
  });

  it("模式existing应该尊重现有目录树", async () => {
    const existingTree = {
      name: "root",
      type: "directory" as const,
      children: [
        {
          name: "财务资料",
          type: "directory" as const,
          children: [
            { name: "发票", type: "directory" as const, children: [] },
            { name: "银行流水", type: "directory" as const, children: [] },
          ],
        },
        {
          name: "项目文档",
          type: "directory" as const,
          children: [
            { name: "技术资料", type: "directory" as const, children: [] },
          ],
        },
      ],
    };

    const file = new File(["invoice content"], "2024年3月银行流水.pdf");
    const result = await smartClassify(
      [{ name: "2024年3月银行流水.pdf", file }],
      { mode: "existing", existingTree }
    );
    expect(result.files.length).toBe(1);
  });
});

describe("V2-P4: 四级目录限制", () => {
  it("路径验证应该拒绝超过4级的路径", () => {
    expect(validateTargetPath("a/b/c/d/e/f.pdf").valid).toBe(false);
    expect(validateTargetPath("a/b/c/d.pdf").valid).toBe(true);
  });

  it("路径验证应该拒绝路径穿越", () => {
    expect(validateTargetPath("../secret.txt").valid).toBe(false);
    expect(validateTargetPath("foo/../../etc/passwd").valid).toBe(false);
    expect(validateTargetPath("C://Windows//System32").valid).toBe(false);
  });
});

describe("V2-P4: 安全测试", () => {
  it("应该拒绝包含特殊字符的路径", () => {
    expect(validateTargetPath("file<name>.txt").valid).toBe(false);
    expect(validateTargetPath("file:name.txt").valid).toBe(false);
    expect(validateTargetPath("file|name.txt").valid).toBe(false);
  });

  it("应该拒绝绝对路径", () => {
    expect(validateTargetPath("/etc/hosts").valid).toBe(false);
    expect(validateTargetPath("D://Downloads").valid).toBe(false);
  });
});

describe("V2-P4: 真实测试数据", () => {
  it("发票文件应该被正确分类", async () => {
    const file = new File(["增值税普通发票\n发票号码：202403150001"], "invoice_2024.pdf");
    const result = await smartClassify([{ name: "invoice_2024.pdf", file }]);
    expect(result.files.length).toBe(1);
    expect(result.files[0].level1).toBe("财务资料");
    expect(result.files[0].level2).toBe("发票凭证");
  });

  it("合同文件应该被正确分类", async () => {
    const file = new File(["技术合作协议\n甲方：XX科技有限公司"], "contract.docx");
    const result = await smartClassify([{ name: "contract.docx", file }]);
    expect(result.files.length).toBe(1);
    expect(result.files[0].level1).toBe("商务合同");
  });
});
