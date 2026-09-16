/** Populate VoicePart multiplex fields from the cached extracts (events) — no re-ingest.
 * Reads HVSC_CACHE_DIR/**.json.gz, runs analyzeMultiplex, SETs each matching VoicePart. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import type { FalkorHvscClient } from "../services/falkor-hvsc.js";
import { analyzeMultiplex, type RoleEvent } from "./roles.js";

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

export async function clusterMultiplexInGraph(
  c: FalkorHvscClient, cacheDir: string,
): Promise<{ files: number; set: number }> {
  let files = 0, set = 0;
  for (const f of walk(cacheDir)) {
    let d: { kind?: string; file_md5?: string; subtune_index?: number; events?: unknown[] };
    try { d = JSON.parse(gunzipSync(readFileSync(f)).toString("utf8")); } catch { continue; }
    if (d?.kind !== "extract" || !Array.isArray(d.events) || !d.file_md5) continue;
    files++;
    const events: RoleEvent[] = (d.events as Array<Record<string, unknown>>).map((e) => ({
      frame: e.frame as number, voice: e.voice as number, kind: e.kind as string,
      pitch: e.pitch as number, sid_chip: (e.sid_chip as number) ?? 1, waveform: (e.waveform as string) ?? "",
    }));
    const res = analyzeMultiplex(events);
    for (const [k, m] of res) {
      const [chip, voice] = k.split(":").map(Number);
      await c.setVoicePartMultiplex(d.file_md5, d.subtune_index ?? 0, voice, chip, m);
      set++;
    }
  }
  return { files, set };
}
