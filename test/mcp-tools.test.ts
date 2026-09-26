import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import {
  CoverageOutput,
  coverageReply,
  FrameProfileOutput,
  frameModeReply,
  frameProfileReply,
  IrqChainOutput,
  irqChainReply,
  LoadMapOutput,
  loadMapReply,
  SessionOutput,
  sessionReply,
  SnapshotOutput,
  snapshotReply,
} from "../src/server/tools-re.ts";
import {
  RegisterLookupSchema,
  KernalLookupSchema,
  MemoryMapSchema,
  OpcodeLookupSchema,
  PalNtscDiffSchema,
  SearchSchema,
  ToolchainHintSchema,
  RecipeLookupSchema,
  RecipesForSchema,
  TechniqueLookupSchema,
  TechniquesForSchema,
  CompatibilityCheckSchema,
  TimingBudgetSchema,
  PlanBudgetSchema,
  PitfallsForSchema,
  FailureDiagnoseSchema,
  LintSourceSchema,
  BriefingSchema,
  CoverageSchema,
  SuggestLinksSchema,
  ReportGapSchema,
} from "../src/schemas/tool-outputs.ts";

// Every tool the server lists, called over stdio the way an MCP client
// calls it, with a small valid input. Each reply must not be an error, and
// a tool that declares an outputSchema must return structuredContent that
// parses with the zod schema the server built that outputSchema from.
//
// Not called, because they have side effects outside the test stores:
// c64_run_game kills the x64sc on monitor port 6502 and starts one;
// c64_ingest_doc writes a file under docs/ (and c64_memorization_check is
// listed only where the Python analyzer is installed). c64_re_irq_chain,
// c64_re_frame_profile and c64_re_load_map run VICE for seconds (c64_re_session
// and c64_re_snapshot too: their runs are in test/re-session.test.ts and
// test/re-snapshot.test.ts, c64_re_load_map's in test/re-load-map.test.ts);
// their runs are covered by test/re-tools.test.ts and
// test/re-calibration.test.ts, and their reply builders by the stub
// results at the end of this file. c64_claims_watch runs VICE too:
// test/claims-watch-tool.test.ts covers its run and reply.
const SKIP = new Set([
  "c64_run_game",
  "c64_ingest_doc",
  "c64_memorization_check",
  "c64_re_irq_chain",
  "c64_re_frame_profile",
  "c64_re_session",
  "c64_re_snapshot",
  "c64_re_load_map",
  "c64_re_coverage",
  "c64_claims_watch",
]);

// Tool -> [arguments, output schema or null for a text-only tool].
const CALLS: Record<string, [Record<string, unknown>, z.ZodType | null]> = {
  c64_health: [{}, null],
  c64_search: [{ query: "stable raster IRQ", limit: 2 }, SearchSchema],
  c64_lookup_register: [{ name_or_addr: "D011" }, RegisterLookupSchema],
  c64_lookup_kernal: [{ name_or_addr: "CHROUT" }, KernalLookupSchema],
  c64_memory_map: [{ addr: "$D011" }, MemoryMapSchema],
  c64_lookup_opcode: [{ byte_or_mnemonic: "LDA" }, OpcodeLookupSchema],
  c64_pal_ntsc_diff: [{ topic: "badline" }, PalNtscDiffSchema],
  c64_toolchain_hint: [{ intent: "raster irq" }, ToolchainHintSchema],
  c64_recipe_lookup: [{ name: "oscar64-hello-world" }, RecipeLookupSchema],
  c64_recipes_for: [{ toolchain: "oscar64" }, RecipesForSchema],
  c64_technique_lookup: [{ name: "stable_raster_irq" }, TechniqueLookupSchema],
  c64_techniques_for: [{ category: "raster" }, TechniquesForSchema],
  c64_check_compatibility: [{ techniques: ["stable_raster_irq", "raster_bars"] }, CompatibilityCheckSchema],
  c64_timing_budget: [
    { technique: "stable_raster_irq", region: "pal", sprites_per_line: 2 },
    TimingBudgetSchema,
  ],
  c64_plan_budget: [
    { techniques: ["stable_raster_irq", "raster_bars:play", "lfsr_random:init"], region: "both" },
    PlanBudgetSchema,
  ],
  c64_pitfalls_for: [{ topic: "D012" }, PitfallsForSchema],
  c64_lint_source: [{ source: "  lda $d418\n  ora #$0f\n  sta $d418\n", language: "asm" }, LintSourceSchema],
  c64_failure_diagnose: [{ symptom: "black screen" }, FailureDiagnoseSchema],
  c64_demo_briefing: [{ description: "raster bars and a scroller" }, BriefingSchema],
  c64_game_briefing: [{ description: "vertical shoot-em-up", archetype: "vertical_shmup" }, BriefingSchema],
  c64_coverage: [{}, CoverageSchema],
  c64_suggest_links: [{ kind: "technique-register", limit: 3 }, SuggestLinksSchema],
  c64_report_gap: [{ query: "mcp-tools.test probe", tool_called: "c64_search" }, ReportGapSchema],
};

// The SDK's stdio transport passes only a minimal environment by default;
// the test store names (FALKOR_GRAPH, QDRANT_COLLECTION, ANALYTICS_DB) must
// reach the server or it would read the live stores.
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
);

let client: Client;
let tools: Awaited<ReturnType<Client["listTools"]>>["tools"] = [];

beforeAll(async () => {
  client = new Client({ name: "mcp-tools-test", version: "0" });
  await client.connect(new StdioClientTransport({ command: "node", args: ["src/cli.ts", "serve"], env }));
  tools = (await client.listTools()).tools;
}, 30000);

afterAll(async () => {
  await client.close();
});

describe("MCP tools over stdio", () => {
  it("lists every tool with a title and annotations", () => {
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.annotations, t.name).toBeDefined();
      expect(typeof t.annotations?.readOnlyHint, t.name).toBe("boolean");
      expect(t.annotations?.openWorldHint, t.name).toBe(false);
    }
  });

  it("has a test input for every tool it does not skip", () => {
    const untested = tools.map((t) => t.name).filter((n) => !SKIP.has(n) && !(n in CALLS));
    expect(untested).toEqual([]);
  });

  it("marks the tools that change state as not read-only", () => {
    const byName = new Map(tools.map((t) => [t.name, t.annotations]));
    expect(byName.get("c64_ingest_doc")?.readOnlyHint).toBe(false);
    expect(byName.get("c64_report_gap")?.readOnlyHint).toBe(false);
    expect(byName.get("c64_report_gap")?.destructiveHint).toBe(false);
    expect(byName.get("c64_run_game")?.destructiveHint).toBe(true);
  });

  for (const [name, [args, schema]] of Object.entries(CALLS)) {
    it(`${name} replies without error${schema ? " and matches its output schema" : ""}`, async () => {
      const declared = tools.find((t) => t.name === name);
      expect(declared, `${name} is not listed`).toBeDefined();
      const reply = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
      expect(reply.isError ?? false, JSON.stringify(reply.content)).toBe(false);
      if (declared?.outputSchema) {
        expect(schema, `${name} declares an outputSchema; give it one here`).not.toBeNull();
        const parsed = schema?.safeParse(reply.structuredContent);
        expect(parsed?.success, JSON.stringify(parsed?.error?.issues)).toBe(true);
      } else {
        expect(reply.structuredContent).toBeUndefined();
      }
    }, 130000);
  }
});

describe("RE tool replies carry the whole result", () => {
  const run = {
    prg: "/tmp/t.prg",
    model: "pal" as const,
    cycles: 4_000_000,
    entry: 0x080d,
    start_clock: 2_500_000,
    vice: "x64sc",
  };
  const o = { basis: "measured-vice" as const, rung: 1 as const };

  it("declares an outputSchema for each RE tool", () => {
    for (const name of [
      "c64_re_irq_chain",
      "c64_re_frame_profile",
      "c64_re_session",
      "c64_re_snapshot",
      "c64_re_load_map",
      "c64_re_coverage",
    ])
      expect(tools.find((t) => t.name === name)?.outputSchema, name).toBeDefined();
  });

  it("c64_re_irq_chain: structured content parses with its schema and holds every observation", () => {
    const result = {
      interrupts: 1,
      vectors: [
        {
          ...o,
          id: "v0",
          vector: "irq_fffe" as const,
          value: 0x0840,
          pc: 0x0815,
          clock: 2_500_010,
          line: 30,
        },
      ],
      arms: [{ ...o, id: "a0", line: 100, pc: 0x0820, clock: 2_500_020, at_line: 30 }],
      entries: [
        { ...o, id: "e0", handler: 0x0840, target: 0x0900, line: 100, cycle: 12, clock: 2_510_000, frame: 0 },
      ],
      handlers: [
        {
          handler: 0x0840,
          via: ["irq_fffe" as const],
          entries: 1,
          entry_lines: [100],
          armed_before: [100],
          pointer: 0x0406,
          dispatch: [{ target: 0x0900, entries: 1, entry_lines: [100], armed_before: [100] }],
        },
      ],
      transient: [{ vector: "irq_fffe" as const, value: 0x0800, writes: 1 }],
      unknowns: ["irq_0314: $0315 never written, so the handler address is unknown"],
    };
    const r = irqChainReply({ ok: true, run, result });
    expect(r.text).toMatch(/handler \$0840 via irq_fffe/);
    expect(r.text).toMatch(/transient: \$0800 in irq_fffe/);
    expect(r.text).toMatch(/JMP \(\$0406\)\n {2}-> \$0900: 1 entries on lines 100; armed 100/);
    const parsed = z.object(IrqChainOutput).safeParse(r.structured);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(r.structured).toEqual({ run, ...result });
  });

  it("c64_re_frame_profile: every sample with its frame is in the structured content", () => {
    const samples = [0, 1, 2].map((i) => ({
      ...o,
      id: `s${i}`,
      cycles: 500 + i,
      start_clock: 2_500_000 + i * 19_656,
      frame: i,
    }));
    const result = { samples, worst: 502, typical: 501, count: 3, unpaired: 0, over_frame: 0, unknowns: [] };
    const r = frameProfileReply({ ok: true, run, result });
    const parsed = z.object(FrameProfileOutput).safeParse(r.structured);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.samples?.map((s) => s.frame)).toEqual([0, 1, 2]);
    expect(parsed.data?.mode).toBe("region");
  });

  it("c64_re_frame_profile frame mode: parts, per-frame figures and the Measured frame line", () => {
    const st = (n: number) => ({ worst: n, typical: n, least: n });
    const result = {
      mode: "frame" as const,
      frames: [
        {
          ...o,
          id: "f0",
          frame: 3,
          start_clock: 58_968,
          handlers: 626,
          interrupts: 5,
          idle: 9000,
          main: 10_030,
          rest: 19_030,
        },
      ],
      parts: [
        {
          handler: 0x4134,
          target: 0x41c5,
          slot: 0,
          entries: 1,
          entry_lines: [30],
          cost: st(1097),
          dispatch: st(41),
        },
      ],
      per_frame: { handlers: st(626), rest: st(19_030), main: st(10_030), idle: st(9000) },
      measured_frame: "play pal worst=10656 typical=10656",
      wait: { pc: 0x402a, exit: 0x4032 },
      interrupts: 1,
      unreturned: 0,
      unknowns: [],
    };
    const r = frameModeReply({ ok: true, run, result });
    const parsed = z.object(FrameProfileOutput).safeParse(r.structured);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(r.text).toMatch(/\$4134 -> \$41C5: 1 entries on lines 30; cost 1097 typical/);
    expect(r.text).toMatch(
      /\*\*Measured frame:\*\* play pal worst=10656 typical=10656 \(measured-vice-study, c64_re_frame_profile frame mode, frame minus the \$402A to \$4032 wait over 1 frames, /,
    );
    expect(r.text).toMatch(/wait \$402A to \$4032/);
  });

  it("c64_re_session: the in-play clock and each injection's firing are in the structured content", () => {
    const result = {
      session: "commando",
      image: {
        sha1: "b2ca47949468c3d1790dfe8b2fc9b54cb9638c3f",
        kind: "d64" as const,
        file: "commando",
        fileSha1: "0c19",
      },
      disk: true,
      model: "pal" as const,
      cycles: 60_000_000,
      play_clock: 36_000_100,
      play_frame: 1831,
      injections: [
        { at_pc: "$0FB5", fired_at_clock: 35_000_000 },
        { at_pc: "$C000", fired_at_clock: null },
      ],
      screenshot: "/repo/data/re/session-commando.png",
      unknowns: ["injection at $C000 never fired"],
    };
    const r = sessionReply({ ok: true, result });
    expect(r.text).toMatch(/in play at clock 36000100, frame 1831/);
    expect(r.text).toMatch(/\$0FB5 fired at clock 35000000; \$C000 never fired/);
    const parsed = z.object(SessionOutput).safeParse(r.structured);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(r.structured).toEqual(result);
    const irq = irqChainReply({
      ok: true,
      run: { ...run, session: "commando", image: result.image },
      result: {
        interrupts: 0,
        vectors: [],
        arms: [],
        entries: [],
        handlers: [],
        transient: [],
        unknowns: [],
      },
    });
    expect(z.object(IrqChainOutput).safeParse(irq.structured).success).toBe(true);
  });

  it("c64_re_session: not-in-play is refused as text and isError", () => {
    const r = sessionReply({
      ok: false,
      reason: "not-in-play",
      error: "in_play not reached",
      clock: 60_000_000,
      screenshot: "/repo/data/re/session-commando.png",
    });
    expect(r).toEqual({ text: "refused (not-in-play): in_play not reached", isError: true });
  });

  it("c64_re_snapshot: the decoded VIC state and CPU port are in the structured content", () => {
    const result = {
      ram_path: "/repo/data/re/abc123-35080026.bin",
      ram_sha1: "abc123",
      clock: 35_080_026,
      vic: {
        bank: 3,
        screen: 0xe000,
        charset: 0xd000,
        bitmap: 0xc000,
        sprite_pointers: [0xffc0, 0xffc0, 0xffc0, 0xffc0, 0xffc0, 0xfdc0, 0xfd80, 0xfe00],
        d011: 0x77,
        d016: 0xd8,
        d018: 0x85,
      },
      cpu_port: { "00": 0x2f, "01": 0x36 },
    };
    const r = snapshotReply({ ok: true, result });
    expect(r.text).toMatch(/VIC bank 3: screen \$E000, charset \$D000, bitmap \$C000/);
    expect(r.text).toMatch(/CPU port \$00=\$2F \$01=\$36/);
    const parsed = z.object(SnapshotOutput).safeParse(r.structured);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(r.structured).toEqual(result);
  });

  it("c64_re_snapshot: no-dump is refused as text and isError", () => {
    const r = snapshotReply({
      ok: false,
      reason: "no-dump",
      error: "in_play reached at clock 100, but $0876 did not run 100001 times",
      clock: 100,
      screenshot: "/repo/data/re/snapshot.png",
    });
    expect(r).toEqual({
      text: "refused (no-dump): in_play reached at clock 100, but $0876 did not run 100001 times",
      isError: true,
    });
  });

  const m1 = (id: string) => ({ id, basis: "measured-vice" as const, rung: 1 as const });

  it("c64_re_load_map: stubs, writers and the first dispatch clock are in the structured content", () => {
    const result = {
      load: 0x0801,
      end: 0xaffc,
      stubs: [
        { ...m1("s0"), addr: 0x0801, sys: 2217, text: "COMPUTERBRAINS", line: 2049 },
        { ...m1("s1"), addr: 0x08e5, sys: 2066, text: "C.C.S.", line: 65535 },
      ],
      writers: [
        {
          ...m1("w0"),
          stage: 2,
          pc_range: { start: 0x0104, end: 0x019e },
          dest_ranges: [
            { start: 0x0800, end: 0xcfff },
            { start: 0xe000, end: 0xffff },
          ],
          stores: 528_765,
          first_clock: 8_992_780,
          last_clock: 15_190_653,
          in_stack_page: true,
          ram_under_io: [],
        },
        {
          ...m1("w1"),
          stage: null,
          pc_range: { start: 0xa35a, end: 0xa370 },
          dest_ranges: [{ start: 0xd000, end: 0xdfff }],
          stores: 4160,
          first_clock: 8_922_451,
          last_clock: 8_988_518,
          in_stack_page: false,
          ram_under_io: [{ start: 0xd000, end: 0xdfff }],
        },
      ],
      entry_pc: 0x0850,
      transient_vectors: [{ vector: "irq_fffe" as const, value: 0, writes: 7 }],
      first_program_dispatch_clock: 15_243_156,
      unknowns: [],
    };
    const r = loadMapReply({ ok: true, run, result });
    expect(r.text).toMatch(/load \$0801-\$AFFC/);
    expect(r.text).toMatch(
      /stubs: \$0801 line 2049 SYS 2217 COMPUTERBRAINS; \$08E5 line 65535 SYS 2066 C\.C\.S\./,
    );
    expect(r.text).toMatch(
      /w0 stage 2 \$0104-\$019E \(stack page\): 528765 stores, clock 8992780-15190653 -> \$0800-\$CFFF, \$E000-\$FFFF\n/,
    );
    expect(r.text).toMatch(
      /\$A35A-\$A370: 4160 stores, .* -> \$D000-\$DFFF \(RAM under I\/O: \$D000-\$DFFF\)/,
    );
    expect(r.text).toMatch(/first program dispatch at clock 15243156/);
    const parsed = z.object(LoadMapOutput).safeParse(r.structured);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(r.structured).toEqual({ run, ...result });
    // The schema requires the observation fields on writers and stubs.
    const bare = { run, ...result, writers: result.writers.map((w) => ({ ...w, id: undefined })) };
    expect(z.object(LoadMapOutput).safeParse(bare).success).toBe(false);
    const noRung = { run, ...result, stubs: result.stubs.map((st) => ({ ...st, rung: undefined })) };
    expect(z.object(LoadMapOutput).safeParse(noRung).success).toBe(false);
  });

  it("c64_re_load_map: no entries at all says no dispatch, and a refusal is text and isError", () => {
    const r = loadMapReply({
      ok: true,
      run,
      result: {
        load: 0x0801,
        end: 0x0900,
        stubs: [],
        writers: [],
        entry_pc: null,
        transient_vectors: [],
        first_program_dispatch_clock: null,
        unknowns: [
          "no interrupt entered a handler the program installed within 4000000 cycles; writers cover the whole run",
        ],
      },
    });
    expect(r.text).toMatch(/no program-installed handler dispatched/);
    expect(r.text).toMatch(/unknown: no interrupt entered a handler the program installed/);
    const bad = loadMapReply({ ok: false, reason: "no-entry", error: "entry $080D not reached" });
    expect(bad).toEqual({ text: "refused (no-entry): entry $080D not reached", isError: true });
  });

  it("a refusal is text and isError, with no structured content", () => {
    const r = frameProfileReply({
      ok: false,
      reason: "no-entry",
      error: "entry $080D not reached in 200000 cycles; raise cycles",
    });
    expect(r).toEqual({
      text: "refused (no-entry): entry $080D not reached in 200000 cycles; raise cycles",
      isError: true,
    });
  });

  it("c64_re_coverage: code, data, written_only, unknown, and span are in structured content", () => {
    const result = {
      code: [{ start: 0x080e, end: 0x0848, kinds: ["x" as const] }],
      data: [{ start: 0x0314, end: 0x0315, kinds: ["r" as const, "w" as const] }],
      written_only: [{ start: 0xd019, end: 0xd019, kinds: ["w" as const] }],
      unknown: [{ start: 0x0000, end: 0x080d, kinds: [] as ("x" | "r" | "w")[] }],
      show_clock: 3_000_362,
      span_cycles: 29_841,
      span_frames: 1.52,
      unknowns: [],
    };
    const r = coverageReply({ ok: true, run, result });
    expect(r.text).toMatch(/show at clock 3000362/);
    expect(r.text).toMatch(/code:\n {2}\$080E-\$0848/);
    expect(r.text).toMatch(/data:\n {2}\$0314-\$0315/);
    expect(r.text).toMatch(/written_only:\n {2}\$D019-\$D019/);
    expect(r.text).toMatch(/unknown:\n {2}\$0000-\$080D/);
    const parsed = z.object(CoverageOutput).safeParse(r.structured);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(r.structured).toEqual({ run, ...result });
  });
});
