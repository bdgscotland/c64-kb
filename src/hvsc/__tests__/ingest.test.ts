import { describe, it, expect } from "vitest";
import { spawnAnalyzer } from "../ingest.js";

describe("AnalyzerWorker", () => {
  it("emits an error result for a missing tune file", async () => {
    const worker = await spawnAnalyzer();
    const result = await worker.extract({ sidPath: "/nonexistent.sid", subtune: 0 });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/not found/i);
    }
    await worker.shutdown();
  }, 30_000);

  it("handles multiple tunes sequentially without crashing", async () => {
    const worker = await spawnAnalyzer();
    const r1 = await worker.extract({ sidPath: "/nonexistent-1.sid", subtune: 0 });
    const r2 = await worker.extract({ sidPath: "/nonexistent-2.sid", subtune: 0 });
    expect(r1.kind).toBe("error");
    expect(r2.kind).toBe("error");
    await worker.shutdown();
  }, 30_000);
});
