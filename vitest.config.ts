import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "loop/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    testTimeout: 30000,
    fileParallelism: false,
    pool: "forks",
    env: {
      FALKOR_GRAPH: "c64_test",
      ANALYTICS_DB: "./data/analytics-test.db",
    },
  },
});
