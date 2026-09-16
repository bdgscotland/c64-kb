/**
 * Tests for Orchestrator T17: archive full TuneExtract to gzipped JSON during ingest.
 *
 * Uses the same helper pattern as orchestrator.test.ts.
 */

import {
  describe, it, expect, beforeEach, afterEach, vi,
} from "vitest";
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { IngestStateStore } from "../state-store.js";
import { Orchestrator, type OrchestratorOpts, type RunSummary } from "../orchestrator.js";
import type { ExtractResult, TuneExtract } from "../ingest.js";

// ── Helpers (replicated from orchestrator.test.ts) ────────────────────────────

function makeTuneExtract(md5: string, subtune = 0): TuneExtract {
  return {
    kind: "extract",
    file_md5: md5,
    subtune_index: subtune,
    meta: {
      title: `Test Tune ${md5}`,
      composer: "Test Composer",
      year: 1987,
      chip: "6581",
      region: "PAL",
      length_sec: 120,
      hvsc_path: `/MUSICIANS/T/Test/${md5}.sid`,
      subtune_count: 1,
    },
    events: [{ tick: 0, voice: 0, note: 48 }],
    instruments: [{ id: 0, name: "bass", ad: 9, sr: 240 }],
    filter_curve: [{ freq: 1000, cutoff: 0.5 }],
    pulsewidth: [{ tick: 0, voice: 0, pw: 2048 }],
    structure: { sections: [{ start: 0, end: 100, label: "A" }] },
    driver: { hash: "deadbeef", init_offset: 0, play_offset: 3, byte_signature: "ea ea ea" },
    pipeline_version: "0.1.0",
    clustering_params_hash: "abc",
  } as unknown as TuneExtract;
}

function makeWorkerStub(extractFn: (sidPath: string, subtune: number) => Promise<ExtractResult>) {
  return {
    extract: (req: { sidPath: string; subtune: number }) => extractFn(req.sidPath, req.subtune),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("../ingest.js").AnalyzerWorker;
}

function makeFalkorStub() {
  return {
    upsertTune: vi.fn().mockResolvedValue(undefined),
    // makeTuneExtract carries a `structure` with sections + events, so
    // hydrateOneTune persists Section and form nodes too. These must be stubbed
    // or the undefined methods throw inside processOne and the tune is counted
    // as an error (processed=0). (orchestrator.test.ts's extract has no
    // structure, so it never reaches these — which is why its stub omits them.)
    upsertSections: vi.fn().mockResolvedValue(undefined),
    upsertForm: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("../../services/falkor-hvsc.js").FalkorHvscClient;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

let tmpDir: string;
let store: IngestStateStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "orch-archive-test-"));
  store = new IngestStateStore(join(tmpDir, "ingest-state.db"));
});

afterEach(() => {
  store.close();
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  vi.restoreAllMocks();
});

// ── Shared builder ────────────────────────────────────────────────────────────

function makeOrchestrator(
  overrides: Partial<OrchestratorOpts> & {
    worker: OrchestratorOpts["worker"];
    falkor: OrchestratorOpts["falkor"];
    md5ToPath?: Map<string, string>;
    extractsDir?: string;
  },
): Orchestrator {
  return new Orchestrator({
    stateStore: store,
    corpusBase: "/corpus/C64Music",
    catalogs: {
      songlengths: new Map(),
      stil: new Map(),
    },
    skipQdrant: true,
    ...overrides,
    md5ToPath: overrides.md5ToPath ?? new Map(),
  } as OrchestratorOpts);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Orchestrator T17 — archive extract", () => {
  it("writes a gzipped JSON file at the sharded path when extractsDir is set", async () => {
    const md5 = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"; // 32-char MD5
    const extractsDir = join(tmpDir, "extracts");
    mkdirSync(extractsDir, { recursive: true });

    store.upsertPending([{ file_md5: md5, subtune_index: 0 }]);

    const extract = makeTuneExtract(md5, 0);
    const worker = makeWorkerStub(() => Promise.resolve(extract));
    const falkor = makeFalkorStub();
    const md5ToPath = new Map([[md5, `/MUSICIANS/T/Test/${md5}.sid`]]);

    const orch = makeOrchestrator({ worker, falkor, md5ToPath, extractsDir });
    const summary = await orch.run();

    expect(summary.processed).toBe(1);
    expect(summary.errors).toBe(0);

    // Verify file exists at expected sharded path
    const expectedFile = join(extractsDir, md5.slice(0, 2), `${md5}.0.json.gz`);
    expect(existsSync(expectedFile)).toBe(true);

    // Decompress and parse
    const gz = readFileSync(expectedFile);
    const json = JSON.parse(gunzipSync(gz).toString("utf8")) as Record<string, unknown>;

    // Verify core identity fields round-trip
    expect(json.file_md5).toBe(md5);
    expect(json.subtune_index).toBe(0);

    // Verify that rich arrays are present (not discarded)
    expect(Array.isArray(json.events)).toBe(true);
    expect((json.events as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(json.filter_curve)).toBe(true);
    expect((json.filter_curve as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(json.pulsewidth)).toBe(true);
    expect((json.pulsewidth as unknown[]).length).toBeGreaterThan(0);
  });

  it("does NOT create any extracts directory when extractsDir is undefined (backward compat)", async () => {
    const md5 = "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5"; // 32-char MD5
    store.upsertPending([{ file_md5: md5, subtune_index: 0 }]);

    const extract = makeTuneExtract(md5, 0);
    const worker = makeWorkerStub(() => Promise.resolve(extract));
    const falkor = makeFalkorStub();
    const md5ToPath = new Map([[md5, `/MUSICIANS/T/Test/${md5}.sid`]]);

    // No extractsDir — archival should be skipped entirely
    const orch = makeOrchestrator({ worker, falkor, md5ToPath });
    const summary = await orch.run();

    expect(summary.processed).toBe(1);
    expect(summary.errors).toBe(0);

    // Confirm no extracts directory was created in tmpDir
    const possibleExtractsDir = join(tmpDir, "extracts");
    expect(existsSync(possibleExtractsDir)).toBe(false);
  });

  it("never throws when archival fails — tune completes and no archive file is written", async () => {
    const md5 = "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1"; // 32-char MD5

    // Create a FILE at a path we will then try to use as a directory.
    // mkdirSync(<file>/sub) throws ENOTDIR, which exercises the catch block
    // in archiveExtract.  vi.spyOn(process.stderr, "write") does not work in
    // vitest's forks pool (the native IPC stream isn't interceptable), so we
    // verify the failure via two observable effects instead:
    //   1. The tune still completes (processed=1, errors=0).
    //   2. No archive file was written (the failure was genuine, not silently skipped).
    const blockingFile = join(tmpDir, "not-a-dir");
    writeFileSync(blockingFile, "block");
    // extractsDir points INSIDE the file — mkdirSync must fail with ENOTDIR.
    const extractsDir = join(blockingFile, "sub");

    store.upsertPending([{ file_md5: md5, subtune_index: 0 }]);

    const extract = makeTuneExtract(md5, 0);
    const worker = makeWorkerStub(() => Promise.resolve(extract));
    const falkor = makeFalkorStub();
    const md5ToPath = new Map([[md5, `/MUSICIANS/T/Test/${md5}.sid`]]);

    const orch = makeOrchestrator({ worker, falkor, md5ToPath, extractsDir });
    const summary = await orch.run();

    // Headline property: a disk failure during archival must NOT fail the tune.
    expect(summary.processed).toBe(1);
    expect(summary.errors).toBe(0);

    // The archive file must NOT exist — this confirms the catch path fired
    // (not that archival was silently skipped due to some other condition).
    const expectedFile = join(extractsDir, md5.slice(0, 2), `${md5}.0.json.gz`);
    expect(existsSync(expectedFile)).toBe(false);

    // The blocking file itself must still be a plain file (not accidentally
    // replaced by a directory), proving mkdirSync really did fail.
    const { statSync } = await import("node:fs");
    expect(statSync(blockingFile).isFile()).toBe(true);
  });

  it("archives AFTER the T1 hvsc_path override so the corrected path is preserved", async () => {
    const md5 = "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6"; // 32-char MD5
    const relPath = "/MUSICIANS/H/Hubbard_Rob/Commando.sid";
    const absolutePath = `/corpus/C64Music${relPath}`;
    const extractsDir = join(tmpDir, "extracts");
    mkdirSync(extractsDir, { recursive: true });

    store.upsertPending([{ file_md5: md5, subtune_index: 0 }]);

    // Simulate analyzer setting an absolute path (as Python extractor does)
    const extract = makeTuneExtract(md5, 0);
    extract.meta.hvsc_path = absolutePath;

    const worker = makeWorkerStub(() => Promise.resolve(extract));
    const falkor = makeFalkorStub();
    // The orchestrator maps this md5 to the corpus-relative path
    const md5ToPath = new Map([[md5, relPath]]);

    const orch = makeOrchestrator({ worker, falkor, md5ToPath, extractsDir });
    await orch.run();

    const expectedFile = join(extractsDir, md5.slice(0, 2), `${md5}.0.json.gz`);
    expect(existsSync(expectedFile)).toBe(true);

    const gz = readFileSync(expectedFile);
    const json = JSON.parse(gunzipSync(gz).toString("utf8")) as { meta: { hvsc_path: string } };

    // The archived file must have the corpus-relative path, not the absolute one
    expect(json.meta.hvsc_path).toBe(relPath);
    expect(json.meta.hvsc_path).not.toBe(absolutePath);
  });
});
