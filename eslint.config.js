// ESLint flat config. Type-aware rules from typescript-eslint, complexity
// limits from ESLint core and sonarjs. Formatting is Prettier's job
// (eslint-config-prettier turns the overlapping rules off).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";

export default defineConfig(
  { ignores: ["dist/**", "data/**", "storage/**", ".tools/**", "templates/**", "docs/**"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    plugins: { sonarjs },
    rules: {
      // Complexity budget. A function over these limits is split, not waved through.
      complexity: ["error", 15],
      "sonarjs/cognitive-complexity": ["error", 15],
      "max-depth": ["error", 4],
      "max-params": ["error", 4],
      "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
      "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],

      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      // Off: an interface has no implicit index signature, and the MCP SDK's
      // result types need one, so the autofix to `interface` broke tsc.
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-floating-promises": "error",
      "no-console": ["error", { allow: ["error", "warn"] }],
    },
  },
  {
    // CLIs print to stdout by design; the MCP server path must not (test/mcp-stdio.test.ts).
    files: [
      "src/cli.ts",
      "src/cli-memorize-audit.ts",
      "src/ingest.ts",
      "src/tools/feedback.ts",
      "scripts/**",
    ],
    rules: { "no-console": "off" },
  },
  {
    files: ["test/**"],
    rules: {
      "max-lines-per-function": "off",
      "max-lines": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  { files: ["**/*.js", "**/*.mjs"], extends: [tseslint.configs.disableTypeChecked] },
  prettier,
);
