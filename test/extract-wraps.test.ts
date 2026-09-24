import { describe, it, expect } from "vitest";
import { extractGraphEntities } from "../src/graph/extract.ts";

const page = (wraps: string) => `---
tool: oscar64-headers
tool_kind: c-library
home_url: https://github.com/drmortalwombat/oscar64/tree/main/include/c64
---

<!-- doc-type: toolchain-reference -->

# Oscar64 Headers

## Tool

The c64/ headers.

## kernalio.h — KERNAL file I/O wrappers

${wraps}

## vic.h — VIC-II chip access

**Wraps:** vic_sprgetx: D000, $D002, D010
`;

describe("**Wraps:** lines on a toolchain page (#19)", () => {
  it("emits a LibraryFunction per function and a WRAPS edge per target, ranges expanded", () => {
    const ents = extractGraphEntities(
      page("**Wraps:** krnio_open: SETLFS, OPEN, CLOSE; krnio_puts: D020-D022, CHROUT, CHROUT"),
      "toolchains/oscar64-headers-reference.md",
    );
    expect(ents.filter((e) => e.type === "library_function")).toEqual([
      {
        type: "library_function",
        name: "krnio_open",
        header: "kernalio.h",
        tool: "oscar64-headers",
        source_doc: "toolchains/oscar64-headers-reference.md",
      },
      {
        type: "library_function",
        name: "krnio_puts",
        header: "kernalio.h",
        tool: "oscar64-headers",
        source_doc: "toolchains/oscar64-headers-reference.md",
      },
      {
        type: "library_function",
        name: "vic_sprgetx",
        header: "vic.h",
        tool: "oscar64-headers",
        source_doc: "toolchains/oscar64-headers-reference.md",
      },
    ]);
    const wraps = ents.flatMap((e) => (e.type === "wraps" ? [`${e.fn}>${e.target}:${e.targetKind}`] : []));
    expect(wraps).toEqual([
      "krnio_open>SETLFS:KernalRoutine",
      "krnio_open>OPEN:KernalRoutine",
      "krnio_open>CLOSE:KernalRoutine",
      "krnio_puts>D020:Register",
      "krnio_puts>D021:Register",
      "krnio_puts>D022:Register",
      "krnio_puts>CHROUT:KernalRoutine",
      "vic_sprgetx>D000:Register",
      "vic_sprgetx>D002:Register",
      "vic_sprgetx>D010:Register",
    ]);
  });

  it("refuses a target that is neither, an item with no colon, and a range too wide", () => {
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (msg: string) => {
      warnings.push(msg);
    };
    try {
      const ents = extractGraphEntities(
        page("**Wraps:** krnio_open: setlfs, D000-D0FF; krnio_close"),
        "toolchains/oscar64-headers-reference.md",
      );
      expect(ents.filter((e) => e.type === "wraps" && e.fn.startsWith("krnio"))).toEqual([]);
      expect(warnings.some((w) => w.includes('target "setlfs"'))).toBe(true);
      expect(warnings.some((w) => w.includes('range "D000-D0FF"'))).toBe(true);
      expect(warnings.some((w) => w.includes('item "krnio_close"'))).toBe(true);
    } finally {
      console.warn = orig;
    }
  });

  it("reads no Wraps line outside a header section or on a page with no tool", () => {
    const noTool = page("**Wraps:** krnio_open: OPEN").replace(/^tool: .*\n/m, "");
    expect(
      extractGraphEntities(noTool, "toolchains/x.md").filter((e) => e.type === "library_function"),
    ).toEqual([]);
  });
});
