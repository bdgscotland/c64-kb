import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.QDRANT_URL;
    delete process.env.QDRANT_COLLECTION;
    delete process.env.FALKOR_HOST;
    delete process.env.FALKOR_PORT;
    delete process.env.FALKOR_GRAPH;
    delete process.env.OLLAMA_URL;
    delete process.env.DOCS_DIR;
    delete process.env.ANALYTICS_DB;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults Qdrant to port 7333 with c64_docs collection", async () => {
    const { config } = await import("../src/config.ts");
    expect(config.qdrant.url).toBe("http://localhost:7333");
    expect(config.qdrant.collection).toBe("c64_docs");
    expect(config.qdrant.vectorSize).toBe(1024);
  });

  it("defaults FalkorDB to port 7379 with graph name c64", async () => {
    const { config } = await import("../src/config.ts");
    expect(config.falkor.host).toBe("localhost");
    expect(config.falkor.port).toBe(7379);
    expect(config.falkor.graphName).toBe("c64");
  });

  it("defaults Ollama to the shared port 11434 with mxbai-embed-large", async () => {
    const { config } = await import("../src/config.ts");
    expect(config.ollama.url).toBe("http://localhost:11434");
    expect(config.ollama.model).toBe("mxbai-embed-large");
  });
});
