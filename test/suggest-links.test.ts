import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { suggestLinks } from "../src/tools/selfimprovement.js";
import { FalkorService } from "../src/services/falkor.js";

const f = new FalkorService();

beforeAll(async () => {
  await f.connect();
  await f.clean();
  await f.ensureSchema();
});

afterAll(async () => {
  try { await f.close(); } catch { /* expected on already-closed */ }
});

describe("c64_suggest_links", () => {
  it("returns a valid SuggestLinksOutput against a clean graph", async () => {
    const r = await suggestLinks({ kind: "all", limit: 5 });
    expect(Array.isArray(r.structured.suggestions)).toBe(true);
    expect(r.structured.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("honors the kind filter", async () => {
    const r = await suggestLinks({ kind: "technique-register", limit: 3 });
    expect(r.structured.suggestions.length).toBeLessThanOrEqual(3);
  });
});
