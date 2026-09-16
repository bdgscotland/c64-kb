/**
 * SQLite-backed checkpoint/resume store for the HVSC ingest orchestrator.
 *
 * One row per (file_md5, subtune_index) tracks the lifecycle of a tune:
 *   pending → in_progress → complete | error_transient | error_permanent | skip_unsupported_format
 *
 * Crash recovery: on startup, in_progress rows are promoted back to pending
 * (the worker that owned them is gone, so the work is lost — retry).
 *
 * Atomic claim: takeNext() uses a transaction to read+update a single
 * pending row to in_progress, preventing concurrent workers from picking
 * the same row.
 */
import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

export type IngestStatus =
  | "pending"
  | "in_progress"
  | "complete"
  | "error_transient"
  | "error_permanent"
  | "skip_unsupported_format";

export interface PendingRow {
  file_md5: string;
  subtune_index: number;
}

export interface StatusCounts {
  pending: number;
  in_progress: number;
  complete: number;
  error_transient: number;
  error_permanent: number;
  skip_unsupported_format: number;
}

export interface ErrorKindCount {
  error_kind: string;
  count: number;
}

const MAX_ATTEMPTS = 3;

export class IngestStateStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ingest_state (
        file_md5 TEXT NOT NULL,
        subtune_index INTEGER NOT NULL,
        status TEXT NOT NULL,
        error_kind TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at INTEGER,
        pipeline_version TEXT,
        PRIMARY KEY (file_md5, subtune_index)
      );
      CREATE INDEX IF NOT EXISTS idx_status ON ingest_state(status);
      CREATE INDEX IF NOT EXISTS idx_error_kind ON ingest_state(error_kind);
    `);
  }

  /** Insert rows if not present. Pre-existing rows are untouched. */
  upsertPending(rows: PendingRow[]): number {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO ingest_state (file_md5, subtune_index, status)
       VALUES (?, ?, 'pending')`,
    );
    const insertMany = this.db.transaction((batch: PendingRow[]) => {
      let inserted = 0;
      for (const r of batch) {
        const info = stmt.run(r.file_md5, r.subtune_index);
        inserted += info.changes;
      }
      return inserted;
    });
    return insertMany(rows);
  }

  /** Promote orphaned in_progress rows back to pending (called at startup). */
  promoteOrphans(): number {
    const info = this.db
      .prepare(`UPDATE ingest_state SET status='pending' WHERE status='in_progress'`)
      .run();
    return info.changes;
  }

  /** Atomically claim one pending row, mark it in_progress, return it. */
  takeNext(): PendingRow | null {
    const tx = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT file_md5, subtune_index FROM ingest_state
           WHERE status='pending' LIMIT 1`,
        )
        .get() as PendingRow | undefined;
      if (!row) return null;
      this.db
        .prepare(
          `UPDATE ingest_state
           SET status='in_progress', last_attempt_at=?
           WHERE file_md5=? AND subtune_index=?`,
        )
        .run(Date.now(), row.file_md5, row.subtune_index);
      return row;
    });
    return tx();
  }

  recordComplete(file_md5: string, subtune_index: number, pipeline_version: string): void {
    this.db
      .prepare(
        `UPDATE ingest_state
         SET status='complete', error_kind=NULL,
             attempts=attempts+1, last_attempt_at=?, pipeline_version=?
         WHERE file_md5=? AND subtune_index=?`,
      )
      .run(Date.now(), pipeline_version, file_md5, subtune_index);
  }

  recordError(
    file_md5: string,
    subtune_index: number,
    error_kind: string,
    transient: boolean,
  ): IngestStatus {
    const row = this.db
      .prepare(
        `SELECT attempts FROM ingest_state WHERE file_md5=? AND subtune_index=?`,
      )
      .get(file_md5, subtune_index) as { attempts: number } | undefined;
    const newAttempts = (row?.attempts ?? 0) + 1;
    // Transient errors retry up to MAX_ATTEMPTS, then escalate to permanent.
    const status: IngestStatus =
      transient && newAttempts < MAX_ATTEMPTS ? "error_transient" : "error_permanent";
    // error_transient rows are eligible to be re-queued via requeueByKind.
    this.db
      .prepare(
        `UPDATE ingest_state
         SET status=?, error_kind=?, attempts=?, last_attempt_at=?
         WHERE file_md5=? AND subtune_index=?`,
      )
      .run(status, error_kind, newAttempts, Date.now(), file_md5, subtune_index);
    return status;
  }

  recordSkip(file_md5: string, subtune_index: number, reason: string): void {
    this.db
      .prepare(
        `UPDATE ingest_state
         SET status='skip_unsupported_format', error_kind=?,
             attempts=attempts+1, last_attempt_at=?
         WHERE file_md5=? AND subtune_index=?`,
      )
      .run(reason, Date.now(), file_md5, subtune_index);
  }

  /** Promote error_transient rows of a given kind back to pending. */
  requeueByKind(error_kind: string): number {
    const info = this.db
      .prepare(
        `UPDATE ingest_state
         SET status='pending', error_kind=NULL
         WHERE status='error_transient' AND error_kind=?`,
      )
      .run(error_kind);
    return info.changes;
  }

  countsByStatus(): StatusCounts {
    const rows = this.db
      .prepare(`SELECT status, count(*) as n FROM ingest_state GROUP BY status`)
      .all() as Array<{ status: IngestStatus; n: number }>;
    const out: StatusCounts = {
      pending: 0, in_progress: 0, complete: 0,
      error_transient: 0, error_permanent: 0, skip_unsupported_format: 0,
    };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  topErrorKinds(limit: number): ErrorKindCount[] {
    return this.db
      .prepare(
        `SELECT error_kind, count(*) as count
         FROM ingest_state
         WHERE error_kind IS NOT NULL
         GROUP BY error_kind
         ORDER BY count DESC
         LIMIT ?`,
      )
      .all(limit) as ErrorKindCount[];
  }

  md5sByErrorKind(error_kind: string, limit: number = 100): string[] {
    return this.db
      .prepare(
        `SELECT file_md5 FROM ingest_state
         WHERE error_kind=?
         ORDER BY last_attempt_at DESC
         LIMIT ?`,
      )
      .all(error_kind, limit)
      .map((r) => (r as { file_md5: string }).file_md5);
  }

  /** Count of rows in the table (useful for "is there work to do?" check). */
  totalRows(): number {
    const row = this.db
      .prepare(`SELECT count(*) as n FROM ingest_state`)
      .get() as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}
