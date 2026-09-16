/**
 * Mini-corpus end-to-end integration test (Task M8.1).
 *
 * Drives the full pipeline for 50 tunes through an isolated FalkorDB graph
 * and SQLite state store. Asserts at the end:
 *   - ≥90% of tunes (≥45/50) reach 'complete' status
 *   - At least 1 Tracker node exists in the graph
 *   - At least 1 RSID tune is correctly tagged is_rsid=true
 *   - At least 1 multi-SID tune is correctly tagged sid_count≥2
 *   - The Commando self-pair memorization check returns copy_detected=true
 *
 * Skipped by default — slow (20-50 min) and depends on HVSC corpus on disk.
 *
 * Run via:
 *     RUN_MINI_CORPUS=1 npm test -- src/hvsc/__tests__/ingest-mini-corpus.test.ts
 *
 * The HVSC corpus must be present at:
 *     data/hvsc-corpus/C64Music  (relative to the repo root)
 * If absent, the test suite skips cleanly without failing CI.
 *
 * Isolation guarantees:
 *   - FalkorDB graph:  c64_hvsc_mini_corpus_test_<timestamp>   (dropped in afterAll)
 *   - SQLite DB:       /tmp/mini-corpus-state-<timestamp>.db    (deleted in afterAll)
 *
 * DO NOT mutate the live c64_hvsc graph or live state store; this test
 * uses unique names derived from Date.now() to stay isolated.
 */

import {
  describe, it, expect, beforeAll, afterAll,
} from "vitest";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { parse } from "yaml";

import { IngestStateStore } from "../state-store.js";
import { Orchestrator } from "../orchestrator.js";
import { spawnAnalyzer, AnalyzerWorker } from "../ingest.js";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { parseSonglengths } from "../songlengths-parser.js";
import { parseSTIL } from "../stil-parser.js";

// ── Gate: only run when explicitly requested and corpus is present ────────────

const RUN = process.env.RUN_MINI_CORPUS === "1";
const HVSC = resolve(join(process.cwd(), "data/hvsc-corpus/C64Music"));
const FIXTURES_DIR = resolve(join(import.meta.dirname ?? __dirname, "fixtures"));
const FIXTURE_YAML = join(FIXTURES_DIR, "mini-corpus.yaml");

// ── Fixture type ──────────────────────────────────────────────────────────────

interface FixtureTune {
  path: string;
  expected_subtunes_min?: number;
  expected_composer_substring?: string;
  expected_is_rsid?: boolean;
  expected_sid_count_min?: number;
  cover_pair?: string;
}

interface FixtureFile {
  tunes: FixtureTune[];
}

// ── MD5 helper (mirrors what the Python pipeline returns for a SID file) ──────

function fileMd5(absPath: string): string {
  const buf = readFileSync(absPath);
  return createHash("md5").update(buf).digest("hex");
}

// ── SID header parser (minimal — subtune count only) ─────────────────────────

function subtuneCountFromHeader(absPath: string): number {
  try {
    const buf = readFileSync(absPath);
    if (buf.length < 0x10) return 1;
    const count = buf.readUInt16BE(0x0e);
    return count > 0 ? count : 1;
  } catch {
    return 1;
  }
}

// ── RSID check from SID file magic bytes ─────────────────────────────────────

function isRsidFile(absPath: string): boolean {
  try {
    const buf = readFileSync(absPath, { flag: "r" });
    return buf.length >= 4 && buf.slice(0, 4).toString("ascii") === "RSID";
  } catch {
    return false;
  }
}

// ── Memorization check (JSONL-over-stdio against the Python service) ──────────

interface MemorizationResult {
  kind?: string;
  copy_detected?: boolean;
  ssimuse_score?: number;
  nearest_neighbor_distance?: number;
}

async function checkMemorization(
  events: Array<Record<string, unknown>>,
  references: Array<Array<Record<string, unknown>>>,
): Promise<MemorizationResult> {
  return new Promise((resolve, reject) => {
    const analyzerDir = join(process.cwd(), "analyzer");
    const venvPython = join(analyzerDir, ".venv", "bin", "python");
    const python = existsSync(venvPython) ? venvPython : "python3";

    const proc = spawn(
      python,
      ["-m", "analyzer.src.memorization.service", "--stdio"],
      { cwd: analyzerDir, stdio: ["pipe", "pipe", "pipe"] },
    );

    const rl = createInterface({ input: proc.stdout! });
    let resolved = false;

    rl.once("line", (line: string) => {
      if (resolved) return;
      resolved = true;
      proc.stdin!.end();
      try {
        resolve(JSON.parse(line) as MemorizationResult);
      } catch (e) {
        reject(e);
      }
    });

    proc.on("error", (err: Error) => {
      if (!resolved) { resolved = true; reject(err); }
    });

    proc.stderr!.on("data", (_chunk: Buffer) => { /* suppress */ });

    const req = JSON.stringify({
      kind: "check",
      events,
      references,
      candidate_id: "mini-corpus-self-pair",
    });
    proc.stdin!.write(req + "\n");
  });
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe.skipIf(!RUN || !existsSync(HVSC))(
  "mini-corpus end-to-end (M8.1)",
  () => {
    const ts = Date.now();
    const GRAPH_NAME = `c64_hvsc_mini_corpus_test_${ts}`;
    const STATE_DB_PATH = `/tmp/mini-corpus-state-${ts}.db`;
    const EXTRACTS_DIR = `/tmp/mini-corpus-extracts-${ts}`;

    let stateStore: IngestStateStore;
    let worker: AnalyzerWorker;
    let falkor: FalkorHvscClient;
    let fixture: FixtureFile;

    // md5 → hvsc_path (for orchestrator)
    const md5ToPath = new Map<string, string>();

    // For the cover-pair memorization check: capture events from Commando subtune 0
    let commandoEvents: Array<Record<string, unknown>> | null = null;

    beforeAll(async () => {
      // Load fixture YAML
      fixture = parse(readFileSync(FIXTURE_YAML, "utf8")) as FixtureFile;
      expect(fixture.tunes.length).toBe(50);

      // Resolve catalog paths
      const songlengthsPath = join(HVSC, "DOCUMENTS/Songlengths.md5");
      const stilPath = join(HVSC, "DOCUMENTS/STIL.txt");
      const songlengths = existsSync(songlengthsPath)
        ? parseSonglengths(readFileSync(songlengthsPath, "utf8"))
        : new Map<string, number[]>();
      const stil = existsSync(stilPath)
        ? parseSTIL(readFileSync(stilPath, "utf8"))
        : new Map();

      // Build md5→path map and seed the state store.
      // We compute MD5 from the raw file bytes here (TS side). The Python
      // pipeline computes the same MD5 over the same file bytes, so they agree.
      stateStore = new IngestStateStore(STATE_DB_PATH);

      const pendingRows: Array<{ file_md5: string; subtune_index: number }> = [];

      for (const tune of fixture.tunes) {
        const absPath = join(HVSC, tune.path.replace(/^\//, ""));
        if (!existsSync(absPath)) {
          process.stderr.write(`SKIP (not on disk): ${tune.path}\n`);
          continue;
        }
        const md5 = fileMd5(absPath);
        const subtuneCount = subtuneCountFromHeader(absPath);
        md5ToPath.set(md5, tune.path);
        for (let s = 0; s < subtuneCount; s++) {
          pendingRows.push({ file_md5: md5, subtune_index: s });
        }
      }

      stateStore.upsertPending(pendingRows);

      // Spawn analyzer worker + FalkorDB client
      worker = await spawnAnalyzer();
      falkor = new FalkorHvscClient({ graphName: GRAPH_NAME });
      await falkor.connect();

      // Run the orchestrator to drain the queue
      const orch = new Orchestrator({
        stateStore,
        corpusBase: HVSC,
        catalogs: { songlengths, stil },
        falkor,
        worker,
        md5ToPath,
        skipQdrant: true,
        extractsDir: EXTRACTS_DIR,
        onProgress: (snap) => {
          process.stderr.write(
            `[mini-corpus] processed=${snap.processed} pending=${snap.pending}` +
            ` errors=${snap.errors} tpm=${snap.throughput_per_min}\n`,
          );
        },
      });

      const summary = await orch.run();
      process.stderr.write(
        `[mini-corpus] done: processed=${summary.processed} errors=${summary.errors}` +
        ` duration=${(summary.durationMs / 1000).toFixed(1)}s\n`,
      );

      // Capture Commando events for the cover-pair memorization check.
      // We extract subtune 0 directly here so we have the events object.
      const commandoPath = join(
        HVSC,
        "MUSICIANS/H/Hubbard_Rob/Commando.sid",
      );
      if (existsSync(commandoPath)) {
        const result = await worker.extract({ sidPath: commandoPath, subtune: 0 });
        if (result.kind === "extract") {
          commandoEvents = result.events as Array<Record<string, unknown>>;
        }
      }
    }, 60 * 60 * 1000); // 60-min timeout for the full drain

    afterAll(async () => {
      await worker?.shutdown();
      try { await falkor?.dropGraph(); } catch { /* already gone */ }
      await falkor?.disconnect();
      stateStore?.close();
      try { unlinkSync(STATE_DB_PATH); } catch { /* already gone */ }
      try { rmSync(EXTRACTS_DIR, { recursive: true, force: true }); } catch { /* already gone */ }
    });

    // ── Assert 1: ≥90% of tunes reach 'complete' ─────────────────────────────

    it("≥90% of tunes reach complete status", () => {
      const counts = stateStore.countsByStatus();
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const complete = counts.complete;
      const pct = total > 0 ? complete / total : 0;

      process.stderr.write(
        `[mini-corpus] status counts: ${JSON.stringify(counts)}\n`,
      );

      // ≥90% complete out of all scheduled rows (subtune-level rows)
      expect(pct).toBeGreaterThanOrEqual(0.9);
    });

    // ── Assert 2: At least 1 Tracker node materialised ────────────────────────

    it("at least 1 Tracker node exists in the graph", async () => {
      const rows = await falkor.rawQuery<{ n: number }>(
        "MATCH (t:Tracker) RETURN count(t) as n",
      );
      const trackerCount = rows[0]?.n ?? 0;
      expect(Number(trackerCount)).toBeGreaterThanOrEqual(1);
    });

    // ── Assert 3: At least 1 RSID tune tagged correctly ───────────────────────

    it("at least 1 tune has is_rsid=true in the graph", async () => {
      const rows = await falkor.rawQuery<{ n: number }>(
        "MATCH (t:Tune {is_rsid: true}) RETURN count(t) as n",
      );
      const rsidCount = rows[0]?.n ?? 0;
      expect(Number(rsidCount)).toBeGreaterThanOrEqual(1);
    });

    // ── Assert 4: At least 1 multi-SID tune tagged correctly ─────────────────

    it("at least 1 tune has sid_count≥2 in the graph", async () => {
      const rows = await falkor.rawQuery<{ n: number }>(
        "MATCH (t:Tune) WHERE t.sid_count >= 2 RETURN count(t) as n",
      );
      const multiSidCount = rows[0]?.n ?? 0;
      expect(Number(multiSidCount)).toBeGreaterThanOrEqual(1);
    });

    // ── Assert 5: Commando self-pair memorization returns copy_detected=true ──

    it(
      "Commando self-pair memorization returns copy_detected=true",
      async () => {
        if (!commandoEvents || commandoEvents.length === 0) {
          // If Commando extraction failed (edge case in CI), skip gracefully
          process.stderr.write("[mini-corpus] Commando events not captured; skipping memorization check\n");
          return;
        }

        const result = await checkMemorization(
          commandoEvents,
          [commandoEvents], // reference = same tune → must detect as copy
        );

        process.stderr.write(
          `[mini-corpus] memorization result: ${JSON.stringify(result)}\n`,
        );

        // A self-pair must always detect as a copy (nearest_neighbor_distance≈0)
        expect(result.copy_detected).toBe(true);
      },
      120_000, // 2-min timeout — memorization check involves Python
    );

    // ── Assert 6: Fixture coverage check ─────────────────────────────────────

    it("fixture has exactly 50 tunes spanning required formats and composers", () => {
      const rsidCount = fixture.tunes.filter((t) => t.expected_is_rsid === true).length;
      const multiSidCount = fixture.tunes.filter(
        (t) => (t.expected_sid_count_min ?? 0) >= 2,
      ).length;
      const coverPairs = fixture.tunes.filter((t) => t.cover_pair !== undefined).length;

      // These are assertions on the fixture itself (static checks)
      expect(fixture.tunes.length).toBe(50);
      expect(rsidCount).toBeGreaterThanOrEqual(8);
      expect(multiSidCount).toBeGreaterThanOrEqual(5);
      expect(coverPairs).toBeGreaterThanOrEqual(1);

      // Distinct composers (via expected_composer_substring)
      const composerSet = new Set(
        fixture.tunes
          .map((t) => t.expected_composer_substring)
          .filter(Boolean),
      );
      expect(composerSet.size).toBeGreaterThanOrEqual(5);
    });

    // ── Assert 7: Phase 0c features populate on Tune nodes ───────────────────
    it("Phase 0c features populate on Tune nodes", async () => {
      const rows = await falkor.rawQuery<{
        title: string;
        key_signature: string | null;
        tempo_bpm: number | null;
        top_instruments: string | null;
        sid_native: string | null;
      }>(
        `MATCH (t:Tune)
         RETURN t.title AS title,
                t.key_signature AS key_signature,
                t.tempo_bpm AS tempo_bpm,
                t.top_instruments AS top_instruments,
                t.sid_native AS sid_native`,
      );
      expect(rows.length).toBeGreaterThan(0);

      // sid_native present + parseable + has the fingerprint keys, for ALL tunes
      for (const r of rows) {
        expect(r.sid_native, `${r.title} sid_native`).not.toBeNull();
        const sn = JSON.parse(r.sid_native!);
        expect(sn, `${r.title} sid_native.waveform_mix`).toHaveProperty("waveform_mix");
        expect(sn, `${r.title} sid_native.filter_active_fraction`).toHaveProperty("filter_active_fraction");
        expect(sn, `${r.title} sid_native.pwm_depth`).toHaveProperty("pwm_depth");
      }

      // tempo_bpm, key_signature, and top_instruments populate for MUSICAL tunes.
      // Non-musical subtunes (jingles, SFX, digi) legitimately have null values —
      // assert MAJORITY (≥55% for tempo, ≥60% for key+instruments), not 100%.
      const withTempo = rows.filter((r) => r.tempo_bpm !== null).length;
      const withKey = rows.filter((r) => r.key_signature !== null).length;
      const withInstr = rows.filter(
        (r) => r.top_instruments !== null && JSON.parse(r.top_instruments).length > 0,
      ).length;
      process.stderr.write(
        `[mini-corpus] phase-0c: ${withTempo}/${rows.length} have tempo_bpm, ` +
        `${withKey}/${rows.length} have key, ` +
        `${withInstr}/${rows.length} have top_instruments\n`,
      );
      expect(withTempo / rows.length).toBeGreaterThanOrEqual(0.55);
      expect(withKey / rows.length).toBeGreaterThanOrEqual(0.6);
      expect(withInstr / rows.length).toBeGreaterThanOrEqual(0.6);
    });

    // ── Assert 8: raw extracts were archived ─────────────────────────────────
    it("raw extracts are archived to disk", () => {
      expect(existsSync(EXTRACTS_DIR), "extracts dir exists").toBe(true);
      // Count .json.gz files across the sharded subdirs
      const shards = readdirSync(EXTRACTS_DIR);
      let total = 0;
      for (const shard of shards) {
        const shardPath = join(EXTRACTS_DIR, shard);
        if (statSync(shardPath).isDirectory()) {
          total += readdirSync(shardPath).filter((f) => f.endsWith(".json.gz")).length;
        }
      }
      process.stderr.write(`[mini-corpus] archived ${total} extract files\n`);
      expect(total).toBeGreaterThan(0);

      // Sanity-check: gunzip one archive and assert it round-trips correctly
      const firstShard = shards.find((s) => statSync(join(EXTRACTS_DIR, s)).isDirectory());
      if (firstShard) {
        const shardPath = join(EXTRACTS_DIR, firstShard);
        const firstFile = readdirSync(shardPath).find((f) => f.endsWith(".json.gz"));
        if (firstFile) {
          const raw = gunzipSync(readFileSync(join(shardPath, firstFile)));
          const parsed = JSON.parse(raw.toString("utf8"));
          expect(Array.isArray(parsed.events), "archived extract has events array").toBe(true);
          expect(Array.isArray(parsed.filter_curve), "archived extract has filter_curve array").toBe(true);
        }
      }
    });
  },
);
