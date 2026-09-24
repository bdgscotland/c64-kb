import { defineConfig } from "vitest/config";

// Two projects. `unit` needs no service and runs in parallel; each file in
// it was run with Qdrant, FalkorDB and Ollama unreachable and passed. A new
// test file lands in `integration` unless it is added to UNIT, so a test
// that needs a service is never run where the service is missing.
const UNIT = [
  "test/bm25.test.ts",
  "test/briefing-alternatives.test.ts",
  "test/briefing-budget.test.ts",
  "test/briefing-discovery.test.ts",
  "test/briefing-route-heads.test.ts",
  "test/check-compatibility-rules.test.ts",
  "test/chunker.test.ts",
  "test/claim-rules.test.ts",
  "test/config.test.ts",
  "test/doc-path.test.ts",
  "test/extract*.test.ts",
  "test/feedback.test.ts",
  "test/game-design-compare.test.ts",
  "test/harness-python.test.ts",
  "test/kernal-zp.test.ts",
  "test/kernal-zp-rule.test.ts",
  "test/lint.test.ts",
  "test/machine-variants.test.ts",
  "test/pitfall-coverage.test.ts",
  "test/plan-budget.test.ts",
  "test/report-gap.test.ts",
  "test/runs-manifest.test.ts",
];

// Tests call clean()/deleteBySource() on whatever they connect to. Point
// them at throwaway names so `npm test` can never empty the ingested graph
// or collection. Two runs at once share these names and clean each other's
// fixtures; give a parallel run its own with C64_TEST_STORE=<suffix>.
const suffix = process.env.C64_TEST_STORE ? `_${process.env.C64_TEST_STORE}` : "";
const STORES = {
  FALKOR_GRAPH: `c64_test${suffix}`,
  QDRANT_COLLECTION: `c64_docs_test${suffix}`,
  ANALYTICS_DB: `./data/analytics-test${suffix}.db`,
};

export default defineConfig({
  test: {
    restoreMocks: true,
    projects: [
      {
        test: {
          name: "unit",
          include: UNIT,
          env: STORES,
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/**/*.test.ts"],
          exclude: UNIT,
          testTimeout: 30000,
          // Seeding embeds through Ollama; a cold model took over 10 s on a CI runner.
          hookTimeout: 60000,
          // Every file shares c64_test; two at once clean each other's fixtures.
          fileParallelism: false,
          pool: "forks",
          env: STORES,
        },
      },
    ],
  },
});
