/** Back-fill melodic direction (SP-direction, layer 4b) from the cached extracts — no re-ingest.
 * Reads HVSC_CACHE_DIR/**.json.gz, picks the lead voice, mines cadence/voice-leading/Q&A
 * (mineDirection) against the tune key, persists Tune direction props + Cadence + ENDS_PHRASE_ON,
 * then aggregates Composer-FAVORS_CADENCE. Mirrors clusterFormInGraph. Idempotent; dedups (md5,sub). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import type { FalkorHvscClient } from "../services/falkor-hvsc.js";
import type { RoleEvent } from "./roles.js";
import { computeVoiceStats } from "./roles.js";
import { pickLeadVoice } from "./grammar-extract.js";
import { mineDirection, tonicPcFromKeyName } from "./mine.js";

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

export async function clusterDirectionInGraph(
  c: FalkorHvscClient, cacheDir: string,
): Promise<{ files: number; set: number }> {
  let files = 0, set = 0;
  const seen = new Set<string>();
  for (const f of walk(cacheDir)) {
    let d: { kind?: string; file_md5?: string; subtune_index?: number; events?: unknown[]; meta?: { key_signature?: string } };
    try { d = JSON.parse(gunzipSync(readFileSync(f)).toString("utf8")); } catch { continue; }
    if (d?.kind !== "extract" || !Array.isArray(d.events) || !d.file_md5) continue;
    const tonicPc = tonicPcFromKeyName(d.meta?.key_signature ?? null);
    if (tonicPc === null) continue;
    const key = `${d.file_md5}:${d.subtune_index ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    files++;
    const events: RoleEvent[] = (d.events as Array<Record<string, unknown>>).map((e) => ({
      frame: e.frame as number, voice: e.voice as number, kind: e.kind as string,
      pitch: e.pitch as number, sid_chip: (e.sid_chip as number) ?? 1, waveform: (e.waveform as string) ?? "",
    }));
    const lead = pickLeadVoice(computeVoiceStats(events));
    if (!lead) continue;
    const leadEvents = events.filter((e) => (e.sid_chip ?? 1) === lead.sidChip && e.voice === lead.voice);
    const dir = mineDirection(leadEvents, tonicPc);
    if (dir.n_phrases === 0) continue;
    await c.upsertDirection(d.file_md5, d.subtune_index ?? 0, dir);
    set++;
  }
  // Composer-FAVORS_CADENCE = bound count(u) over ENDS_PHRASE_ON (not an anonymous path).
  await c.rawWrite(
    `MATCH (comp:Composer)<-[:COMPOSED_BY]-(t:Tune)-[u:ENDS_PHRASE_ON]->(cad:Cadence)
     WITH comp, cad, sum(u.count) AS w
     MERGE (comp)-[r:FAVORS_CADENCE]->(cad)
     SET r.weight = w`,
    {},
  );
  return { files, set };
}
