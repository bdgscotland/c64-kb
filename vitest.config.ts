import { defineConfig } from "vitest/config";

// Two projects. `unit` needs no service and runs in parallel; each file in
// it was run with Qdrant, FalkorDB and Ollama unreachable and passed. A new
// test file lands in `integration` unless it is added to UNIT, so a test
// that needs a service is never run where the service is missing.
const UNIT = [
  "test/bm25.test.ts",
  "test/briefing-budget.test.ts",
  "test/chunker.test.ts",
  "test/config.test.ts",
  "test/extract*.test.ts",
  "test/feedback.test.ts",
  "test/lint.test.ts",
  "test/report-gap.test.ts",
];

// Tests call clean()/deleteBySource() on whatever they connect to. Point
// them at throwaway names so `npm test` can never empty the ingested graph
// or collection.
const STORES = {
  FALKOR_GRAPH: "c64_test",
  QDRANT_COLLECTION: "c64_docs_test",
  ANALYTICS_DB: "./data/analytics-test.db",
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
          // Every file shares c64_test; two at once clean each other's fixtures.
          fileParallelism: false,
          pool: "forks",
          env: STORES,
        },
      },
    ],
  },
});
