/**
 * The analytics database's tables. CREATE ... IF NOT EXISTS, then ALTERs
 * for columns added after the first release, so an old file upgrades in place.
 */

import type Database from "better-sqlite3";

function addColumnIfMissing(db: Database.Database, table: string, column: string, type: string): void {
  const cols = db.prepare<[], { name: string }>(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function initSchema(db: Database.Database): void {
  db.exec(`
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
  addColumnIfMissing(db, "query_log", "result_scores", "TEXT");
  addColumnIfMissing(db, "query_log", "search_mode", "TEXT");
  addColumnIfMissing(db, "query_log", "result_sources", "TEXT");

  // Upgrade existing gaps with pending_verify column
  addColumnIfMissing(db, "gaps", "pending_verify", "INTEGER DEFAULT 0");

  // Upgrade existing gaps with user_reported + notes columns (P7a-1)
  addColumnIfMissing(db, "gaps", "user_reported", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "gaps", "notes", "TEXT");
}
