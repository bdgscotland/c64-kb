import { describe, it, expect } from "vitest";
import { deriveScaffold } from "../scaffold.js";
import { HUBBARD_PALETTE } from "./fixtures/hubbard-palette.js";
import type { ComposerPalette } from "../auto-compose.js";

// minimal palette built off the fixture, overriding only what deriveScaffold reads
const P = (over: Partial<ComposerPalette>): ComposerPalette => ({ ...HUBBARD_PALETTE, ...over });
const roles = (lead: number, bass: number, perc: number, arp: number) =>
  [{ label: "lead", count: lead, role: "lead" }, { label: "bass", count: bass, role: "bass" },
   { label: "percussion", count: perc, role: "percussion" }, { label: "arp", count: arp, role: "arp" }];

describe("deriveScaffold — voice config from roles", () => {
  it("picks drums when percussion dominates", () => {
    expect(deriveScaffold(P({ voice_roles: roles(98, 57, 44, 5) }), 130).third).toBe("drums");
  });
  it("picks arp when arp present and percussion not dominant", () => {
    expect(deriveScaffold(P({ voice_roles: roles(14, 5, 0, 1) }), 128).third).toBe("arp");
  });
  it("picks no third voice when neither arp nor percussion", () => {
    expect(deriveScaffold(P({ voice_roles: roles(10, 5, 0, 0) }), 120).third).toBeNull();
  });
});

describe("deriveScaffold — form from song_forms", () => {
  it("through-composed (long forms) → more sections than a loopy composer", () => {
    const longForms = deriveScaffold(P({ song_forms: [{ label: "ABCDEFGDEADFDADF", count: 5 }, { label: "ABCD", count: 2 }] }), 120);
    const shortForms = deriveScaffold(P({ song_forms: [{ label: "loop", count: 40 }, { label: "AB", count: 6 }] }), 120);
    expect(longForms.form.length).toBeGreaterThan(shortForms.form.length);
  });
});

describe("deriveScaffold — tempo + determinism", () => {
  it("passes through tempo (clamped to a musical range)", () => {
    expect(deriveScaffold(P({}), 116).tempo).toBe(116);
    expect(deriveScaffold(P({}), 400).tempo).toBeLessThanOrEqual(150);
  });
  it("is deterministic for the same palette", () => {
    expect(JSON.stringify(deriveScaffold(HUBBARD_PALETTE, 132))).toBe(JSON.stringify(deriveScaffold(HUBBARD_PALETTE, 132)));
  });
});

describe("deriveScaffold — composers differ in skeleton", () => {
  it("a drums/driving composer and an arp/sparse one produce different scaffolds", () => {
    const a = deriveScaffold(P({ voice_roles: roles(98, 57, 44, 5), song_forms: [{ label: "AB", count: 18 }] }), 132);
    const b = deriveScaffold(P({ voice_roles: roles(14, 5, 0, 1), song_forms: [{ label: "ABCDEFG", count: 3 }] }), 116);
    expect(a.third).not.toBe(b.third);
    expect(a.tempo).not.toBe(b.tempo);
  });
});
