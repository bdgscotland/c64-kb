/**
 * Canon-ingest CLI: read analyzer/canon.yaml, drive the worker pool to
 * extract every canon tune, hydrate into the c64_hvsc graph.
 *
 * Usage:
 *   npm run ingest:hvsc                  # canon-only (default, idempotent)
 *   npm run ingest:hvsc -- --workers 16  # set the analyzer pool size (default = CPU cores)
 *   npm run ingest:hvsc -- --full        # full orchestrator drain (state-store backed)
 *
 * All modes run a parallel analyzer worker pool (--workers, default = CPU cores). The
 * canon mode parallelizes at tune granularity; --full / --all drain the state
 * store across the pool.
 *
 * Idempotent — re-running on the same canon produces the same graph
 * (MERGE-based writes). Skips tunes whose .sid file is missing from
 * data/hvsc-corpus/ (those rows are reported but don't fail the run).
 *
 * --full mode:
 *   Instantiates an Orchestrator backed by data/hvsc-cache/ingest-state.db.
 *   Promotes any orphaned in_progress rows, then drains all pending rows.
 *   Requires the state store to have been seeded (e.g. by a prior canon-ingest
 *   run using --seed-store, or by the upcoming delta-ingest CLI — M5.4).
 *   For now, --full seeds the state store from canon.yaml then drains it,
 *   making it a functionally equivalent but orchestrator-backed replacement
 *   for the raw loop.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { spawnAnalyzer } from "./hvsc/ingest.js";
import { FalkorHvscClient } from "./services/falkor-hvsc.js";
import { hydrateOneTune } from "./hvsc/hydrate.js";
import { clusterAll } from "./hvsc/cluster-all.js";
import { parseSonglengths } from "./hvsc/songlengths-parser.js";
import { parseSTIL } from "./hvsc/stil-parser.js";
import { HVSC_CORPUS_DIR, HVSC_CACHE_DIR } from "./config.js";
import { IngestStateStore } from "./hvsc/state-store.js";
import { Orchestrator } from "./hvsc/orchestrator.js";

interface CanonTune {
  id: number;
  composer: string;
  title: string;
  year: number;
  hvsc_path: string;
  rank_source?: string;
  test_value?: string;
}

interface Canon {
  version: string;
  total: number;
  tunes: CanonTune[];
}

// ── Shared startup: load canon + catalogs ─────────────────────────────────────

function loadCanon(canonPath: string): Canon {
  if (!existsSync(canonPath)) {
    console.error(`ERROR: ${canonPath} not found`);
    process.exit(1);
  }
  return parse(readFileSync(canonPath, "utf8")) as Canon;
}

function loadCatalogs(corpusBase: string) {
  const songlengthsPath = join(corpusBase, "DOCUMENTS/Songlengths.md5");
  const stilPath = join(corpusBase, "DOCUMENTS/STIL.txt");
  const songlengths = existsSync(songlengthsPath)
    ? parseSonglengths(readFileSync(songlengthsPath, "utf8"))
    : new Map<string, number[]>();
  const stil = existsSync(stilPath)
    ? parseSTIL(readFileSync(stilPath, "utf8"))
    : new Map();
  console.log(`Loaded ${songlengths.size} Songlengths entries, ${stil.size} STIL entries`);
  return { songlengths, stil };
}

// ── Canon-only mode (original loop, preserved verbatim) ───────────────────────

type AnalyzerWorker = Awaited<ReturnType<typeof spawnAnalyzer>>;

async function runCanon(workerCount: number): Promise<void> {
  const canonPath = "analyzer/canon.yaml";
  const canon = loadCanon(canonPath);
  console.log(`Loaded ${canon.tunes.length} canon tunes (${canon.version}) from ${canonPath}`);

  const corpusBase = join(HVSC_CORPUS_DIR, "C64Music");
  if (!existsSync(corpusBase)) {
    console.error(`ERROR: HVSC corpus not at ${corpusBase}. Run scripts/fetch-hvsc.sh first.`);
    process.exit(1);
  }

  const { songlengths, stil } = loadCatalogs(corpusBase);
  console.log(`Spawning ${workerCount} analyzer worker(s)`);
  const workers = await Promise.all(
    Array.from({ length: workerCount }, () => spawnAnalyzer()),
  );
  const falkor = new FalkorHvscClient();
  await falkor.connect();
  const idxCreated = await falkor.ensureIndexes();
  if (idxCreated > 0) console.log(`Seeded ${idxCreated} c64_hvsc range index(es)`);

  let ok = 0;
  let failed = 0;
  let skipped = 0;

  const buildEnrichment = (file_md5: string, hvsc_path: string, subtune: number) => {
    const lengths = songlengths.get(file_md5);
    const stilKey = `${hvsc_path}:${subtune}`;
    const stilEntry = stil.get(stilKey) ?? stil.get(`${hvsc_path}:0`);
    return {
      length_sec: lengths?.[subtune] ?? undefined,
      stil_comment: stilEntry?.comment ?? "",
      stil_credits: stilEntry?.credits ?? [],
      stil_title: stilEntry?.title ?? "",
      stil_name: stilEntry?.name ?? "",
      stil_cover_relations: stilEntry?.cover_relations ?? [],
    };
  };

  // ── Phase 1: probe ─────────────────────────────────────────────────────────
  // Extract+hydrate subtune 0 of each tune (tune-level drain — fast, one quick
  // extract per tune) to discover its file_md5 + subtune_count, then enqueue the
  // remaining subtunes (s >= 1) as independent work units. Subtune 0 is hydrated
  // here so it is never re-extracted.
  interface SubtuneJob {
    tune: CanonTune;
    sidPath: string;
    file_md5: string;
    subtune: number;
  }
  const jobs: SubtuneJob[] = [];

  let probeNext = 0;
  async function probe(worker: AnalyzerWorker): Promise<void> {
    while (true) {
      const i = probeNext++;
      if (i >= canon.tunes.length) break;
      const tune = canon.tunes[i];
      const sidPath = join(corpusBase, tune.hvsc_path.replace(/^\//, ""));
      if (!existsSync(sidPath)) {
        console.warn(`[${tune.id}] SKIP: not on disk - ${tune.hvsc_path}`);
        skipped++;
        continue;
      }
      const result0 = await worker.extract({ sidPath, subtune: 0 });
      if (result0.kind !== "extract") {
        failed++;
        console.log(`[${tune.id}] FAIL sub0: ${result0.error_kind}: ${result0.message.slice(0, 100)}`);
        continue;
      }
      const file_md5 = result0.file_md5;
      await hydrateOneTune(result0, { falkor, skipQdrant: true }, buildEnrichment(file_md5, tune.hvsc_path, 0));
      ok++;
      const subtuneCount: number =
        (result0.meta as Record<string, unknown>).subtune_count as number ?? 1;
      for (let s = 1; s < subtuneCount; s++) {
        jobs.push({ tune, sidPath, file_md5, subtune: s });
      }
      console.log(`[${tune.id}/${canon.tunes.length}] ${tune.composer} - ${tune.title} probed (subtunes: ${subtuneCount})`);
    }
  }
  await Promise.all(workers.map((w) => probe(w)));

  // ── Phase 2: drain ─────────────────────────────────────────────────────────
  // Flat (tune, subtune) work queue drained concurrently by the whole pool. This
  // is the saturation win: a single fat multi-subtune tune no longer pins one
  // worker while the rest idle — every subtune is an independent unit. `jobNext++`
  // is atomic in single-threaded JS (no await between read and increment).
  console.log(`Draining ${jobs.length} remaining subtune(s) across ${workerCount} worker(s)`);
  let jobNext = 0;
  async function drainJobs(worker: AnalyzerWorker): Promise<void> {
    while (true) {
      const i = jobNext++;
      if (i >= jobs.length) break;
      const job = jobs[i];
      const res = await worker.extract({ sidPath: job.sidPath, subtune: job.subtune });
      if (res.kind === "extract") {
        await hydrateOneTune(
          res,
          { falkor, skipQdrant: true },
          buildEnrichment(job.file_md5, job.tune.hvsc_path, job.subtune),
        );
        ok++;
      } else {
        failed++;
        console.error(
          `[${job.tune.id}] subtune ${job.subtune} FAIL: ${res.error_kind}: ${res.message.slice(0, 80)}`,
        );
      }
    }
  }
  await Promise.all(workers.map((w) => drainJobs(w)));

  await Promise.all(workers.map((w) => w.shutdown()));

  // Finalize: corpus-global clustering (families + FAVORS_* edges + multiplex).
  // Must run after ALL per-tune hydration; idempotent. Previously a manual step
  // that was easy to forget → palettes/salience silently went stale. Now part of
  // ingest so "ingest" means "ingest AND cluster".
  console.log("\nClustering (families + FAVORS_* + multiplex)…");
  await clusterAll(falkor, HVSC_CACHE_DIR);
  console.log("Clustering done.");

  await falkor.disconnect();

  console.log(
    `\nDone. ${ok} ok subtunes, ${failed} failed, ${skipped} skipped` +
    ` across ${canon.tunes.length} canon tunes (some have multiple subtunes).`,
  );
  if (failed > 0) process.exit(2);
}

// ── Full mode: orchestrator-backed drain ──────────────────────────────────────
//
// Seeds the state store from canon.yaml (idempotent — upsertPending ignores
// rows that already exist), then drains via Orchestrator.run().
// Equivalent to canon mode functionally; the state store adds crash-resume
// and per-tune retry semantics on top.
//
// The md5→path map is built by extracting subtune 0 of each canon .sid to
// discover its MD5.  This mirrors exactly what the canon loop does, and the
// state store's upsertPending() is idempotent so repeated runs are safe.
// A future delta-ingest CLI (M5.4) will populate the state store from a full
// corpus scan instead of re-extracting to get the MD5.

async function runFull(workerCount: number): Promise<void> {
  const canonPath = "analyzer/canon.yaml";
  const canon = loadCanon(canonPath);
  console.log(
    `[full] Loaded ${canon.tunes.length} canon tunes (${canon.version}) from ${canonPath}`,
  );

  const corpusBase = join(HVSC_CORPUS_DIR, "C64Music");
  if (!existsSync(corpusBase)) {
    console.error(`ERROR: HVSC corpus not at ${corpusBase}. Run scripts/fetch-hvsc.sh first.`);
    process.exit(1);
  }

  const { songlengths, stil } = loadCatalogs(corpusBase);

  const stateDbPath = join(HVSC_CACHE_DIR, "ingest-state.db");
  const stateStore = new IngestStateStore(stateDbPath);
  console.log(`[full] State store: ${stateDbPath}`);

  console.log(`[full] Spawning ${workerCount} analyzer worker(s)`);
  const workers = await Promise.all(
    Array.from({ length: workerCount }, () => spawnAnalyzer()),
  );
  const probe = workers[0];
  const falkor = new FalkorHvscClient();
  await falkor.connect();
  const idxCreated = await falkor.ensureIndexes();
  if (idxCreated > 0) console.log(`Seeded ${idxCreated} c64_hvsc range index(es)`);

  // Build md5→path map by probing each canon .sid for its MD5.
  // We only need subtune 0 to get the file-level MD5.
  // Tunes already in the state store still benefit from this probe because
  // upsertPending() is a no-op for existing rows.
  console.log("[full] Probing canon tunes to discover MD5s and seed state store ...");
  const md5ToPath = new Map<string, string>();
  const pendingRows: Array<{ file_md5: string; subtune_index: number }> = [];
  let skipped = 0;

  for (const tune of canon.tunes) {
    const sidPath = join(corpusBase, tune.hvsc_path.replace(/^\//, ""));
    if (!existsSync(sidPath)) {
      console.warn(`  SKIP (not on disk): ${tune.hvsc_path}`);
      skipped++;
      continue;
    }
    const result0 = await probe.extract({ sidPath, subtune: 0 });
    if (result0.kind !== "extract") {
      console.warn(`  SKIP (extract failed): ${tune.hvsc_path} — ${result0.error_kind}`);
      skipped++;
      continue;
    }
    const { file_md5 } = result0;
    const subtuneCount =
      (result0.meta as Record<string, unknown>).subtune_count as number ?? 1;

    md5ToPath.set(file_md5, tune.hvsc_path);
    for (let s = 0; s < subtuneCount; s++) {
      pendingRows.push({ file_md5, subtune_index: s });
    }
  }

  const seeded = stateStore.upsertPending(pendingRows);
  console.log(
    `[full] Seeded ${seeded} new rows (${pendingRows.length} total across ${md5ToPath.size} tunes, ${skipped} skipped)`,
  );

  // Drain via orchestrator.
  const extractsDir = join(HVSC_CACHE_DIR, "extracts");
  const orch = new Orchestrator({
    stateStore,
    corpusBase,
    catalogs: { songlengths, stil },
    falkor,
    workers,
    md5ToPath,
    skipQdrant: true,
    extractsDir,
    onProgress: (snap) => {
      console.log(
        `[progress] processed=${snap.processed} pending=${snap.pending}` +
        ` errors=${snap.errors} tpm=${snap.throughput_per_min}`,
      );
    },
  });

  const summary = await orch.run();
  await Promise.all(workers.map((w) => w.shutdown()));
  console.log("\nClustering (families + FAVORS_* + multiplex)…");
  await clusterAll(falkor, HVSC_CACHE_DIR);
  console.log("Clustering done.");
  await falkor.disconnect();
  stateStore.close();

  console.log(
    `\n[full] Done. processed=${summary.processed} errors=${summary.errors}` +
    ` duration=${(summary.durationMs / 1000).toFixed(1)}s`,
  );
  if (summary.errors > 0) process.exit(2);
}

// ── --all mode: real full-corpus walk (60k tunes) ────────────────────────────

/** Recursively find every *.sid file under corpusBase. */
function walkSidFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const p = join(dir, name);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) stack.push(p);
      else if (st.isFile() && name.toLowerCase().endsWith(".sid")) out.push(p);
    }
  }
  return out;
}

/** Read PSID/RSID subtune_count from header without invoking vsid. */
function readSubtuneCount(raw: Buffer): number {
  if (raw.length < 16) return 1;
  const magic = raw.subarray(0, 4).toString("ascii");
  if (magic !== "PSID" && magic !== "RSID") return 0;
  return Math.max(1, raw.readUInt16BE(14));
}

async function runAll(workerCount: number): Promise<void> {
  const corpusBase = join(HVSC_CORPUS_DIR, "C64Music");
  if (!existsSync(corpusBase)) {
    console.error(`ERROR: HVSC corpus not at ${corpusBase}`);
    process.exit(1);
  }
  const { songlengths, stil } = loadCatalogs(corpusBase);

  console.log(`[all] Scanning ${corpusBase} for *.sid files ...`);
  const t0 = Date.now();
  const sidPaths = walkSidFiles(corpusBase);
  console.log(`[all] Found ${sidPaths.length} files in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const stateDbPath = join(HVSC_CACHE_DIR, "ingest-state.db");
  const stateStore = new IngestStateStore(stateDbPath);
  console.log(`[all] State store: ${stateDbPath}`);

  console.log(`[all] Computing MD5s + reading PSID headers ...`);
  const t1 = Date.now();
  const md5ToPath = new Map<string, string>();
  const pendingRows: Array<{ file_md5: string; subtune_index: number }> = [];
  let badHeaders = 0;
  for (let i = 0; i < sidPaths.length; i++) {
    const sidPath = sidPaths[i];
    let raw: Buffer;
    try { raw = readFileSync(sidPath); } catch { badHeaders++; continue; }
    const subtune_count = readSubtuneCount(raw);
    if (subtune_count === 0) { badHeaders++; continue; }
    const file_md5 = createHash("md5").update(raw).digest("hex");
    const relPath = "/" + relative(corpusBase, sidPath);
    md5ToPath.set(file_md5, relPath);
    for (let s = 0; s < subtune_count; s++) {
      pendingRows.push({ file_md5, subtune_index: s });
    }
    if ((i + 1) % 5000 === 0) {
      console.log(`  ... ${i + 1}/${sidPaths.length} files scanned`);
    }
  }
  console.log(
    `[all] Scanned ${sidPaths.length} files in ${((Date.now() - t1) / 1000).toFixed(1)}s — ` +
    `${pendingRows.length} subtune rows; ${badHeaders} bad headers`,
  );

  const seeded = stateStore.upsertPending(pendingRows);
  console.log(`[all] Seeded ${seeded} new pending rows (existing rows untouched)`);

  const counts = stateStore.countsByStatus();
  console.log(`[all] State: pending=${counts.pending} complete=${counts.complete} ` +
              `error_perm=${counts.error_permanent} skip=${counts.skip_unsupported_format}`);

  console.log(`[all] Spawning ${workerCount} analyzer worker(s)`);
  const workers = await Promise.all(
    Array.from({ length: workerCount }, () => spawnAnalyzer()),
  );
  const falkor = new FalkorHvscClient();
  await falkor.connect();
  const idxCreated = await falkor.ensureIndexes();
  if (idxCreated > 0) console.log(`Seeded ${idxCreated} c64_hvsc range index(es)`);

  const orch = new Orchestrator({
    stateStore,
    corpusBase,
    catalogs: { songlengths, stil },
    falkor,
    workers,
    md5ToPath,
    skipQdrant: true,
    extractsDir: join(HVSC_CACHE_DIR, "extracts"),
    onProgress: (snap) => {
      console.log(
        `[progress] processed=${snap.processed} pending=${snap.pending} ` +
        `errors=${snap.errors} tpm=${snap.throughput_per_min}`,
      );
    },
  });

  const summary = await orch.run();
  await Promise.all(workers.map((w) => w.shutdown()));
  console.log("\nClustering (families + FAVORS_* + multiplex)…");
  await clusterAll(falkor, HVSC_CACHE_DIR);
  console.log("Clustering done.");
  await falkor.disconnect();
  stateStore.close();

  console.log(
    `\n[all] Done. processed=${summary.processed} errors=${summary.errors} ` +
    `duration=${(summary.durationMs / 1000).toFixed(1)}s`,
  );
  if (summary.errors > 0) process.exit(2);
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

function parseWorkers(args: string[]): number {
  // Default to the machine's logical core count — the analyzer workers are
  // CPU-bound vsid processes, so saturate available parallelism. Override with
  // --workers <N>.
  const def = availableParallelism();
  const i = args.indexOf("--workers");
  const n = i >= 0 ? parseInt(args[i + 1] ?? String(def), 10) : def;
  if (!Number.isFinite(n) || n < 1) {
    console.error("Invalid --workers: must be >= 1");
    process.exit(1);
  }
  return n;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const workers = parseWorkers(args);
  if (args.includes("--all")) {
    await runAll(workers);
  } else if (args.includes("--full")) {
    await runFull(workers);
  } else {
    await runCanon(workers);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
