/**
 * Unit tests for Orchestrator.run()
 *
 * All external collaborators are mocked:
 *   - IngestStateStore  → in-memory fake backed by a real SQLite DB in tmpdir
 *   - AnalyzerWorker    → stub with a programmable extract() function
 *   - FalkorHvscClient  → stub (upsertTune is a no-op spy)
 *
 * No real vsid / Python worker / FalkorDB connections are made.
 */

import {
  describe, it, expect, beforeEach, afterEach, vi,
} from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { IngestStateStore } from "../state-store.js";
import { Orchestrator, type OrchestratorOpts, type ProgressSnapshot } from "../orchestrator.js";
import type { ExtractResult, TuneExtract } from "../ingest.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    events: [],
    instruments: [],
    filter_curve: [],
    pulsewidth: [],
    structure: { sections: [] },
    driver: { hash: "deadbeef", init_offset: 0, play_offset: 3, byte_signature: "ea ea ea" },
    pipeline_version: "0.1.0",
    clustering_params_hash: "abc",
  } as unknown as TuneExtract;
}

function makeErrorResult(md5: string, subtune = 0, errorKind = "vsid_crash"): ExtractResult {
  return {
    kind: "error",
    file_md5: md5,
    subtune_index: subtune,
    error_kind: errorKind,
    message: "test error",
  };
}

/** Minimal AnalyzerWorker stub — extract() is overrideable per test. */
function makeWorkerStub(extractFn: (sidPath: string, subtune: number) => Promise<ExtractResult>) {
  return {
    extract: (req: { sidPath: string; subtune: number }) => extractFn(req.sidPath, req.subtune),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("../ingest.js").AnalyzerWorker;
}

/** Minimal FalkorHvscClient stub — upsertTune records calls. */
function makeFalkorStub() {
  const calls: unknown[] = [];
  return {
    calls,
    upsertTune: vi.fn().mockImplementation((input: unknown) => {
      calls.push(input);
      return Promise.resolve();
    }),
  } as unknown as import("../../services/falkor-hvsc.js").FalkorHvscClient & { calls: unknown[] };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

let tmpDir: string;
let store: IngestStateStore;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `orch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
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
    worker?: OrchestratorOpts["worker"];
    workers?: OrchestratorOpts["workers"];
    falkor: OrchestratorOpts["falkor"];
    md5ToPath?: Map<string, string>;
  },
): Orchestrator {
  return new Orchestrator({
    stateStore: store,
    corpusBase: "/corpus/C64Music",
    catalogs: {
      songlengths: new Map([["aabbcc", [120, 90]]]),
      stil: new Map(),
    },
    skipQdrant: true,
    ...overrides,
    md2ToPath: undefined as never,    // ensure the named key below wins
    md5ToPath: overrides.md5ToPath ?? new Map(),
  } as OrchestratorOpts);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Orchestrator.run — basic drain", () => {
  it("drains all pending rows successfully", async () => {
    const md5a = "a".repeat(32);
    const md5b = "b".repeat(32);

    store.upsertPending([
      { file_md5: md5a, subtune_index: 0 },
      { file_md5: md5b, subtune_index: 0 },
    ]);

    const extractFn = vi.fn().mockImplementation(
      (_path: string, subtune: number): Promise<ExtractResult> => {
        const md5 = _path.includes(md5a) ? md5a : md5b;
        return Promise.resolve(makeTuneExtract(md5, subtune));
      },
    );
    const worker = makeWorkerStub(extractFn);
    const falkor = makeFalkorStub();

    const md5ToPath = new Map([
      [md5a, `/MUSICIANS/T/Test/${md5a}.sid`],
      [md5b, `/MUSICIANS/T/Test/${md5b}.sid`],
    ]);

    const orch = makeOrchestrator({ worker, falkor, md5ToPath });
    const summary = await orch.run();

    expect(summary.processed).toBe(2);
    expect(summary.errors).toBe(0);

    const counts = store.countsByStatus();
    expect(counts.complete).toBe(2);
    expect(counts.pending).toBe(0);
    expect(counts.in_progress).toBe(0);
  });

  it("returns early when queue is empty from the start", async () => {
    const worker = makeWorkerStub(() => Promise.reject(new Error("should not be called")));
    const falkor = makeFalkorStub();

    const orch = makeOrchestrator({ worker, falkor });
    const summary = await orch.run();

    expect(summary.processed).toBe(0);
    expect(summary.errors).toBe(0);
  });
});

describe("Orchestrator.run — error handling", () => {
  it("classifies transient errors (vsid_crash) and stays below permanent threshold", async () => {
    const md5 = "c".repeat(32);
    store.upsertPending([{ file_md5: md5, subtune_index: 0 }]);

    // extract always returns a transient error
    const worker = makeWorkerStub(() =>
      Promise.resolve(makeErrorResult(md5, 0, "vsid_crash")),
    );
    const falkor = makeFalkorStub();
    const md5ToPath = new Map([[md5, `/MUSICIANS/T/Test/${md5}.sid`]]);

    const orch = makeOrchestrator({ worker, falkor, md5ToPath });
    const summary = await orch.run();

    // run() drains pending; after one transient error the row becomes
    // error_transient (not re-queued as pending here), so the loop finishes.
    expect(summary.errors).toBe(1);
    expect(summary.processed).toBe(0);

    const counts = store.countsByStatus();
    // After 1 attempt, attempts=1 < MAX_ATTEMPTS(3) → error_transient.
    expect(counts.error_transient).toBe(1);
    expect(counts.error_permanent).toBe(0);
  });

  it("escalates to permanent after MAX_ATTEMPTS transient failures", async () => {
    const md5 = "d".repeat(32);
    // Seed the row with 2 prior attempts already recorded so the next recordError
    // pushes it to attempts=3 = MAX_ATTEMPTS → error_permanent.
    store.upsertPending([{ file_md5: md5, subtune_index: 0 }]);
    // Simulate 2 prior failures by calling recordError twice
    store.recordError(md5, 0, "vsid_crash", true); // attempts → 1 → error_transient
    // Re-queue so takeNext() can claim it again
    store.requeueByKind("vsid_crash");
    store.takeNext(); // mark in_progress for the second attempt path
    store.recordError(md5, 0, "vsid_crash", true); // attempts → 2 → error_transient
    // Re-queue for the 3rd attempt
    store.requeueByKind("vsid_crash");

    // Now run — the third attempt should escalate to permanent
    const worker = makeWorkerStub(() =>
      Promise.resolve(makeErrorResult(md5, 0, "vsid_crash")),
    );
    const falkor = makeFalkorStub();
    const md5ToPath = new Map([[md5, `/MUSICIANS/T/Test/${md5}.sid`]]);

    const orch = makeOrchestrator({ worker, falkor, md5ToPath });
    await orch.run();

    const counts = store.countsByStatus();
    expect(counts.error_permanent).toBe(1);
    expect(counts.error_transient).toBe(0);
  });

  it("records permanent errors immediately for non-transient error kinds", async () => {
    const md5 = "e".repeat(32);
    store.upsertPending([{ file_md5: md5, subtune_index: 0 }]);

    // "mus_unsupported" is not in TRANSIENT_ERROR_KINDS → permanent immediately
    const worker = makeWorkerStub(() =>
      Promise.resolve(makeErrorResult(md5, 0, "mus_unsupported")),
    );
    const falkor = makeFalkorStub();
    const md5ToPath = new Map([[md5, `/MUSICIANS/T/Test/${md5}.sid`]]);

    const orch = makeOrchestrator({ worker, falkor, md5ToPath });
    const summary = await orch.run();

    expect(summary.errors).toBe(1);
    const counts = store.countsByStatus();
    expect(counts.error_permanent).toBe(1);
    expect(counts.error_transient).toBe(0);
  });

  it("records path_missing as permanent when md5ToPath has no entry", async () => {
    const md5 = "f".repeat(32);
    store.upsertPending([{ file_md5: md5, subtune_index: 0 }]);

    // md5ToPath intentionally empty → path_missing → permanent
    const worker = makeWorkerStub(() => Promise.reject(new Error("should not be called")));
    const falkor = makeFalkorStub();

    const orch = makeOrchestrator({ worker, falkor, md5ToPath: new Map() });
    const summary = await orch.run();

    expect(summary.errors).toBe(1);
    const counts = store.countsByStatus();
    expect(counts.error_permanent).toBe(1);
  });

  it("handles unexpected JS exceptions with a transient classification", async () => {
    const md5 = "g".repeat(32);
    store.upsertPending([{ file_md5: md5, subtune_index: 0 }]);

    const worker = makeWorkerStub(() =>
      Promise.reject(new TypeError("unexpected worker failure")),
    );
    const falkor = makeFalkorStub();
    const md5ToPath = new Map([[md5, `/MUSICIANS/T/Test/${md5}.sid`]]);

    const orch = makeOrchestrator({ worker, falkor, md5ToPath });
    const summary = await orch.run();

    expect(summary.errors).toBe(1);
    // TypeError → transient on first attempt (attempts=1 < MAX_ATTEMPTS=3)
    const counts = store.countsByStatus();
    expect(counts.error_transient).toBe(1);
  });
});

describe("Orchestrator.run — cancel token", () => {
  it("stops cleanly when cancel token is set between rows", async () => {
    const md5a = "h".repeat(32);
    const md5b = "i".repeat(32);
    store.upsertPending([
      { file_md5: md5a, subtune_index: 0 },
      { file_md5: md5b, subtune_index: 0 },
    ]);

    const cancelToken = { cancelled: false };

    const worker = makeWorkerStub(
      (_path: string, subtune: number): Promise<ExtractResult> => {
        // Cancel after the first extract so the second row is never processed.
        cancelToken.cancelled = true;
        const md5 = _path.includes(md5a) ? md5a : md5b;
        return Promise.resolve(makeTuneExtract(md5, subtune));
      },
    );
    const falkor = makeFalkorStub();
    const md5ToPath = new Map([
      [md5a, `/MUSICIANS/T/Test/${md5a}.sid`],
      [md5b, `/MUSICIANS/T/Test/${md5b}.sid`],
    ]);

    const orch = makeOrchestrator({ worker, falkor, md5ToPath, cancelToken });
    const summary = await orch.run();

    // Only the first row should have been processed; the second is still pending.
    expect(summary.processed).toBe(1);
    const counts = store.countsByStatus();
    expect(counts.complete).toBe(1);
    expect(counts.pending).toBe(1);
  });
});

describe("Orchestrator.run — orphan recovery", () => {
  it("promotes in_progress orphans to pending before draining", async () => {
    const md5 = "j".repeat(32);
    // Simulate a row stuck in_progress (orphaned from a prior crash)
    store.upsertPending([{ file_md5: md5, subtune_index: 0 }]);
    store.takeNext(); // marks it in_progress — simulates the crash leaving it here

    // Counts before run
    expect(store.countsByStatus().in_progress).toBe(1);
    expect(store.countsByStatus().pending).toBe(0);

    const worker = makeWorkerStub(() =>
      Promise.resolve(makeTuneExtract(md5, 0)),
    );
    const falkor = makeFalkorStub();
    const md5ToPath = new Map([[md5, `/MUSICIANS/T/Test/${md5}.sid`]]);

    const orch = makeOrchestrator({ worker, falkor, md5ToPath });
    const summary = await orch.run();

    expect(summary.processed).toBe(1);
    expect(store.countsByStatus().complete).toBe(1);
    expect(store.countsByStatus().in_progress).toBe(0);
  });
});

describe("Orchestrator.run — progress callback", () => {
  it("emits progress snapshots via onProgress callback", async () => {
    vi.useFakeTimers();
    const md5 = "k".repeat(32);
    store.upsertPending([{ file_md5: md5, subtune_index: 0 }]);

    const snapshots: ProgressSnapshot[] = [];
    const onProgress = (snap: ProgressSnapshot) => snapshots.push(snap);

    let resolveExtract!: (r: ExtractResult) => void;
    const extractPromise = new Promise<ExtractResult>((res) => {
      resolveExtract = res;
    });

    const worker = makeWorkerStub(() => extractPromise);
    const falkor = makeFalkorStub();
    const md5ToPath = new Map([[md5, `/MUSICIANS/T/Test/${md5}.sid`]]);

    const orch = makeOrchestrator({ worker, falkor, md5ToPath, onProgress });

    // Start run() in the background; it will block waiting for extract.
    const runPromise = orch.run();

    // Advance 5 s to trigger the progress interval.
    await vi.advanceTimersByTimeAsync(5000);

    // At this point the extract is still pending, so we expect at least one
    // progress callback with processed=0 and pending≥0.
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    const snap = snapshots[0];
    expect(snap).toHaveProperty("processed");
    expect(snap).toHaveProperty("pending");
    expect(snap).toHaveProperty("errors");
    expect(snap).toHaveProperty("throughput_per_min");

    // Resolve the extract and let run() complete.
    resolveExtract(makeTuneExtract(md5, 0));
    await runPromise;

    vi.useRealTimers();
  });
});

describe("Orchestrator.run — enrichment wiring", () => {
  it("calls hydrateOneTune with Songlengths-derived length_sec", async () => {
    const md5 = "l".repeat(32);
    store.upsertPending([{ file_md5: md5, subtune_index: 0 }]);

    const worker = makeWorkerStub(() =>
      Promise.resolve(makeTuneExtract(md5, 0)),
    );

    // Capture upsertTune calls to verify enrichment is forwarded.
    const upsertCalls: unknown[] = [];
    const falkor = {
      upsertTune: (input: unknown) => {
        upsertCalls.push(input);
        return Promise.resolve();
      },
    } as unknown as import("../../services/falkor-hvsc.js").FalkorHvscClient;

    const songlengths = new Map([[md5, [235.5, 190.0]]]);
    const md5ToPath = new Map([[md5, `/MUSICIANS/T/Test/${md5}.sid`]]);

    const orch = new Orchestrator({
      stateStore: store,
      corpusBase: "/corpus/C64Music",
      catalogs: { songlengths, stil: new Map() },
      falkor,
      worker,
      md5ToPath,
      skipQdrant: true,
    });

    await orch.run();

    expect(upsertCalls.length).toBe(1);
    const call = upsertCalls[0] as { length_sec: number };
    // subtune_index=0 → lengths[0] = 235.5
    expect(call.length_sec).toBeCloseTo(235.5);
  });

  it("falls back to STIL subtune :0 entry when subtune-specific key is absent", async () => {
    const md5 = "m".repeat(32);
    const hvscPath = `/MUSICIANS/T/Test/${md5}.sid`;
    store.upsertPending([{ file_md5: md5, subtune_index: 2 }]);

    const worker = makeWorkerStub(() =>
      Promise.resolve({ ...makeTuneExtract(md5, 0), subtune_index: 2 } as TuneExtract),
    );

    const upsertCalls: unknown[] = [];
    const falkor = {
      upsertTune: (input: unknown) => {
        upsertCalls.push(input);
        return Promise.resolve();
      },
    } as unknown as import("../../services/falkor-hvsc.js").FalkorHvscClient;

    // STIL only has an entry for subtune :0 (file-level)
    const stilEntry = {
      hvsc_path: hvscPath,
      subtune_index: 0,
      comment: "File-level comment",
      credits: [{ name: "Rob Hubbard", role: "composer" as const }],
      cover_relations: [],
    };
    const stil = new Map([[`${hvscPath}:0`, stilEntry]]);

    const md5ToPath = new Map([[md5, hvscPath]]);

    const orch = new Orchestrator({
      stateStore: store,
      corpusBase: "/corpus/C64Music",
      catalogs: { songlengths: new Map(), stil },
      falkor,
      worker,
      md5ToPath,
      skipQdrant: true,
    });

    await orch.run();

    expect(upsertCalls.length).toBe(1);
    const call = upsertCalls[0] as { stil_comment: string };
    expect(call.stil_comment).toBe("File-level comment");
  });
});

describe("Orchestrator.run — hvsc_path normalization", () => {
  it("overrides absolute hvsc_path from analyzer with corpus-relative path", async () => {
    const md5 = "a".repeat(32);
    const relPath = "/MUSICIANS/H/Hubbard_Rob/Commando.sid";

    store.upsertPending([{ file_md5: md5, subtune_index: 0 }]);

    // Simulate an analyzer result whose hvsc_path is an absolute filesystem path
    // (as emitted by the Python extractor, which doesn't know the corpus base).
    const absolutePath = `/corpus/C64Music${relPath}`;
    const extract = makeTuneExtract(md5, 0);
    extract.meta.hvsc_path = absolutePath;

    const worker = makeWorkerStub(() => Promise.resolve(extract));
    const falkor = makeFalkorStub();
    const md5ToPath = new Map([[md5, relPath]]);

    const orch = makeOrchestrator({ worker, falkor, md5ToPath });
    await orch.run();

    expect(falkor.calls.length).toBe(1);
    expect((falkor.calls[0] as Record<string, unknown>).hvsc_path).toBe(relPath);
  });
});

describe("Orchestrator.runDelta", () => {
  it("throws with a clear 'implementation pending' message", async () => {
    const worker = makeWorkerStub(() => Promise.reject(new Error("unreachable")));
    const falkor = makeFalkorStub();
    const orch = makeOrchestrator({ worker, falkor });
    await expect(orch.runDelta()).rejects.toThrow("delta-ingest implementation pending");
  });
});

describe("Orchestrator.run — multi-worker", () => {
  it("drains all rows across 2 workers with no row processed twice", async () => {
    // Seed 6 pending rows across 6 distinct MD5s.
    const md5s = Array.from({ length: 6 }, (_, i) => String(i).repeat(32));
    store.upsertPending(md5s.map((file_md5) => ({ file_md5, subtune_index: 0 })));

    const md5ToPath = new Map(
      md5s.map((m) => [m, `/MUSICIANS/T/Test/${m}.sid`]),
    );

    // Track which worker processed which MD5 to verify no double-processing.
    const w1Calls: string[] = [];
    const w2Calls: string[] = [];

    const w1 = makeWorkerStub((_path: string, subtune: number): Promise<import("../ingest.js").ExtractResult> => {
      const md5 = md5s.find((m) => _path.includes(m))!;
      w1Calls.push(md5);
      return Promise.resolve(makeTuneExtract(md5, subtune));
    });
    const w2 = makeWorkerStub((_path: string, subtune: number): Promise<import("../ingest.js").ExtractResult> => {
      const md5 = md5s.find((m) => _path.includes(m))!;
      w2Calls.push(md5);
      return Promise.resolve(makeTuneExtract(md5, subtune));
    });

    const falkor = makeFalkorStub();
    const orch = makeOrchestrator({ workers: [w1, w2], falkor, md5ToPath });
    const summary = await orch.run();

    // All 6 rows should complete successfully.
    expect(summary.processed).toBe(6);
    expect(summary.errors).toBe(0);

    const counts = store.countsByStatus();
    expect(counts.complete).toBe(6);
    expect(counts.pending).toBe(0);
    expect(counts.in_progress).toBe(0);

    // upsertTune called exactly 6 times — one per row, no duplicates.
    expect(falkor.calls.length).toBe(6);

    // Each MD5 was processed exactly once across both workers combined.
    const allProcessed = [...w1Calls, ...w2Calls];
    expect(allProcessed.sort()).toEqual([...md5s].sort());
  });

  it("throws when constructed with no workers at all", () => {
    const falkor = makeFalkorStub();
    expect(() =>
      new Orchestrator({
        stateStore: store,
        corpusBase: "/corpus/C64Music",
        catalogs: { songlengths: new Map(), stil: new Map() },
        falkor,
        md5ToPath: new Map(),
        skipQdrant: true,
      }),
    ).toThrow("Orchestrator requires at least one worker");
  });

  it("backward compat: single worker: field still works", async () => {
    const md5 = "9".repeat(32);
    store.upsertPending([{ file_md5: md5, subtune_index: 0 }]);
    const md5ToPath = new Map([[md5, `/MUSICIANS/T/Test/${md5}.sid`]]);

    const worker = makeWorkerStub((_path, subtune) =>
      Promise.resolve(makeTuneExtract(md5, subtune)),
    );
    const falkor = makeFalkorStub();

    // Pass single `worker:` (legacy interface) — must not throw, must process.
    const orch = makeOrchestrator({ worker, falkor, md5ToPath });
    const summary = await orch.run();

    expect(summary.processed).toBe(1);
    expect(summary.errors).toBe(0);
    expect(store.countsByStatus().complete).toBe(1);
  });
});
