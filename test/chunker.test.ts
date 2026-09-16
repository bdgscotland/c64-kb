import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "../src/services/chunker.js";

describe("chunkMarkdown", () => {
  it("splits a doc into chunks at ## boundaries", () => {
    const doc = `# Title

Intro paragraph describing what this document covers in enough detail that the chunker doesn't merge it away as a tiny chunk below the 80 character threshold.

## Section One

Content one is now long enough to survive the chunker's minimum-size merge pass. It needs at least 80 characters to stand on its own as a chunk.

## Section Two

Content two is similarly padded out to exceed the 80-character minimum so the chunker keeps it as a distinct chunk from Section One.
`;
    const chunks = chunkMarkdown(doc, "test.md");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const sections = chunks.map((c) => c.section);
    expect(sections.some((s) => s.includes("Section One"))).toBe(true);
    expect(sections.some((s) => s.includes("Section Two"))).toBe(true);
  });

  it("preserves heading path for ### subsections", () => {
    const doc = `# Title

## Section A

### $D011 — D011 — Screen Control Register 1 (RW)

Content.
`;
    const chunks = chunkMarkdown(doc, "test.md");
    const target = chunks.find((c) => c.section.includes("D011"));
    expect(target).toBeDefined();
    expect(target!.section).toContain("Section A");
  });

  it("does not overlap adjacent chunk bodies", () => {
    const doc = `# Title

## Section One

This is the first section's content padded out so the chunker doesn't merge it. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

## Section Two

Different content entirely. The second section's content also padded out so the chunker keeps it as its own chunk and doesn't merge it with the first or anything else.
`;
    const chunks = chunkMarkdown(doc, "test.md");
    const sec1 = chunks.find((c) => c.section.includes("Section One"));
    const sec2 = chunks.find((c) => c.section.includes("Section Two"));
    expect(sec1).toBeDefined();
    expect(sec2).toBeDefined();
    // Section Two's text should NOT start with content from Section One
    expect(sec2!.text).not.toContain("Lorem ipsum");
  });

  it("preserves tiny H3 chunks as their own searchable units (opcode regression)", () => {
    // Simulates the 6510-cpu-reference.md pattern: per-byte H3 with ~30 char body.
    const doc = `# 6510 CPU

## Opcodes

### $A9 — LDA #imm — Load Accumulator immediate

**Cycles:** 2
**Flags:** N Z

### $AA — TAX — Transfer A to X

**Cycles:** 2
**Flags:** N Z

### $A2 — LDX #imm — Load X immediate

**Cycles:** 2
**Flags:** N Z
`;
    const chunks = chunkMarkdown(doc, "test.md");
    const sections = chunks.map((c) => c.section);
    expect(sections.some((s) => s.includes("LDA #imm"))).toBe(true);
    expect(sections.some((s) => s.includes("TAX"))).toBe(true);
    expect(sections.some((s) => s.includes("LDX #imm"))).toBe(true);
  });
});
