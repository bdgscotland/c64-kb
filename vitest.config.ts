import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "loop/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    testTimeout: 30000,
    fileParallelism: false,
    pool: "forks",
    env: {
      // Tests call clean()/deleteBySource() on whatever they connect to.
      // Point them at throwaway names so `npm test` can never empty the
      // ingested graph or collection.
      FALKOR_GRAPH: "c64_test",
      QDRANT_COLLECTION: "c64_docs_test",
      ANALYTICS_DB: "./data/analytics-test.db",
    },
  },
});
