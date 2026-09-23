/**
 * Every SQL statement AnalyticsService runs, prepared once when the service
 * opens its database. They used to be prepared again on every call. The
 * type arguments give each statement's bind parameters and row shape; they
 * are the column lists of the SELECTs below and the tables in schema.ts.
 */

import type Database from "better-sqlite3";

type Db = Database.Database;
type Count = { n: number };

export interface QueryLogRow {
  id: number;
  tool: string;
  query: string;
  result_count: number;
  timestamp: string;
  result_scores: string | null;
  search_mode: string | null;
  result_sources: string | null;
}

export type QueryLogSummary = Pick<QueryLogRow, "id" | "tool" | "query" | "result_count" | "timestamp">;

export interface HydrationRow {
  id: number;
  tool: string;
  doc_path: string | null;
  title: string | null;
  timestamp: string;
}

export interface CandidateRow {
  id: number;
  type: string;
  title: string;
  body: string;
  evidence: string | null;
  confidence: string | null;
  status: string;
  source_episodes: string | null;
  created_at: string;
  promoted_at: string | null;
  related_apis: string | null;
  promote_manifest: string | null;
}

export interface GapRow {
  id: number;
  query: string;
  tool: string;
  hit_count: number;
  first_seen: string;
  last_seen: string;
  user_reported: number;
  notes: string | null;
}

export interface WeekRow {
  week: string;
  queries: number;
  gaps: number;
}

type Nullable = string | null;

function gapStatements(db: Db) {
  return {
    openGap: db.prepare<[string, string], Pick<GapRow, "id" | "hit_count">>(
      "SELECT id, hit_count FROM gaps WHERE query = ? AND tool = ? AND resolved = 0",
    ),
    bumpGap: db.prepare<[number]>(
      "UPDATE gaps SET hit_count = hit_count + 1, last_seen = datetime('now') WHERE id = ?",
    ),
    insertGap: db.prepare<[string, string]>("INSERT INTO gaps (query, tool) VALUES (?, ?)"),
    bumpReportedGap: db.prepare<[Nullable, number]>(
      `UPDATE gaps
       SET hit_count = hit_count + 1,
           last_seen = datetime('now'),
           user_reported = 1,
           notes = COALESCE(?, notes)
       WHERE id = ?`,
    ),
    insertReportedGap: db.prepare<[string, string, Nullable]>(
      `INSERT INTO gaps (query, tool, user_reported, notes)
       VALUES (?, ?, 1, ?)`,
    ),
    resolveGap: db.prepare<[string]>(
      "UPDATE gaps SET resolved = 1, resolved_at = datetime('now') WHERE query = ? AND resolved = 0",
    ),
    gaps: db.prepare<[number], Pick<GapRow, "query" | "tool" | "hit_count" | "first_seen" | "last_seen">>(
      "SELECT query, tool, hit_count, first_seen, last_seen FROM gaps WHERE resolved = 0 ORDER BY hit_count DESC LIMIT ?",
    ),
    recentGaps: db.prepare<
      [number],
      Pick<GapRow, "query" | "tool" | "hit_count" | "last_seen" | "user_reported" | "notes">
    >(
      `SELECT query, tool, hit_count, last_seen, user_reported, notes
       FROM gaps
       WHERE resolved = 0
       ORDER BY hit_count DESC, last_seen DESC
       LIMIT ?`,
    ),
    markPendingVerify: db.prepare<[number]>("UPDATE gaps SET pending_verify = 1 WHERE id = ?"),
    pendingVerify: db.prepare<[], Omit<GapRow, "user_reported" | "notes">>(
      "SELECT id, query, tool, hit_count, first_seen, last_seen FROM gaps WHERE resolved = 0 AND pending_verify = 1 ORDER BY last_seen DESC",
    ),
  };
}

function logStatements(db: Db) {
  return {
    insertQuery: db.prepare<[string, string, number, Nullable, Nullable, Nullable]>(
      `INSERT INTO query_log (tool, query, result_count, result_scores, search_mode, result_sources)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    insertHydration: db.prepare<[string, Nullable, Nullable]>(
      "INSERT INTO hydration_log (tool, doc_path, title) VALUES (?, ?, ?)",
    ),
    queryById: db.prepare<[number], QueryLogSummary>(
      "SELECT id, tool, query, result_count, timestamp FROM query_log WHERE id = ?",
    ),
    unassignedQueries: db.prepare<[], QueryLogRow>(
      `SELECT ql.* FROM query_log ql
       WHERE ql.id NOT IN (
         SELECT value FROM episodes, json_each(episodes.query_log_ids)
       )
       ORDER BY ql.timestamp ASC`,
    ),
    hydrationBetween: db.prepare<[string, string], HydrationRow>(
      "SELECT * FROM hydration_log WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC",
    ),
  };
}

function learningStatements(db: Db) {
  return {
    insertEpisode: db.prepare<[string, string, string, string, Nullable]>(
      `INSERT INTO episodes (started_at, ended_at, query_log_ids, resolution, resolution_summary)
       VALUES (?, ?, ?, ?, ?)`,
    ),
    resolveEpisode: db.prepare<[string, Nullable, number]>(
      "UPDATE episodes SET resolution = ?, resolution_summary = ? WHERE id = ?",
    ),
    insertCandidate: db.prepare<[string, string, string, string, string, string, string]>(
      `INSERT INTO learning_candidates (type, title, body, evidence, confidence, source_episodes, related_apis)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    candidateById: db.prepare<[number], CandidateRow>("SELECT * FROM learning_candidates WHERE id = ?"),
    promoteCandidate: db.prepare<[string, Nullable, number]>(
      "UPDATE learning_candidates SET status = ?, promoted_at = datetime('now'), promote_manifest = ? WHERE id = ?",
    ),
    setCandidateStatus: db.prepare<[string, Nullable, number]>(
      "UPDATE learning_candidates SET status = ?, promote_manifest = ? WHERE id = ?",
    ),
    proposedCandidates: db.prepare<[], CandidateRow>(
      "SELECT * FROM learning_candidates WHERE status = 'proposed' ORDER BY created_at DESC",
    ),
    promotedCandidates: db.prepare<[], CandidateRow>(
      "SELECT * FROM learning_candidates WHERE status = 'promoted' ORDER BY promoted_at DESC",
    ),
  };
}

function statsStatements(db: Db) {
  return {
    episodeCount: db.prepare<[], Count>("SELECT COUNT(*) as n FROM episodes"),
    candidateCount: db.prepare<[], Count>("SELECT COUNT(*) as n FROM learning_candidates"),
    queryCount: db.prepare<[], Count>("SELECT COUNT(*) as n FROM query_log"),
    successfulCount: db.prepare<[], Count>("SELECT COUNT(*) as n FROM query_log WHERE result_count > 0"),
    uniqueQueryCount: db.prepare<[], Count>("SELECT COUNT(DISTINCT query) as n FROM query_log"),
    topTools: db.prepare<[], { tool: string; count: number }>(
      "SELECT tool, COUNT(*) as count FROM query_log GROUP BY tool ORDER BY count DESC LIMIT 5",
    ),
    topSuccessful: db.prepare<[], { query: string; count: number }>(
      "SELECT query, COUNT(*) as count FROM query_log WHERE result_count > 0 GROUP BY query ORDER BY count DESC LIMIT 10",
    ),
    latestGaps: db.prepare<[], { query: string; hit_count: number }>(
      "SELECT query, hit_count FROM gaps WHERE resolved = 0 ORDER BY last_seen DESC LIMIT 10",
    ),
    weeks: db.prepare<[], WeekRow>(
      `SELECT
         strftime('%Y-W%W', timestamp) AS week,
         COUNT(*) AS queries,
         SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) AS gaps
       FROM query_log
       GROUP BY week
       ORDER BY week DESC
       LIMIT 12`,
    ),
    weekEpisodes: db.prepare<[string], Count>(
      `SELECT COUNT(*) as n FROM episodes
       WHERE strftime('%Y-W%W', started_at) = ?`,
    ),
    weekProposed: db.prepare<[string], Count>(
      `SELECT COUNT(*) as n FROM learning_candidates
       WHERE strftime('%Y-W%W', created_at) = ?`,
    ),
    weekPromoted: db.prepare<[string], Count>(
      `SELECT COUNT(*) as n FROM learning_candidates
       WHERE status = 'promoted' AND strftime('%Y-W%W', promoted_at) = ?`,
    ),
    weekResolved: db.prepare<[string], Count>(
      `SELECT COUNT(*) as n FROM gaps
       WHERE resolved = 1 AND strftime('%Y-W%W', resolved_at) = ?`,
    ),
  };
}

export function prepareStatements(db: Db) {
  return {
    ...gapStatements(db),
    ...logStatements(db),
    ...learningStatements(db),
    ...statsStatements(db),
  };
}

export type Statements = ReturnType<typeof prepareStatements>;

/** A COUNT(*) row's value. COUNT always returns one row; 0 covers a statement that returned none. */
export function count(row: Count | undefined): number {
  return row?.n ?? 0;
}
