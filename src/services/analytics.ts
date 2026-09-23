/**
 * Query analytics and gap detection.
 *
 * Logs every query to SQLite. Tracks zero-result queries as "gaps"
 * in the knowledge base. Provides coverage and trend reporting.
 * Manages episodes and learning candidates for self-improvement.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config.ts";

export interface QueryLogOpts {
  tool: string;
  query: string;
  resultCount: number;
  resultScores?: number[];
  searchMode?: "vector" | "keyword" | "graph" | "hybrid";
  resultSources?: string[];
}

export class AnalyticsService {
  private db: Database.Database;

  constructor(dbPath: string = config.analytics.dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS query_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool TEXT NOT NULL,
        query TEXT NOT NULL,
        result_count INTEGER NOT NULL,
        timestamp TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS gaps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        tool TEXT NOT NULL,
        hit_count INTEGER DEFAULT 1,
        first_seen TEXT DEFAULT (datetime('now')),
        last_seen TEXT DEFAULT (datetime('now')),
        resolved INTEGER DEFAULT 0,
        resolved_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_gaps_query ON gaps(query);
      CREATE INDEX IF NOT EXISTS idx_gaps_resolved ON gaps(resolved);
      CREATE INDEX IF NOT EXISTS idx_query_log_tool ON query_log(tool);

      CREATE TABLE IF NOT EXISTS hydration_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool TEXT NOT NULL,
        doc_path TEXT,
        title TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT,
        ended_at TEXT,
        query_log_ids TEXT,
        resolution TEXT DEFAULT 'open',
        resolution_summary TEXT
      );

      CREATE TABLE IF NOT EXISTS learning_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        evidence TEXT,
        confidence TEXT,
        status TEXT DEFAULT 'proposed',
        source_episodes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        promoted_at TEXT,
        related_apis TEXT,
        promote_manifest TEXT
      );
    `);

    // Upgrade existing query_log with new columns (safe if already present)
    this.addColumnIfMissing("query_log", "result_scores", "TEXT");
    this.addColumnIfMissing("query_log", "search_mode", "TEXT");
    this.addColumnIfMissing("query_log", "result_sources", "TEXT");

    // Upgrade existing gaps with pending_verify column
    this.addColumnIfMissing("gaps", "pending_verify", "INTEGER DEFAULT 0");

    // Upgrade existing gaps with user_reported + notes columns (P7a-1)
    this.addColumnIfMissing("gaps", "user_reported", "INTEGER DEFAULT 0");
    this.addColumnIfMissing("gaps", "notes", "TEXT");
  }

  private addColumnIfMissing(table: string, column: string, type: string): void {
    const cols = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }

  // ── Query logging ──────────────────────────────────────────────────

  /**
   * Log a query and track gaps.
   */
  logQuery(opts: QueryLogOpts): void {
    const {
      tool,
      query,
      resultCount,
      resultScores,
      searchMode,
      resultSources,
    } = opts;

    this.db
      .prepare(
        `INSERT INTO query_log (tool, query, result_count, result_scores, search_mode, result_sources)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        tool,
        query,
        resultCount,
        resultScores ? JSON.stringify(resultScores) : null,
        searchMode ?? null,
        resultSources ? JSON.stringify(resultSources) : null
      );

    if (resultCount === 0) {
      // Upsert into gaps table
      const existing = this.db
        .prepare(
          "SELECT id FROM gaps WHERE query = ? AND tool = ? AND resolved = 0"
        )
        .get(query, tool) as { id: number } | undefined;

      if (existing) {
        this.db
          .prepare(
            "UPDATE gaps SET hit_count = hit_count + 1, last_seen = datetime('now') WHERE id = ?"
          )
          .run(existing.id);
      } else {
        this.db
          .prepare("INSERT INTO gaps (query, tool) VALUES (?, ?)")
          .run(query, tool);
      }
    }
  }

  // ── Hydration logging ──────────────────────────────────────────────

  logHydration(
    tool: string,
    docPath: string | null,
    title: string | null
  ): void {
    this.db
      .prepare(
        "INSERT INTO hydration_log (tool, doc_path, title) VALUES (?, ?, ?)"
      )
      .run(tool, docPath, title);
  }

  // ── Gaps ───────────────────────────────────────────────────────────

  /**
   * Mark a gap as resolved (e.g., after ingesting new docs).
   */
  resolveGap(query: string): void {
    this.db
      .prepare(
        "UPDATE gaps SET resolved = 1, resolved_at = datetime('now') WHERE query = ? AND resolved = 0"
      )
      .run(query);
  }

  /**
   * Get unresolved gaps ordered by frequency (most-searched-but-unfound).
   */
  getGaps(
    limit: number = 20
  ): Array<{
    query: string;
    tool: string;
    hit_count: number;
    first_seen: string;
    last_seen: string;
  }> {
    return this.db
      .prepare(
        "SELECT query, tool, hit_count, first_seen, last_seen FROM gaps WHERE resolved = 0 ORDER BY hit_count DESC LIMIT ?"
      )
      .all(limit) as any[];
  }

  /**
   * Return the top N recent gaps (resolved=0) ordered by hit_count then last_seen.
   */
  getRecentGaps(limit: number = 10): Array<{
    query: string;
    tool: string;
    hit_count: number;
    last_seen: string;
    user_reported: number;
    notes: string | null;
  }> {
    return this.db
      .prepare(
        `SELECT query, tool, hit_count, last_seen, user_reported, notes
         FROM gaps
         WHERE resolved = 0
         ORDER BY hit_count DESC, last_seen DESC
         LIMIT ?`
      )
      .all(limit) as any[];
  }

  /**
   * Upsert a gap reported explicitly by an agent or user.
   * Returns the gap row's id and updated hit_count + whether it was new.
   */
  reportGap(query: string, tool: string, notes?: string): {
    gap_id: number;
    hit_count: number;
    status: "new" | "incremented";
  } {
    const existing = this.db
      .prepare(
        "SELECT id, hit_count FROM gaps WHERE query = ? AND tool = ? AND resolved = 0"
      )
      .get(query, tool) as { id: number; hit_count: number } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE gaps
           SET hit_count = hit_count + 1,
               last_seen = datetime('now'),
               user_reported = 1,
               notes = COALESCE(?, notes)
           WHERE id = ?`
        )
        .run(notes ?? null, existing.id);
      return {
        gap_id: existing.id,
        hit_count: existing.hit_count + 1,
        status: "incremented",
      };
    }

    const result = this.db
      .prepare(
        `INSERT INTO gaps (query, tool, user_reported, notes)
         VALUES (?, ?, 1, ?)`
      )
      .run(query, tool, notes ?? null);

    return {
      gap_id: Number(result.lastInsertRowid),
      hit_count: 1,
      status: "new",
    };
  }

  getQueryById(id: number): any | undefined {
    return this.db
      .prepare("SELECT id, tool, query, result_count, timestamp FROM query_log WHERE id = ?")
      .get(id);
  }

  markGapPendingVerify(gapId: number): void {
    this.db
      .prepare("UPDATE gaps SET pending_verify = 1 WHERE id = ?")
      .run(gapId);
  }

  getPendingVerifyGaps(): any[] {
    return this.db
      .prepare(
        "SELECT id, query, tool, hit_count, first_seen, last_seen FROM gaps WHERE resolved = 0 AND pending_verify = 1 ORDER BY last_seen DESC"
      )
      .all() as any[];
  }

  // ── Episodes ───────────────────────────────────────────────────────

  createEpisode(
    startedAt: string,
    endedAt: string,
    queryLogIds: number[],
    resolution: string,
    resolutionSummary?: string
  ): number {
    const result = this.db
      .prepare(
        `INSERT INTO episodes (started_at, ended_at, query_log_ids, resolution, resolution_summary)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        startedAt,
        endedAt,
        JSON.stringify(queryLogIds),
        resolution,
        resolutionSummary ?? null
      );
    return Number(result.lastInsertRowid);
  }

  updateEpisodeResolution(
    id: number,
    resolution: string,
    summary?: string
  ): void {
    this.db
      .prepare(
        "UPDATE episodes SET resolution = ?, resolution_summary = ? WHERE id = ?"
      )
      .run(resolution, summary ?? null, id);
  }

  getEpisodeCount(): number {
    return (
      this.db.prepare("SELECT COUNT(*) as n FROM episodes").get() as any
    ).n;
  }

  // ── Learning candidates ────────────────────────────────────────────

  createCandidate(
    type: string,
    title: string,
    body: string,
    evidence: string,
    confidence: string,
    sourceEpisodes: number[],
    relatedApis: string[]
  ): number {
    const result = this.db
      .prepare(
        `INSERT INTO learning_candidates (type, title, body, evidence, confidence, source_episodes, related_apis)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        type,
        title,
        body,
        evidence,
        confidence,
        JSON.stringify(sourceEpisodes),
        JSON.stringify(relatedApis)
      );
    return Number(result.lastInsertRowid);
  }

  getCandidateById(id: number): any | undefined {
    return this.db
      .prepare("SELECT * FROM learning_candidates WHERE id = ?")
      .get(id);
  }

  updateCandidateStatus(
    id: number,
    status: string,
    promoteManifest?: string
  ): void {
    if (status === "promoted") {
      this.db
        .prepare(
          "UPDATE learning_candidates SET status = ?, promoted_at = datetime('now'), promote_manifest = ? WHERE id = ?"
        )
        .run(status, promoteManifest ?? null, id);
    } else {
      this.db
        .prepare(
          "UPDATE learning_candidates SET status = ?, promote_manifest = ? WHERE id = ?"
        )
        .run(status, promoteManifest ?? null, id);
    }
  }

  getProposedCandidates(): any[] {
    return this.db
      .prepare(
        "SELECT * FROM learning_candidates WHERE status = 'proposed' ORDER BY created_at DESC"
      )
      .all() as any[];
  }

  getPromotedCandidates(): any[] {
    return this.db
      .prepare(
        "SELECT * FROM learning_candidates WHERE status = 'promoted' ORDER BY promoted_at DESC"
      )
      .all() as any[];
  }

  getCandidateCount(): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) as n FROM learning_candidates")
        .get() as any
    ).n;
  }

  // ── Windowed queries for episode detection ─────────────────────────

  getUnprocessedQueryWindows(
    windowMinutes: number
  ): Array<{ queries: any[] }> {
    // Get query_log rows that haven't been assigned to any episode yet.
    // Bucket by time windows.
    const rows = this.db
      .prepare(
        `SELECT ql.* FROM query_log ql
         WHERE ql.id NOT IN (
           SELECT value FROM episodes, json_each(episodes.query_log_ids)
         )
         ORDER BY ql.timestamp ASC`
      )
      .all() as any[];

    if (rows.length === 0) return [];

    const windows: Array<{ queries: any[] }> = [];
    let currentWindow: any[] = [rows[0]];
    for (let i = 1; i < rows.length; i++) {
      const prev = new Date(rows[i - 1].timestamp).getTime();
      const curr = new Date(rows[i].timestamp).getTime();
      const gapMinutes = (curr - prev) / 60000;
      if (gapMinutes > windowMinutes) {
        windows.push({ queries: currentWindow });
        currentWindow = [rows[i]];
      } else {
        currentWindow.push(rows[i]);
      }
    }
    windows.push({ queries: currentWindow });

    return windows;
  }

  getHydrationInWindow(
    start: string,
    end: string
  ): any[] {
    return this.db
      .prepare(
        "SELECT * FROM hydration_log WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC"
      )
      .all(start, end) as any[];
  }

  // ── Stats ──────────────────────────────────────────────────────────

  /**
   * Query volume and success rate stats.
   */
  getQueryStats(): {
    total_queries: number;
    successful_queries: number;
    failed_queries: number;
    success_rate: number;
    unique_queries: number;
    top_tools: Array<{ tool: string; count: number }>;
    top_successful: Array<{ query: string; count: number }>;
    recent_gaps: Array<{ query: string; hit_count: number }>;
  } {
    const total = (
      this.db.prepare("SELECT COUNT(*) as n FROM query_log").get() as any
    ).n;
    const successful = (
      this.db
        .prepare(
          "SELECT COUNT(*) as n FROM query_log WHERE result_count > 0"
        )
        .get() as any
    ).n;
    const unique = (
      this.db
        .prepare("SELECT COUNT(DISTINCT query) as n FROM query_log")
        .get() as any
    ).n;

    const topTools = this.db
      .prepare(
        "SELECT tool, COUNT(*) as count FROM query_log GROUP BY tool ORDER BY count DESC LIMIT 5"
      )
      .all() as any[];

    const topSuccessful = this.db
      .prepare(
        "SELECT query, COUNT(*) as count FROM query_log WHERE result_count > 0 GROUP BY query ORDER BY count DESC LIMIT 10"
      )
      .all() as any[];

    const recentGaps = this.db
      .prepare(
        "SELECT query, hit_count FROM gaps WHERE resolved = 0 ORDER BY last_seen DESC LIMIT 10"
      )
      .all() as any[];

    return {
      total_queries: total,
      successful_queries: successful,
      failed_queries: total - successful,
      success_rate: total > 0 ? Math.round((successful / total) * 100) : 0,
      unique_queries: unique,
      top_tools: topTools,
      top_successful: topSuccessful,
      recent_gaps: recentGaps,
    };
  }

  /**
   * Weekly aggregated stats for history/trend tracking.
   */
  getWeeklyStats(): Array<{
    week: string;
    queries: number;
    gaps: number;
    gaps_resolved: number;
    episodes: number;
    candidates_proposed: number;
    candidates_promoted: number;
  }> {
    return this.db
      .prepare(
        `SELECT
           strftime('%Y-W%W', timestamp) AS week,
           COUNT(*) AS queries,
           SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) AS gaps,
           0 AS gaps_resolved,
           0 AS episodes,
           0 AS candidates_proposed,
           0 AS candidates_promoted
         FROM query_log
         GROUP BY week
         ORDER BY week DESC
         LIMIT 12`
      )
      .all()
      .map((row: any) => {
        const week = row.week as string;
        // Enrich with episode and candidate counts for that week
        const epCount = (
          this.db
            .prepare(
              `SELECT COUNT(*) as n FROM episodes
               WHERE strftime('%Y-W%W', started_at) = ?`
            )
            .get(week) as any
        ).n;

        const proposedCount = (
          this.db
            .prepare(
              `SELECT COUNT(*) as n FROM learning_candidates
               WHERE strftime('%Y-W%W', created_at) = ?`
            )
            .get(week) as any
        ).n;

        const promotedCount = (
          this.db
            .prepare(
              `SELECT COUNT(*) as n FROM learning_candidates
               WHERE status = 'promoted' AND strftime('%Y-W%W', promoted_at) = ?`
            )
            .get(week) as any
        ).n;

        const resolvedCount = (
          this.db
            .prepare(
              `SELECT COUNT(*) as n FROM gaps
               WHERE resolved = 1 AND strftime('%Y-W%W', resolved_at) = ?`
            )
            .get(week) as any
        ).n;

        return {
          week,
          queries: row.queries as number,
          gaps: row.gaps as number,
          gaps_resolved: resolvedCount,
          episodes: epCount,
          candidates_proposed: proposedCount,
          candidates_promoted: promotedCount,
        };
      });
  }

  close() {
    this.db.close();
  }
}
