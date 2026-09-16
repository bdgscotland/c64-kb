import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnAnalyzer } from "../ingest.js";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { hydrateOneTune } from "../hydrate.js";
import { join } from "node:path";
import { existsSync } from "node:fs";

const HVSC_CORPUS = process.env.HVSC_CORPUS_DIR ?? "data/hvsc-corpus/C64Music";
const SAMPLE_TUNES = [
  "MUSICIANS/H/Hubbard_Rob/Commando.sid",
  "MUSICIANS/G/Galway_Martin/Arkanoid.sid",
  "MUSICIANS/T/Tel_Jeroen/Cybernoid.sid",
];
const TEST_GRAPH = `c64_hvsc_integration_${Date.now()}`;

const allPresent = SAMPLE_TUNES.every((p) => existsSync(join(HVSC_CORPUS, p)));

describe.skipIf(!allPresent)("Phase 0 end-to-end integration", () => {
  let worker: Awaited<ReturnType<typeof spawnAnalyzer>>;
  let falkor: FalkorHvscClient;

  beforeAll(async () => {
    worker = await spawnAnalyzer();
    falkor = new FalkorHvscClient({ graphName: TEST_GRAPH });
    await falkor.connect();
  });

  afterAll(async () => {
    await worker.shutdown();
    await falkor.dropGraph();
    await falkor.disconnect();
  });

  it("extracts and hydrates 3 canon tunes end-to-end", async () => {
    for (const relPath of SAMPLE_TUNES) {
      const result = await worker.extract({ sidPath: join(HVSC_CORPUS, relPath), subtune: 0 });
      expect(result.kind).toBe("extract");
      if (result.kind === "extract") {
        await hydrateOneTune(result, { falkor, skipQdrant: true });
      }
    }
    const tuneCount = await falkor.tuneCount();
    expect(tuneCount).toBe(3);
  }, 120_000);
});
