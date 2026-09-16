/** Back-fill Tune grammar (SP-grammar, layer 4) from the cached extracts — no
 * re-ingest. Reads HVSC_CACHE_DIR/**.json.gz, mines the lead-voice grammar, and
 * SETs the grammar_* props on each matching Tune. Mirrors clusterMultiplexInGraph.
 * Idempotent (SET overwrites); dedups (md5, subtune) so duplicate cache shards
 * (big-extracts + patch-verify-extracts) don't double-process. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import type { FalkorHvscClient } from "../services/falkor-hvsc.js";
import type { RoleEvent } from "./roles.js";
import { extractGrammarProps, persistTuneGrammar } from "./grammar-extract.js";

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".json.gz")) out.push(p);
  }
  return out;
}

export async function clusterGrammarInGraph(
  c: FalkorHvscClient, cacheDir: string,
): Promise<{ files: number; set: number }> {
  let files = 0, set = 0;
  const seen = new Set<string>();
  for (const f of walk(cacheDir)) {
    let d: { kind?: string; file_md5?: string; subtune_index?: number; events?: unknown[] };
    try { d = JSON.parse(gunzipSync(readFileSync(f)).toString("utf8")); } catch { continue; }
    if (d?.kind !== "extract" || !Array.isArray(d.events) || !d.file_md5) continue;
    const key = `${d.file_md5}:${d.subtune_index ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    files++;
    const events: RoleEvent[] = (d.events as Array<Record<string, unknown>>).map((e) => ({
      frame: e.frame as number, voice: e.voice as number, kind: e.kind as string,
      pitch: e.pitch as number, sid_chip: (e.sid_chip as number) ?? 1, waveform: (e.waveform as string) ?? "",
    }));
    const grammar = extractGrammarProps(events);
    if (!grammar) continue;
    await persistTuneGrammar(c, d.file_md5, d.subtune_index ?? 0, grammar);
    set++;
  }
  return { files, set };
}
