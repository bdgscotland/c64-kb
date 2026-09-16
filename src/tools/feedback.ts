/** Generation feedback store (2026-05-21): the substrate that stops verdicts from
 * evaporating. Every generated candidate + the human's verdict is appended here so
 * it can later train a learned critic and condition the composer on what worked.
 * Append-only JSONL — inspectable, crash-safe, no schema migration. */
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_FEEDBACK_DB = "./data/generation-feedback.jsonl";

export interface FeedbackRecord {
  id: string;
  ts: string;                     // ISO timestamp
  composer: string;
  /** how it was generated */
  method: "ai" | "deterministic" | "deterministic-salient" | "ablation";
  ablation?: string;              // for method "ablation": scramble_palette | no_timbre | generic_phrases
  seed?: number;
  title: string;
  metrics?: {
    consonance_pct?: number;
    in_style_pct?: number;
    drum_density?: number;
    stutter_score?: number;
  };
  verdict?: string;               // human label: e.g. "best-yet", "decent", "not good", "not really X"
  notes?: string;
}

/** Append one feedback record as a JSON line (creates the dir/file if needed). */
export function appendFeedback(rec: FeedbackRecord, dbPath: string = DEFAULT_FEEDBACK_DB): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  appendFileSync(dbPath, JSON.stringify(rec) + "\n");
}

/** Load all feedback records. Missing file → []. Blank/corrupt lines are skipped. */
export function loadFeedback(dbPath: string = DEFAULT_FEEDBACK_DB): FeedbackRecord[] {
  if (!existsSync(dbPath)) return [];
  const out: FeedbackRecord[] = [];
  for (const line of readFileSync(dbPath, "utf8").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s) as FeedbackRecord); } catch { /* skip partial/corrupt line */ }
  }
  return out;
}

// CLI: npm run feedback:log -- --composer "Rob Hubbard" --method ai --title "X" --verdict "decent" [--notes ..] [--seed N] [--ablation A]
//      npm run feedback:log -- --list
async function main(): Promise<void> {
  const { randomUUID } = await import("node:crypto");
  const argv = process.argv;
  const get = (n: string): string | undefined => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined; };
  if (argv.includes("--list")) {
    const rows = loadFeedback();
    for (const r of rows) console.log(`${r.ts}  ${r.method.padEnd(20)} ${r.composer.padEnd(16)} ${(r.verdict ?? "").padEnd(28)} ${r.title}`);
    console.log(`\n${rows.length} records in ${DEFAULT_FEEDBACK_DB}`);
    return;
  }
  const rec: FeedbackRecord = {
    id: get("id") ?? randomUUID().slice(0, 8), ts: new Date().toISOString(),
    composer: get("composer") ?? "", method: (get("method") ?? "ai") as FeedbackRecord["method"],
    title: get("title") ?? "", verdict: get("verdict"), notes: get("notes"),
    seed: get("seed") ? Number(get("seed")) : undefined, ablation: get("ablation"),
  };
  appendFeedback(rec);
  console.log(`logged ${rec.id} (${rec.composer} / ${rec.method} / "${rec.verdict ?? ""}")`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
