/**
 * Query analytics and gap detection.
 *
 * Logs every query to SQLite. Tracks zero-result queries as "gaps"
 * in the knowledge base. Provides coverage and trend reporting.
 * Manages episodes and learning candidates for self-improvement.
 *
 * Tables are in analytics/schema.ts; every statement is prepared once, in
 * analytics/statements.ts, when the service opens the file.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config.ts";
import { initSchema } from "./analytics/schema.ts";
import {
  count,
  prepareStatements,
  type CandidateRow,
  type GapRow,
  type HydrationRow,
  type QueryLogRow,
  type QueryLogSummary,
  type Statements,
} from "./analytics/statements.ts";

export type {
  CandidateRow,
  GapRow,
  HydrationRow,
  QueryLogRow,
  QueryLogSummary,
} from "./analytics/statements.ts";

export interface QueryLogOpts {
  tool: string;
  query: string;
  resultCount: number;
  resultScores?: number[] | undefined;
  searchMode?: "vector" | "keyword" | "graph" | "hybrid" | undefined;
  resultSources?: string[] | undefined;
}

export interface GapReport {
  gap_id: number;
  hit_count: number;
  status: "new" | "incremented";
}

export interface EpisodeInput {
  startedAt: string;
  endedAt: string;
  queryLogIds: number[];
  resolution: string;
  resolutionSummary?: string | undefined;
}

export interface CandidateInput {
  type: string;
  title: string;
  body: string;
  evidence: string;
  confidence: string;
  sourceEpisodes: number[];
  relatedApis: string[];
}

export interface QueryStats {
  total_queries: number;
  successful_queries: number;
  failed_queries: number;
  success_rate: number;
  unique_queries: number;
  top_tools: { tool: string; count: number }[];
  top_successful: { query: string; count: number }[];
  recent_gaps: { query: string; hit_count: number }[];
}

export interface WeeklyStats {
  week: string;
  queries: number;
  gaps: number;
  gaps_resolved: number;
  episodes: number;
  candidates_proposed: number;
  candidates_promoted: number;
}

/** Split rows (in timestamp order) wherever consecutive timestamps are more than `windowMinutes` apart. */
function splitByGap(rows: QueryLogRow[], windowMinutes: number): { queries: QueryLogRow[] }[] {
  const windows: { queries: QueryLogRow[] }[] = [];
  let current: QueryLogRow[] = [];
  let prev: number | null = null;
  for (const row of rows) {
    const t = new Date(row.timestamp).getTime();
    if (prev !== null && (t - prev) / 60000 > windowMinutes) {
      windows.push({ queries: current });
      current = [];
    }
    current.push(row);
    prev = t;
  }
  if (current.length > 0) windows.push({ queries: current });
  return windows;
}

export class AnalyticsService {
  private readonly db: Database.Database;
  private readonly s: Statements;
  /** While set, logQuery records result counts here instead of writing (gap replay). */
  private captured: number[] | null = null;

  constructor(dbPath: string = config.analytics.dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    initSchema(this.db);
    this.s = prepareStatements(this.db);
  }

  // ── Query logging ──────────────────────────────────────────────────

  /**
   * Log a query and track gaps.
   */
  logQuery(opts: QueryLogOpts): void {
    if (this.captured) {
      this.captured.push(opts.resultCount);
      return;
    }
    // One IMMEDIATE transaction: the CLI and the MCP server share this file,
    // and a bare SELECT-then-INSERT let two processes both insert the gap.
    this.db
      .transaction(() => {
        this.logQueryUnlocked(opts);
      })
      .immediate();
  }

  private logQueryUnlocked(opts: QueryLogOpts): void {
    const { tool, query, resultCount, resultScores, searchMode, resultSources } = opts;
    this.s.insertQuery.run(
      tool,
      query,
      resultCount,
      resultScores ? JSON.stringify(resultScores) : null,
      searchMode ?? null,
      resultSources ? JSON.stringify(resultSources) : null,
    );
    if (resultCount !== 0) return;
    const existing = this.s.openGap.get(query, tool);
    if (existing) this.s.bumpGap.run(existing.id);
    else this.s.insertGap.run(query, tool);
  }

  // ── Hydration logging ──────────────────────────────────────────────

  logHydration(tool: string, docPath: string | null, title: string | null): void {
    this.s.insertHydration.run(tool, docPath, title);
  }

  // ── Gaps ───────────────────────────────────────────────────────────

  /**
   * Mark a gap as resolved (e.g., after ingesting new docs).
   */
  resolveGap(query: string, tool?: string): void {
    if (tool === undefined) this.s.resolveGap.run(query);
    else this.s.resolveToolGap.run(query, tool);
  }

  /** Every open gap a tool logged (not one an agent reported), by tool then query. */
  getLoggedOpenGaps(): Pick<GapRow, "query" | "tool" | "hit_count">[] {
    return this.s.loggedOpenGaps.all();
  }

  /**
   * Run `fn` without writing to the log and return the result counts it
   * would have logged: replaying a gap must not log it again. One capture
   * at a time; a second concurrent one throws.
   */
  async captureCounts(fn: () => Promise<unknown>): Promise<number[]> {
    if (this.captured) throw new Error("captureCounts: already capturing");
    const counts: number[] = [];
    this.captured = counts;
    try {
      await fn();
    } finally {
      this.captured = null;
    }
    return counts;
  }

  /**
   * Get unresolved gaps ordered by frequency (most-searched-but-unfound).
   */
  getGaps(limit = 20): Pick<GapRow, "query" | "tool" | "hit_count" | "first_seen" | "last_seen">[] {
    return this.s.gaps.all(limit);
  }

  /**
   * Return the top N recent gaps (resolved=0) ordered by hit_count then last_seen.
   */
  getRecentGaps(
    limit = 10,
  ): Pick<GapRow, "query" | "tool" | "hit_count" | "last_seen" | "user_reported" | "notes">[] {
    return this.s.recentGaps.all(limit);
  }

  /**
   * Upsert a gap reported explicitly by an agent or user.
   * Returns the gap row's id and updated hit_count + whether it was new.
   */
  reportGap(query: string, tool: string, notes?: string): GapReport {
    // Same race as logQuery: select-then-write in one IMMEDIATE transaction.
    return this.db.transaction(() => this.reportGapUnlocked(query, tool, notes ?? null)).immediate();
  }

  private reportGapUnlocked(query: string, tool: string, notes: string | null): GapReport {
    const existing = this.s.openGap.get(query, tool);
    if (existing) {
      this.s.bumpReportedGap.run(notes, existing.id);
      return { gap_id: existing.id, hit_count: existing.hit_count + 1, status: "incremented" };
    }
    const result = this.s.insertReportedGap.run(query, tool, notes);
    return { gap_id: Number(result.lastInsertRowid), hit_count: 1, status: "new" };
  }

  getQueryById(id: number): QueryLogSummary | undefined {
    return this.s.queryById.get(id);
  }

  markGapPendingVerify(gapId: number): void {
    this.s.markPendingVerify.run(gapId);
  }

  getPendingVerifyGaps(): Omit<GapRow, "user_reported" | "notes">[] {
    return this.s.pendingVerify.all();
  }

  // ── Episodes ───────────────────────────────────────────────────────

  createEpisode(e: EpisodeInput): number {
    const result = this.s.insertEpisode.run(
      e.startedAt,
      e.endedAt,
      JSON.stringify(e.queryLogIds),
      e.resolution,
      e.resolutionSummary ?? null,
    );
    return Number(result.lastInsertRowid);
  }

  updateEpisodeResolution(id: number, resolution: string, summary?: string): void {
    this.s.resolveEpisode.run(resolution, summary ?? null, id);
  }

  getEpisodeCount(): number {
    return count(this.s.episodeCount.get());
  }

  // ── Learning candidates ────────────────────────────────────────────

  createCandidate(c: CandidateInput): number {
    const result = this.s.insertCandidate.run(
      c.type,
      c.title,
      c.body,
      c.evidence,
      c.confidence,
      JSON.stringify(c.sourceEpisodes),
      JSON.stringify(c.relatedApis),
    );
    return Number(result.lastInsertRowid);
  }

  getCandidateById(id: number): CandidateRow | undefined {
    return this.s.candidateById.get(id);
  }

  updateCandidateStatus(id: number, status: string, promoteManifest?: string): void {
    const stmt = status === "promoted" ? this.s.promoteCandidate : this.s.setCandidateStatus;
    stmt.run(status, promoteManifest ?? null, id);
  }

  getProposedCandidates(): CandidateRow[] {
    return this.s.proposedCandidates.all();
  }

  getPromotedCandidates(): CandidateRow[] {
    return this.s.promotedCandidates.all();
  }

  getCandidateCount(): number {
    return count(this.s.candidateCount.get());
  }

  // ── Windowed queries for episode detection ─────────────────────────

  /** query_log rows not yet assigned to any episode, bucketed by time gaps. */
  getUnprocessedQueryWindows(windowMinutes: number): { queries: QueryLogRow[] }[] {
    return splitByGap(this.s.unassignedQueries.all(), windowMinutes);
  }

  getHydrationInWindow(start: string, end: string): HydrationRow[] {
    return this.s.hydrationBetween.all(start, end);
  }

  // ── Stats ──────────────────────────────────────────────────────────

  /**
   * Query volume and success rate stats.
   */
  getQueryStats(): QueryStats {
    const total = count(this.s.queryCount.get());
    const successful = count(this.s.successfulCount.get());
    return {
      total_queries: total,
      successful_queries: successful,
      failed_queries: total - successful,
      success_rate: total > 0 ? Math.round((successful / total) * 100) : 0,
      unique_queries: count(this.s.uniqueQueryCount.get()),
      top_tools: this.s.topTools.all(),
      top_successful: this.s.topSuccessful.all(),
      recent_gaps: this.s.latestGaps.all(),
    };
  }

  /**
   * Weekly aggregated stats for history/trend tracking.
   */
  getWeeklyStats(): WeeklyStats[] {
    return this.s.weeks.all().map(({ week, queries, gaps }) => ({
      week,
      queries,
      gaps,
      gaps_resolved: count(this.s.weekResolved.get(week)),
      episodes: count(this.s.weekEpisodes.get(week)),
      candidates_proposed: count(this.s.weekProposed.get(week)),
      candidates_promoted: count(this.s.weekPromoted.get(week)),
    }));
  }

  close() {
    this.db.close();
  }
}
