import { describe, it, expect } from "vitest";
import { extractGraphEntities } from "../src/graph/extract.ts";

describe("extractGraphEntities — toolchain-reference docs", () => {
  it("extracts a Tool entity from frontmatter", () => {
    const doc = `---
tool: oscar64
tool_kind: c-compiler
maintainer: drmortalwombat
license: MIT
home_url: https://github.com/drmortalwombat/oscar64
---

<!-- doc-type: toolchain-reference -->

# Oscar64

## Tool

Oscar64 is an optimizing C/C++ cross-compiler for 6502.

**Targets:** 6510
`;
    const ents = extractGraphEntities(doc, "toolchains/oscar64-reference.md");
    const tool = ents.find((e) => e.type === "tool");
    expect(tool).toBeDefined();
    if (tool && tool.type === "tool") {
      expect(tool.name).toBe("oscar64");
      expect(tool.kind).toBe("c-compiler");
      expect(tool.home_url).toBe("https://github.com/drmortalwombat/oscar64");
    }
    const targets = ents.find((e) => e.type === "targets");
    expect(targets).toBeDefined();
    if (targets && targets.type === "targets") {
      expect(targets.tool).toBe("oscar64");
      expect(targets.chip).toBe("6510");
    }
  });

  it("extracts FileFormat with PRODUCES/CONSUMES edges", () => {
    const doc = `---
tool: dummy
tool_kind: c-compiler
home_url: https://example.com
---

<!-- doc-type: toolchain-reference -->

# Dummy

## Tool

Dummy compiler.

## File formats

### .PRG — Program file (executable)

**Produced by:** oscar64, kickassembler, cc65
**Consumed by:** vice, c1541

The PRG format is the canonical C64 executable.
`;
    const ents = extractGraphEntities(doc, "toolchains/dummy-reference.md");
    const fmt = ents.find((e) => e.type === "file_format");
    expect(fmt).toBeDefined();
    if (fmt && fmt.type === "file_format") {
      expect(fmt.name).toBe("PRG");
      expect(fmt.description).toBe("Program file (executable)");
    }
    const produces = ents.filter((e) => e.type === "produces");
    expect(produces).toHaveLength(3);
    expect(produces.map((e) => (e.type === "produces" ? e.tool : "")).sort()).toEqual([
      "cc65",
      "kickassembler",
      "oscar64",
    ]);
    const consumes = ents.filter((e) => e.type === "consumes");
    expect(consumes.map((e) => (e.type === "consumes" ? e.tool : "")).sort()).toEqual(["c1541", "vice"]);
  });

  it("extracts a Recipe entity from recipe frontmatter", () => {
    const doc = `---
recipe: hello-world
toolchain: oscar64
output_format: PRG
region: both
techniques: []
file_formats: [PRG]
uses_registers: []
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# Hello World

## Synopsis

Prints HELLO via CHROUT.
`;
    const ents = extractGraphEntities(doc, "recipes/oscar64/hello-world.md");
    const r = ents.find((e) => e.type === "recipe");
    expect(r).toBeDefined();
    if (r && r.type === "recipe") {
      expect(r.name).toBe("oscar64-hello-world");
      expect(r.toolchain).toBe("oscar64");
      expect(r.output_format).toBe("PRG");
      expect(r.region).toBe("both");
      expect(r.uses_kernal).toEqual(["CHROUT"]);
      // No scaffolds: key in this frontmatter; absent reads as empty.
      expect(r.scaffolds).toEqual([]);
    }
    expect(ents.filter((e) => e.type === "scaffolds")).toHaveLength(0);
  });

  it("reads scaffolds: from recipe frontmatter and emits one SCAFFOLDS edge per archetype", () => {
    const doc = `---
recipe: simple-shmup
toolchain: oscar64
output_format: PRG
region: both
techniques: [sprite_multiplex_8]
file_formats: [PRG]
uses_registers: []
uses_kernal: []
scaffolds: [vertical_shmup, horizontal_shmup]
---

<!-- doc-type: recipe -->

# Simple Shmup
`;
    const ents = extractGraphEntities(doc, "recipes/oscar64/simple-shmup.md");
    const r = ents.find((e) => e.type === "recipe");
    expect(r).toBeDefined();
    if (r && r.type === "recipe") {
      expect(r.scaffolds).toEqual(["vertical_shmup", "horizontal_shmup"]);
    }
    const edges = ents.filter((e) => e.type === "scaffolds");
    expect(edges).toEqual([
      { type: "scaffolds", recipe: "oscar64-simple-shmup", archetype: "vertical_shmup" },
      { type: "scaffolds", recipe: "oscar64-simple-shmup", archetype: "horizontal_shmup" },
    ]);
  });

  it("skips files without the doc-type marker", () => {
    const doc = `---
tool: ignored
---

# Some unrelated doc

## Tool

Not actually a toolchain reference.
`;
    const ents = extractGraphEntities(doc, "misc.md");
    expect(ents.filter((e) => e.type === "tool")).toHaveLength(0);
  });

  it("extracts FileFormat entities from a format-reference doc (no Tool emitted)", () => {
    const doc = `<!-- doc-type: format-reference -->

# C64 File Formats

## Executables

### .PRG — Program file (executable)

**Produced by:** oscar64, kickassembler, cc65
**Consumed by:** vice
`;
    const ents = extractGraphEntities(doc, "formats/c64-file-formats.md");
    const tools = ents.filter((e) => e.type === "tool");
    expect(tools).toHaveLength(0);
    const fmt = ents.find((e) => e.type === "file_format");
    expect(fmt).toBeDefined();
    if (fmt && fmt.type === "file_format") expect(fmt.name).toBe("PRG");
    expect(ents.filter((e) => e.type === "produces")).toHaveLength(3);
    expect(ents.filter((e) => e.type === "consumes")).toHaveLength(1);
  });
});
