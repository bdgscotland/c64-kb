import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import { recipeLookup } from "../src/tools/query.ts";
import { extractGraphEntities } from "../src/graph/extract.ts";

// Tool.version_verified (schema 24): the version the repo's gates ran with,
// from the toolchain page's `version_verified:` frontmatter key.
const page = (extra: string) => `---
tool: kickassembler
tool_kind: assembler
home_url: http://theweb.dk/KickAssembler/
${extra}---

<!-- doc-type: toolchain-reference -->

## Tool

Body.
`;

describe("version_verified on Tool", () => {
  it("is read from frontmatter as a string, quotes dropped", () => {
    const t = extractGraphEntities(
      page('version_verified: "5.25"\n'),
      "toolchains/kickassembler-reference.md",
    ).find((e) => e.type === "tool");
    expect(t?.version_verified ?? null).toBe("5.25");
  });

  it("is absent when the page states none", () => {
    const t = extractGraphEntities(page(""), "toolchains/kickassembler-reference.md").find(
      (e) => e.type === "tool",
    );
    expect(t ? t.version_verified : "missing").toBeUndefined();
  });

  it("the four gate toolchains' pages state one", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const got: Record<string, string | undefined> = {};
    for (const rel of [
      "toolchains/kickassembler-reference.md",
      "toolchains/oscar64-reference.md",
      "toolchains/cc65-reference.md",
      "runtime/vice-reference.md",
    ]) {
      const text = fs.readFileSync(path.resolve(__dirname, "../docs", rel), "utf8");
      const t = extractGraphEntities(text, rel).find((e) => e.type === "tool");
      if (t) got[t.name] = t.version_verified;
    }
    expect(got).toEqual({ kickassembler: "5.25", oscar64: "1.32.271", cc65: "2.18", vice: "3.10" });
  });

  describe("recipeLookup", () => {
    let f: FalkorService;
    beforeAll(async () => {
      f = new FalkorService();
      await f.connect();
      await f.clean();
      await f.ensureSchema();
      await f.addTool({
        name: "kickassembler",
        kind: "assembler",
        home_url: "http://theweb.dk/KickAssembler/",
        version_verified: "5.25",
      });
      await f.addTool({ name: "cc65", kind: "c-compiler", home_url: "https://cc65.github.io/" });
      await f.addRecipe({
        name: "kickassembler-fli-image",
        toolchain: "kickassembler",
        output_format: "PRG",
        region: "pal",
        source_doc: "recipes/kickassembler/fli-image.md",
      });
      await f.addRecipe({
        name: "cc65-hello-world-conio",
        toolchain: "cc65",
        output_format: "PRG",
        region: "both",
        source_doc: "recipes/cc65/hello-world-conio.md",
      });
      await f.linkRecipeUsesTool("kickassembler-fli-image", "kickassembler");
      await f.linkRecipeUsesTool("cc65-hello-world-conio", "cc65");
    });
    afterAll(async () => f.close());

    it("names the version beside the toolchain", async () => {
      const r = await recipeLookup("kickassembler-fli-image");
      expect(r.structured.toolchain_version_verified).toBe("5.25");
      expect(r.text).toContain("**Toolchain:** kickassembler (the repo's gates build it with 5.25)");
    });

    it("says nothing when the tool has no version", async () => {
      const r = await recipeLookup("cc65-hello-world-conio");
      expect(r.structured.toolchain_version_verified).toBeUndefined();
      expect(r.text).toContain("**Toolchain:** cc65\n");
    });

    it("a re-ingest without the key clears it", async () => {
      await f.addTool({
        name: "kickassembler",
        kind: "assembler",
        home_url: "http://theweb.dk/KickAssembler/",
      });
      const r = await recipeLookup("kickassembler-fli-image");
      expect(r.structured.toolchain_version_verified).toBeUndefined();
    });
  });
});
