/**
 * Orchestrator: wraps the IngestStateStore + AnalyzerWorker + hydrate path
 * into a drainable run loop.
 *
 * Responsibilities:
 *   - On startup: promote orphaned in_progress rows back to pending.
 *   - Pull rows from the state store (atomic takeNext()) across N concurrent workers.
 *   - For each row: extract via AnalyzerWorker, classify errors, hydrate.
 *   - Emit progress snapshots every 5 s via onProgress callback.
 *   - Support cancellation via a shared cancelToken object.
 *
 * N-worker model: run() launches one async loop per worker; each loop calls
 * takeNext() independently.  Because takeNext() is atomic, no two workers
 * ever claim the same row.  Node is single-threaded so counter increments
 * are race-free; the true parallelism is N vsid subprocesses running
 * concurrently.  runDelta() is stubbed; full delta logic lands in a follow-up.
 *
 * Error classification:
 *   - TRANSIENT_ERROR_KINDS  → error_transient (retried up to 3 attempts total)
 *   - Everything else        → error_permanent  (one-shot, no retry)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { IngestStateStore, PendingRow } from "./state-store.js";
import type { AnalyzerWorker, TuneExtract } from "./ingest.js";
import type { FalkorHvscClient } from "../services/falkor-hvsc.js";
import type { SonglengthsIndex } from "./songlengths-parser.js";
import type { StilIndex } from "./stil-parser.js";
import { hydrateOneTune, type CatalogEnrichment } from "./hydrate.js";

// ── Error taxonomy ────────────────────────────────────────────────────────────

/** Error kinds that are worth retrying (transient process/timing failures). */
const TRANSIENT_ERROR_KINDS = new Set([
  "vsid_timeout",
  "vsid_crash",
  "vsid_not_found",
  "unknown",
]);

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface OrchestratorOpts {
  stateStore: IngestStateStore;
  /** Absolute path to /path/to/data/hvsc-corpus/C64Music */
  corpusBase: string;
  catalogs: {
    songlengths: SonglengthsIndex;
    stil: StilIndex;
  };
  falkor: FalkorHvscClient;
  /**
   * Pool of analyzer workers driven concurrently.
   * Each worker maps to one async drain loop; rows are distributed via the
   * state store's atomic takeNext() so no row is processed twice.
   * Takes precedence over `worker` when both are supplied.
   */
  workers?: AnalyzerWorker[];
  /**
   * Single analyzer worker — legacy interface kept for backward compatibility.
   * Normalized internally to a 1-element pool.  Prefer `workers` for new callers.
   */
  worker?: AnalyzerWorker;
  /**
   * In-memory MD5 → corpus-relative hvsc_path map.
   * Required because the state store tracks rows by MD5, not path.
   * Callers populate this from their corpus scan or from canon.yaml.
   * Key: lowercase 32-char MD5 hex.
   * Value: hvsc_path as it appears in the HVSC corpus
   *        (e.g. "/MUSICIANS/H/Hubbard_Rob/Commando.sid").
   */
  md5ToPath: Map<string, string>;
  /** Set cancelled=true to request a clean shutdown after the current row. */
  cancelToken?: { cancelled: boolean };
  /** Called every 5 s during a run with the current progress snapshot. */
  onProgress?: (progress: ProgressSnapshot) => void;
  /** Skip Qdrant writes (default: true for now — Qdrant hydration is a stub). */
  skipQdrant?: boolean;
  /**
   * If set, each successful extract is archived as gzipped JSON to
   * <extractsDir>/<md5[:2]>/<md5>.<subtune>.json.gz before hydration.
   * Makes vsid emulation a one-time cost — future features re-derive
   * from the archive instead of re-running the analyzer.  When omitted,
   * archival is skipped (backward-compatible with existing callers/tests).
   */
  extractsDir?: string;
}

export interface ProgressSnapshot {
  processed: number;
  pending: number;
  errors: number;
  /** Completed tunes per minute since the run started. */
  throughput_per_min: number;
}

export interface RunSummary {
  processed: number;
  errors: number;
  durationMs: number;
}

export interface DeltaPlan {
  newCount: number;
  changedCount: number;
  deletedCount: number;
  movedCount: number;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export class Orchestrator {
  private readonly stateStore: IngestStateStore;
  private readonly workers: AnalyzerWorker[];
  private readonly falkor: FalkorHvscClient;
  private readonly catalogs: OrchestratorOpts["catalogs"];
  private readonly md5ToPath: Map<string, string>;
  private readonly corpusBase: string;
  private readonly cancelToken: { cancelled: boolean };
  private readonly onProgress?: (progress: ProgressSnapshot) => void;
  private readonly skipQdrant: boolean;
  private readonly extractsDir?: string;

  constructor(private opts: OrchestratorOpts) {
    this.stateStore = opts.stateStore;
    // Normalize single worker / worker pool → always an array.
    this.workers = opts.workers ?? (opts.worker ? [opts.worker] : []);
    if (this.workers.length === 0) {
      throw new Error("Orchestrator requires at least one worker (supply worker or workers)");
    }
    this.falkor = opts.falkor;
    this.catalogs = opts.catalogs;
    this.md5ToPath = opts.md5ToPath;
    this.corpusBase = opts.corpusBase;
    this.cancelToken = opts.cancelToken ?? { cancelled: false };
    this.onProgress = opts.onProgress;
    this.skipQdrant = opts.skipQdrant ?? true;
    this.extractsDir = opts.extractsDir;
  }

  /**
   * Drain the pending queue until empty or cancel is requested.
   *
   * Steps:
   *   1. promoteOrphans() — recover any in_progress rows from a prior crash.
   *   2. Loop: takeNext() → processOne() → record result.
   *   3. Emit progress every 5 s via the onProgress callback (if provided).
   */
  async run(): Promise<RunSummary> {
    const startTime = Date.now();
    let processed = 0;
    let errors = 0;

    // Recover orphans left by any prior crash.
    const orphanCount = this.stateStore.promoteOrphans();
    if (orphanCount > 0) {
      process.stderr.write(
        JSON.stringify({ event: "orphans_promoted", count: orphanCount }) + "\n",
      );
    }

    // Progress timer — only installed when a callback is provided.
    let progressTimer: NodeJS.Timeout | null = null;
    if (this.onProgress) {
      progressTimer = setInterval(() => {
        this.emitProgress(processed, errors, startTime);
      }, 5000);
    }

    try {
      // Launch one drain loop per worker; each pulls rows via atomic takeNext().
      await Promise.all(
        this.workers.map(async (worker) => {
          while (!this.cancelToken.cancelled) {
            const row = this.stateStore.takeNext();
            if (!row) break; // Queue exhausted for this worker.

            const result = await this.processOne(row, worker);
            if (result.ok) {
              processed++;
            } else {
              errors++;
            }
          }
        }),
      );
    } finally {
      if (progressTimer !== null) clearInterval(progressTimer);
    }

    // Emit a final progress snapshot.
    this.emitProgress(processed, errors, startTime);

    return { processed, errors, durationMs: Date.now() - startTime };
  }

  /**
   * Stub for delta-ingest mode.
   * Full implementation: corpus walk → MD5 snapshot → diff → enqueue delta.
   */
  async runDelta(): Promise<DeltaPlan> {
    throw new Error(
      "delta-ingest implementation pending — corpus scan + Update_XX.hvs reclassification",
    );
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async processOne(row: PendingRow, worker: AnalyzerWorker): Promise<{ ok: boolean }> {
    // Resolve the HVSC path from the MD5 map.
    const hvscPath = this.md5ToPath.get(row.file_md5);
    if (!hvscPath) {
      this.stateStore.recordError(row.file_md5, row.subtune_index, "path_missing", false);
      return { ok: false };
    }

    // Build the absolute file system path.
    const sidPath = hvscPath.startsWith("/")
      ? `${this.corpusBase}${hvscPath}`
      : `${this.corpusBase}/${hvscPath}`;

    try {
      const result = await worker.extract({
        sidPath,
        subtune: row.subtune_index,
      });

      if (result.kind === "error") {
        const transient = TRANSIENT_ERROR_KINDS.has(result.error_kind);
        this.stateStore.recordError(
          row.file_md5,
          row.subtune_index,
          result.error_kind,
          transient,
        );
        return { ok: false };
      }

      // Override the analyzer-set absolute path with the corpus-relative path
      // we already know.  The Python extractors don't know the corpus base
      // and emit str(sid_path); we authoritatively set it here.
      result.meta.hvsc_path = hvscPath;

      // Archive the full extract so emulation is a one-time cost (T17).
      this.archiveExtract(result);

      // Build catalog enrichment from Songlengths + STIL.
      const enrichment = this.buildEnrichment(result, hvscPath);

      await hydrateOneTune(
        result,
        { falkor: this.falkor, skipQdrant: this.skipQdrant },
        enrichment,
      );

      this.stateStore.recordComplete(
        row.file_md5,
        row.subtune_index,
        result.pipeline_version,
      );
      return { ok: true };
    } catch (e) {
      // Unexpected JS-level exception — classify as transient (unknown cause).
      const kind =
        e instanceof Error ? e.constructor.name : "unknown";
      this.stateStore.recordError(row.file_md5, row.subtune_index, kind, true);
      return { ok: false };
    }
  }

  /**
   * Build CatalogEnrichment for a successfully extracted tune.
   *
   * Songlengths lookup: by file_md5, then index by subtune_index.
   * STIL lookup: by "<hvsc_path>:<subtune_index>", falling back to ":0" (file-level entry).
   */
  private buildEnrichment(result: TuneExtract, hvscPath: string): CatalogEnrichment {
    const { file_md5, subtune_index } = result;

    // Songlengths: Map<md5, length_sec[]>
    const lengths = this.catalogs.songlengths.get(file_md5);
    const length_sec = lengths?.[subtune_index];

    // STIL: keyed by "<hvsc_path>:<subtune_index>" (0-indexed)
    const stilKey = `${hvscPath}:${subtune_index}`;
    const stilFallbackKey = `${hvscPath}:0`;
    const stilEntry =
      this.catalogs.stil.get(stilKey) ?? this.catalogs.stil.get(stilFallbackKey);

    return {
      length_sec,
      stil_comment: stilEntry?.comment ?? "",
      stil_credits: stilEntry?.credits ?? [],
      stil_title: stilEntry?.title ?? "",
      stil_name: stilEntry?.name ?? "",
      stil_cover_relations: stilEntry?.cover_relations ?? [],
    };
  }

  /** Archive the full TuneExtract as gzipped JSON (best-effort, never throws). */
  private archiveExtract(result: TuneExtract): void {
    if (!this.extractsDir) return;
    try {
      const shard = result.file_md5.slice(0, 2);
      const dir = join(this.extractsDir, shard);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${result.file_md5}.${result.subtune_index}.json.gz`);
      const gz = gzipSync(Buffer.from(JSON.stringify(result), "utf8"));
      writeFileSync(file, gz);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(
        JSON.stringify({
          event: "archive_failed",
          file_md5: result.file_md5,
          subtune_index: result.subtune_index,
          error: msg,
        }) + "\n",
      );
    }
  }

  private emitProgress(
    processed: number,
    errors: number,
    startTime: number,
  ): void {
    const elapsedMs = Date.now() - startTime;
    const throughput_per_min =
      elapsedMs > 0 ? (processed / elapsedMs) * 60_000 : 0;

    // Snapshot pending count from the state store.
    const counts = this.stateStore.countsByStatus();
    const pending = counts.pending;

    const snapshot: ProgressSnapshot = {
      processed,
      pending,
      errors,
      throughput_per_min: Math.round(throughput_per_min * 10) / 10,
    };

    // Always write to stderr as JSON for machine-readable consumption.
    process.stderr.write(JSON.stringify({ event: "progress", ...snapshot }) + "\n");

    // Invoke the optional callback for the caller (e.g. CLI progress bar).
    this.onProgress?.(snapshot);
  }
}
