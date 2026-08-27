/**
 * 验收专项测试：AI 整批失败（429 限流 / 500 错误）时，绝不允许静默丢弃文件。
 *
 * 背景：发现并修复的 bug —— classifyBatch 在「整批 429 重试耗尽」时会 throw
 * "重试次数耗尽"，而 aiClassify 的批次 catch 仅记录错误、未把该批文件 push 进
 * result.fallback，导致 smartClassify 合并时整批文件被静默丢弃（线上验收观察到
 * 13→11、100→64 的丢文件）。修复后，批次失败时整批进入 fallback，无丢失。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { aiClassify, type AiFileInput } from "../src/lib/aiClassifier";

function makeInputs(n: number): AiFileInput[] {
  return Array.from({ length: n }, (_, i) => ({
    originalPath: `file${i}.txt`,
    fileName: `file${i}.txt`,
    extension: "txt",
    fileSize: 100,
    contentExcerpt: "",
    mimeType: "text/plain",
  }));
}

function allCovered(res: Awaited<ReturnType<typeof aiClassify>>): Set<string> {
  return new Set([
    ...res.files.map((f) => f.originalPath),
    ...res.fallback.map((f) => f.originalPath),
  ]);
}

describe("aiClassify 限流/失败兜底 — 绝不静默丢弃文件", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(null, { status: 429, statusText: "RATE_LIMITED" }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it(
    "整批 429（重试耗尽）时所有文件进入 fallback，无丢失",
    async () => {
      const inputs = makeInputs(10);
      const res = await aiClassify(inputs, { maxRetries: 1 });
      expect(res.files.length + res.fallback.length).toBe(10);
      expect(allCovered(res).size).toBe(10);
    },
    60000,
  );

  it(
    "多批次 100 文件全 429 时同样无丢失",
    async () => {
      const inputs = makeInputs(100);
      const res = await aiClassify(inputs, { maxRetries: 1 });
      expect(res.files.length + res.fallback.length).toBe(100);
      expect(allCovered(res).size).toBe(100);
    },
    120000,
  );

  it(
    "Worker 返回 500 时整批回退 fallback，无丢失",
    async () => {
      vi.stubGlobal("fetch", async () => new Response("err", { status: 500 }));
      const inputs = makeInputs(10);
      const res = await aiClassify(inputs, { maxRetries: 1 });
      expect(res.files.length + res.fallback.length).toBe(10);
      expect(allCovered(res).size).toBe(10);
    },
    60000,
  );
});
