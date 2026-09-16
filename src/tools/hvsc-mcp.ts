/**
 * MCP tool implementations for the c64_hvsc graph (HVSC analyzer Phase 0).
 *
 * All tools default to STRICT isolation from the existing c64 graph per
 * eng-review decision A5. The 4 stub tools (c64_find_motifs,
 * c64_instrument_lookup, c64_similar_tunes, c64_driver_lookup) have
 * stable surfaces but limited functionality until Phase 0's full
 * canon ingest + clustering passes have run.
 */

import { createHash } from "node:crypto";
import { FalkorHvscClient, normalizeName } from "../services/falkor-hvsc.js";
import { HVSC_CORPUS_VERSION } from "../config.js";

export interface BrowseHvscArgs {
  composer?: string;
  chip?: "6581" | "8580" | "either";
  region?: "PAL" | "NTSC" | "both";
  year?: number;
  limit?: number;
  offset?: number;
}

export interface TuneRow {
  file_md5: string;
  subtune_index: number;
  title: string;
  composer?: string;
  year?: number | null;
  chip?: string;
  region?: string;
  length_sec?: number | null;
  hvsc_path?: string;
}

export async function c64BrowseHvsc(
  args: BrowseHvscArgs
): Promise<{ tunes: TuneRow[]; total: number }> {
  const client = new FalkorHvscClient();
  await client.connect();
  try {
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (args.composer) {
      where.push("c.name = $composer");
      params.composer = args.composer;
    }
    if (args.chip) {
      where.push("(t.chip = $chip OR t.chip = 'either')");
      params.chip = args.chip;
    }
    if (args.region) {
      where.push("t.region = $region");
      params.region = args.region;
    }
    if (args.year !== undefined) {
      where.push("t.year = $year");
      params.year = args.year;
    }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;

    const cypher = `MATCH (t:Tune)-[:COMPOSED_BY]->(c:Composer) ${whereClause}
RETURN t.file_md5 AS file_md5, t.subtune_index AS subtune_index, t.title AS title,
       c.name AS composer, t.year AS year, t.chip AS chip, t.region AS region,
       t.length_sec AS length_sec, t.hvsc_path AS hvsc_path
ORDER BY t.title
SKIP ${offset} LIMIT ${limit}`;

    const totalCypher = `MATCH (t:Tune)-[:COMPOSED_BY]->(c:Composer) ${whereClause}
RETURN count(t) AS n`;

    const tunes = await client.rawQuery<TuneRow>(cypher, params);
    const totalRows = await client.rawQuery<{ n: number }>(totalCypher, params);
    const total = Number(totalRows[0]?.n ?? 0);
    return { tunes, total };
  } finally {
    await client.disconnect();
  }
}

export async function c64HvscStats(_args: Record<string, never>): Promise<{
  tune_count: number;
  composer_count: number;
  instrument_count: number;
  patch_count: number;
  patch_family_count: number;
  motif_count: number;
  motif_family_count: number;
  rhythm_count: number;
  section_count: number;
  voicepart_count: number;
  hvsc_corpus_version: string;
}> {
  const client = new FalkorHvscClient();
  await client.connect();
  try {
    const [
      tunes, composers, instruments, patches, patchFamilies,
      motifs, motifFamilies, rhythms, sections, voiceparts,
    ] = await Promise.all([
      client.rawQuery<{ n: number }>("MATCH (t:Tune) RETURN count(t) AS n"),
      client.rawQuery<{ n: number }>("MATCH (c:Composer) RETURN count(c) AS n"),
      client.rawQuery<{ n: number }>("MATCH (i:Instrument) RETURN count(i) AS n"),
      client.rawQuery<{ n: number }>("MATCH (p:Patch) RETURN count(p) AS n"),
      client.rawQuery<{ n: number }>("MATCH (f:PatchFamily) RETURN count(f) AS n"),
      client.rawQuery<{ n: number }>("MATCH (m:Motif) RETURN count(m) AS n"),
      client.rawQuery<{ n: number }>("MATCH (mf:MotifFamily) RETURN count(mf) AS n"),
      client.rawQuery<{ n: number }>("MATCH (rc:RhythmCell) RETURN count(rc) AS n"),
      client.rawQuery<{ n: number }>("MATCH (s:Section) RETURN count(s) AS n"),
      client.rawQuery<{ n: number }>("MATCH (v:VoicePart) RETURN count(v) AS n"),
    ]);
    return {
      tune_count: Number(tunes[0]?.n ?? 0),
      composer_count: Number(composers[0]?.n ?? 0),
      instrument_count: Number(instruments[0]?.n ?? 0),
      patch_count: Number(patches[0]?.n ?? 0),
      patch_family_count: Number(patchFamilies[0]?.n ?? 0),
      motif_count: Number(motifs[0]?.n ?? 0),
      motif_family_count: Number(motifFamilies[0]?.n ?? 0),
      rhythm_count: Number(rhythms[0]?.n ?? 0),
      section_count: Number(sections[0]?.n ?? 0),
      voicepart_count: Number(voiceparts[0]?.n ?? 0),
      hvsc_corpus_version: HVSC_CORPUS_VERSION,
    };
  } finally {
    await client.disconnect();
  }
}

export interface VoicePartRow {
  voice: number;
  sid_chip: number;
  role: string;
  avg_pitch_hz: number;
  note_count: number;
  noise_percent: number;
}

/**
 * Voice roles (layer 3). Two modes:
 *  - file_md5 (+subtune): the per-voice role + stats for one subtune.
 *  - composer: their role distribution (role → voice-part count) across tunes.
 */
export async function c64VoiceRoles(args: {
  file_md5?: string;
  subtune_index?: number;
  composer?: string;
}): Promise<{
  file_md5: string | null;
  subtune_index: number | null;
  voices: VoicePartRow[];
  roles: Array<{ role: string; count: number }>;
}> {
  const client = new FalkorHvscClient();
  await client.connect();
  try {
    if (args.file_md5) {
      const subtuneIndex = args.subtune_index ?? 0;
      const voices = await client.rawQuery<VoicePartRow>(
        `MATCH (:Tune {file_md5: $f, subtune_index: $s})-[:HAS_VOICE]->(v:VoicePart)
         RETURN v.voice AS voice, v.sid_chip AS sid_chip, v.role AS role,
                v.avg_pitch_hz AS avg_pitch_hz, v.note_count AS note_count,
                v.noise_percent AS noise_percent
         ORDER BY v.sid_chip, v.voice`,
        { f: args.file_md5, s: subtuneIndex },
      );
      return { file_md5: args.file_md5, subtune_index: subtuneIndex, voices, roles: [] };
    }
    // Bind h (HAS_VOICE) and count(h) — an unreferenced relation collapses to
    // distinct endpoints in FalkorDB (see CLAUDE.md Cypher conventions).
    const roles = await client.rawQuery<{ role: string; count: number }>(
      `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune)-[h:HAS_VOICE]->(v:VoicePart)
       RETURN v.role AS role, count(h) AS count
       ORDER BY count DESC, role ASC`,
      { name: normalizeName(args.composer ?? "") },
    );
    return { file_md5: null, subtune_index: null, voices: [], roles };
  } finally {
    await client.disconnect();
  }
}

export interface SectionRow {
  order: number;
  label: string;
  start_frame: number;
  end_frame: number;
  length_frames: number;
  repeat_of: string | null;
}

/**
 * Song-form (layer 2) lookup. Two modes mirroring c64_instrument_lookup:
 *  - file_md5 (+ optional subtune_index): the ordered section list for one tune.
 *  - composer: the distribution of repeat_shapes across their tunes (which
 *    song forms they favour).
 */
export async function c64SongStructure(args: {
  file_md5?: string;
  subtune_index?: number;
  composer?: string;
}): Promise<{
  file_md5: string | null;
  subtune_index: number | null;
  repeat_shape: string | null;
  intro_frames: number | null;
  sections: SectionRow[];
  shapes: Array<{ repeat_shape: string; count: number }>;
}> {
  const client = new FalkorHvscClient();
  await client.connect();
  try {
    if (args.file_md5) {
      const subtuneIndex = args.subtune_index ?? 0;
      const tuneRows = await client.rawQuery<{ shape: string | null; intro: number | null }>(
        `MATCH (t:Tune {file_md5: $f, subtune_index: $s})
         RETURN t.repeat_shape AS shape, t.intro_frames AS intro`,
        { f: args.file_md5, s: subtuneIndex },
      );
      const sections = await client.rawQuery<SectionRow>(
        `MATCH (:Tune {file_md5: $f, subtune_index: $s})-[:HAS_SECTION]->(sec:Section)
         RETURN sec.order AS order, sec.label AS label, sec.start_frame AS start_frame,
                sec.end_frame AS end_frame, sec.length_frames AS length_frames,
                sec.repeat_of AS repeat_of
         ORDER BY sec.order`,
        { f: args.file_md5, s: subtuneIndex },
      );
      return {
        file_md5: args.file_md5,
        subtune_index: subtuneIndex,
        repeat_shape: tuneRows[0]?.shape ?? null,
        intro_frames: tuneRows[0]?.intro ?? null,
        sections,
        shapes: [],
      };
    }

    const shapes = await client.rawQuery<{ repeat_shape: string; count: number }>(
      `MATCH (t:Tune)-[:COMPOSED_BY]->(c:Composer {name: $name})
       WHERE t.repeat_shape IS NOT NULL
       RETURN t.repeat_shape AS repeat_shape, count(t) AS count
       ORDER BY count DESC, repeat_shape ASC`,
      { name: normalizeName(args.composer ?? "") },
    );
    return {
      file_md5: null,
      subtune_index: null,
      repeat_shape: null,
      intro_frames: null,
      sections: [],
      shapes,
    };
  } finally {
    await client.disconnect();
  }
}

export async function c64ComposerProfile(args: { name: string }): Promise<{
  name: string;
  tunes: TuneRow[];
  note: string;
}> {
  const client = new FalkorHvscClient();
  await client.connect();
  try {
    const tunes = await client.rawQuery<TuneRow>(
      `MATCH (t:Tune)-[:COMPOSED_BY]->(c:Composer {name: $name})
RETURN t.file_md5 AS file_md5, t.subtune_index AS subtune_index, t.title AS title,
       t.year AS year, t.chip AS chip, t.region AS region, t.length_sec AS length_sec,
       t.hvsc_path AS hvsc_path
ORDER BY t.year, t.title`,
      { name: args.name }
    );
    return {
      name: args.name,
      tunes,
      note: "Phase 0: this is a vocabulary inventory (what tunes this composer wrote), NOT a style model. Style modeling requires more examples per composer than the canon provides (per eng-review C1).",
    };
  } finally {
    await client.disconnect();
  }
}

export interface MotifFamilyRow {
  id: string;
  key: string;
  weight: number;
}
export interface MotifRow {
  motif_hash: string;
  intervals: string;
  n_notes: number;
  tunes: number;
}

/**
 * Find motifs (layer 4) in the c64_hvsc graph. Two modes:
 *  - composer: the MotifFamily contours that composer favours (FAVORS_MOTIF).
 *  - pattern: a comma-separated interval sequence (e.g. "2,2,-1") → the exact
 *    Motif node + how many tunes use it.
 */
export async function c64FindMotifs(
  args: { composer?: string; pattern?: string },
): Promise<{ families: MotifFamilyRow[]; motifs: MotifRow[]; note: string }> {
  const client = new FalkorHvscClient();
  await client.connect();
  try {
    if (args.pattern) {
      const intervals = args.pattern
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
      const motifHash = createHash("sha256").update(intervals.join(",")).digest("hex").slice(0, 16);
      const motifs = await client.rawQuery<MotifRow>(
        `MATCH (m:Motif {motif_hash: $h})
         OPTIONAL MATCH (t:Tune)-[:USES_MOTIF]->(m)
         RETURN m.motif_hash AS motif_hash, m.intervals AS intervals,
                m.n_notes AS n_notes, count(t) AS tunes`,
        { h: motifHash },
      );
      return { families: [], motifs, note: "" };
    }
    if (args.composer) {
      const families = await client.rawQuery<MotifFamilyRow>(
        `MATCH (c:Composer {name: $name})-[r:FAVORS_MOTIF]->(f:MotifFamily)
         RETURN f.id AS id, f.key AS key, r.weight AS weight
         ORDER BY r.weight DESC, f.id ASC LIMIT 25`,
        { name: normalizeName(args.composer) },
      );
      return { families, motifs: [], note: "MotifFamily.key is the melodic contour (sign of each interval: 1=up, -1=down, 0=repeat)." };
    }
    return { families: [], motifs: [], note: "Supply 'composer' (favoured contours) or 'pattern' (e.g. '2,2,-1')." };
  } finally {
    await client.disconnect();
  }
}

export async function c64InstrumentLookup(
  args: { composer?: string; patch_hash?: string; graphName?: string },
): Promise<{ families: Array<{ id: string; key: string; weight: number }>; patches: Array<Record<string, unknown>> }> {
  const client = new FalkorHvscClient(args.graphName ? { graphName: args.graphName } : {});
  await client.connect();
  try {
    if (args.patch_hash) {
      const patches = await client.rawQuery<Record<string, unknown>>(
        `MATCH (p:Patch {patch_hash: $h}) OPTIONAL MATCH (p)-[:INSTANCE_OF]->(f:PatchFamily)
         RETURN p.patch_hash AS patch_hash, p.waveform AS waveform, p.adsr AS adsr,
                p.hard_restart AS hard_restart, f.id AS family_id`,
        { h: args.patch_hash },
      );
      return { families: [], patches };
    }
    const normalizedName = normalizeName(args.composer ?? "");
    const families = await client.rawQuery<{ id: string; key: string; weight: number }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_PATCH]->(f:PatchFamily)
       RETURN f.id AS id, f.key AS key, r.weight AS weight
       ORDER BY r.weight DESC, f.id ASC LIMIT 25`,
      { name: normalizedName },
    );
    return { families, patches: [] };
  } finally {
    await client.disconnect();
  }
}

export interface SimilarTuneRow {
  file_md5: string;
  subtune_index: number;
  title: string;
  composer: string;
  score: number;
  shared_patch_families: number;  // fuzzy timbre overlap (exact patches rarely recur)
  shared_motifs: number;          // exact melodic-phrase overlap
  role_match: number;             // 0-1, position-wise voice-role agreement
  same_form: boolean;             // identical repeat_shape
}

interface OverlapRow {
  file_md5: string;
  subtune_index: number;
  shared: number;
}

/**
 * Structural similarity by GRAPH OVERLAP — not vector embeddings. Two tunes are
 * similar when they share canonical vocabulary: PatchFamilies (fuzzy timbre —
 * exact Patch SSFs are too specific to recur across tunes), exact Motifs
 * (melodic phrases — these DO recur), voice roles, and song form. Identity
 * (title/composer) never enters the score, so there is no lexical-leak failure
 * mode. Score = Jaccard(patch-families) + Jaccard(motifs) + small role/form
 * bonuses; the breakdown is returned so results are explainable.
 */
export async function c64SimilarTunes(
  args: { file_md5: string; subtune_index?: number; k?: number },
): Promise<{ matches: SimilarTuneRow[]; note: string }> {
  const subtune = args.subtune_index ?? 0;
  const k = args.k ?? 5;
  const client = new FalkorHvscClient();
  await client.connect();
  try {
    const params = { f: args.file_md5, s: subtune };

    // Query tune's own vocabulary sizes + profile.
    const self = await client.rawQuery<{
      title: string; pcount: number; mcount: number; repeat_shape: string | null;
    }>(
      `MATCH (q:Tune {file_md5: $f, subtune_index: $s})
       OPTIONAL MATCH (q)-[:USES_PATCH]->(:Patch)-[:INSTANCE_OF]->(pf:PatchFamily)
       OPTIONAL MATCH (q)-[:USES_MOTIF]->(m:Motif)
       RETURN q.title AS title, count(DISTINCT pf) AS pcount, count(DISTINCT m) AS mcount,
              q.repeat_shape AS repeat_shape`,
      params,
    );
    if (self.length === 0) {
      return { matches: [], note: "Tune not found in c64_hvsc (check file_md5 / subtune_index)." };
    }
    const qP = Number(self[0].pcount ?? 0);
    const qM = Number(self[0].mcount ?? 0);
    const qForm = self[0].repeat_shape ?? null;

    const qRoles = (await client.rawQuery<{ role: string }>(
      `MATCH (:Tune {file_md5: $f, subtune_index: $s})-[:HAS_VOICE]->(v:VoicePart)
       RETURN v.role AS role ORDER BY v.sid_chip, v.voice`, params,
    )).map((r) => r.role);

    // Shared PatchFamilies (fuzzy timbre) / exact Motifs per candidate.
    const patchOv = await client.rawQuery<OverlapRow>(
      `MATCH (q:Tune {file_md5: $f, subtune_index: $s})-[:USES_PATCH]->(:Patch)-[:INSTANCE_OF]->(pf:PatchFamily)
       MATCH (pf)<-[:INSTANCE_OF]-(:Patch)<-[:USES_PATCH]-(c:Tune)
       WHERE c.file_md5 <> $f
       RETURN c.file_md5 AS file_md5, c.subtune_index AS subtune_index, count(DISTINCT pf) AS shared`, params,
    );
    const motifOv = await client.rawQuery<OverlapRow>(
      `MATCH (q:Tune {file_md5: $f, subtune_index: $s})-[:USES_MOTIF]->(m:Motif)<-[:USES_MOTIF]-(c:Tune)
       WHERE c.file_md5 <> $f
       RETURN c.file_md5 AS file_md5, c.subtune_index AS subtune_index, count(DISTINCT m) AS shared`, params,
    );

    // Per-tune display + vocabulary sizes (authoritative source for title/composer).
    const sizeRows = await client.rawQuery<{
      key: string; title: string; composer: string; pc: number; mc: number; form: string | null;
    }>(
      `MATCH (c:Tune)-[:COMPOSED_BY]->(co:Composer)
       OPTIONAL MATCH (c)-[:USES_PATCH]->(:Patch)-[:INSTANCE_OF]->(pf:PatchFamily)
       OPTIONAL MATCH (c)-[:USES_MOTIF]->(m:Motif)
       RETURN c.file_md5 + ':' + c.subtune_index AS key, c.title AS title, co.display_name AS composer,
              count(DISTINCT pf) AS pc, count(DISTINCT m) AS mc, c.repeat_shape AS form`, {},
    );
    const sizes = new Map<string, { title: string; composer: string; pc: number; mc: number; form: string | null }>();
    for (const r of sizeRows) {
      sizes.set(r.key, { title: r.title, composer: r.composer, pc: Number(r.pc ?? 0), mc: Number(r.mc ?? 0), form: r.form ?? null });
    }

    // Candidate roles, fetched once and grouped.
    const roleRows = await client.rawQuery<{ key: string; role: string }>(
      `MATCH (c:Tune)-[:HAS_VOICE]->(v:VoicePart)
       RETURN c.file_md5 + ':' + c.subtune_index AS key, v.role AS role
       ORDER BY v.sid_chip, v.voice`, {},
    );
    const candRoles = new Map<string, string[]>();
    for (const r of roleRows) {
      const arr = candRoles.get(r.key) ?? [];
      arr.push(r.role);
      candRoles.set(r.key, arr);
    }

    // Merge overlap signals keyed by candidate.
    const agg = new Map<string, { row: OverlapRow; sp: number; sm: number }>();
    for (const r of patchOv) {
      const key = `${r.file_md5}:${r.subtune_index}`;
      agg.set(key, { row: r, sp: Number(r.shared ?? 0), sm: 0 });
    }
    for (const r of motifOv) {
      const key = `${r.file_md5}:${r.subtune_index}`;
      const e = agg.get(key);
      if (e) e.sm = Number(r.shared ?? 0);
      else agg.set(key, { row: r, sp: 0, sm: Number(r.shared ?? 0) });
    }

    const roleMatch = (a: string[], b: string[]): number => {
      if (a.length === 0 || b.length === 0) return 0;
      const n = Math.min(a.length, b.length);
      let m = 0;
      for (let i = 0; i < n; i++) if (a[i] === b[i]) m++;
      return m / Math.max(a.length, b.length);
    };

    const scored: SimilarTuneRow[] = [];
    for (const [key, e] of agg) {
      const sz = sizes.get(key);
      if (!sz) continue;
      const jacP = qP + sz.pc - e.sp > 0 ? e.sp / (qP + sz.pc - e.sp) : 0;
      const jacM = qM + sz.mc - e.sm > 0 ? e.sm / (qM + sz.mc - e.sm) : 0;
      const rMatch = roleMatch(qRoles, candRoles.get(key) ?? []);
      const sameForm = qForm != null && sz.form === qForm;
      const score = jacP + jacM + 0.25 * rMatch + (sameForm ? 0.1 : 0);
      scored.push({
        file_md5: e.row.file_md5,
        subtune_index: e.row.subtune_index,
        title: sz.title,
        composer: sz.composer,
        score,
        shared_patch_families: e.sp,
        shared_motifs: e.sm,
        role_match: Number(rMatch.toFixed(3)),
        same_form: sameForm,
      });
    }

    scored.sort((a, b) => b.score - a.score || a.file_md5.localeCompare(b.file_md5) || a.subtune_index - b.subtune_index);
    return { matches: scored.slice(0, k), note: "" };
  } finally {
    await client.disconnect();
  }
}

export async function c64DriverLookup(
  _args: { hash: string }
): Promise<null> {
  return null;
}
