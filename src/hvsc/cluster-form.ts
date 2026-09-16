/** Back-fill form-as-dynamics (SP-form, layer 5) from the cached extracts — no re-ingest.
 * Reads HVSC_CACHE_DIR/**.json.gz, mines per-section energy + the arc (mineForm), persists
 * Section energy props + ArcShape + Tune-HAS_ARC, then aggregates Composer-FAVORS_ARC.
 * Mirrors clusterGrammarInGraph + the FAVORS_HOOK aggregation. Idempotent; dedups (md5,sub). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import type { FalkorHvscClient } from "../services/falkor-hvsc.js";
import type { RoleEvent } from "./roles.js";
import { mineForm } from "./mine.js";

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

export async function clusterFormInGraph(
  c: FalkorHvscClient, cacheDir: string,
): Promise<{ files: number; set: number }> {
  let files = 0, set = 0;
  const seen = new Set<string>();
  for (const f of walk(cacheDir)) {
    let d: {
      kind?: string; file_md5?: string; subtune_index?: number; events?: unknown[];
      structure?: { sections?: Array<{ start_frame: number; end_frame: number }> };
    };
    try { d = JSON.parse(gunzipSync(readFileSync(f)).toString("utf8")); } catch { continue; }
    if (d?.kind !== "extract" || !Array.isArray(d.events) || !d.file_md5) continue;
    const secs = d.structure?.sections ?? [];
    if (secs.length === 0) continue;
    const key = `${d.file_md5}:${d.subtune_index ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    files++;
    const events: RoleEvent[] = (d.events as Array<Record<string, unknown>>).map((e) => ({
      frame: e.frame as number, voice: e.voice as number, kind: e.kind as string,
      pitch: e.pitch as number, sid_chip: (e.sid_chip as number) ?? 1, waveform: (e.waveform as string) ?? "",
    }));
    const sections = secs.map((s, i) => ({ order: i, start_frame: s.start_frame, end_frame: s.end_frame }));
    const form = mineForm(events, sections);
    await c.upsertForm(d.file_md5, d.subtune_index ?? 0, form);
    set++;
  }
  // Composer-FAVORS_ARC = bound count(u) over HAS_ARC (not an anonymous path → no flatten-to-1).
  await c.rawWrite(
    `MATCH (comp:Composer)<-[:COMPOSED_BY]-(t:Tune)-[u:HAS_ARC]->(a:ArcShape)
     WITH comp, a, count(u) AS w
     MERGE (comp)-[r:FAVORS_ARC]->(a)
     SET r.weight = w`,
    {},
  );
  return { files, set };
}
