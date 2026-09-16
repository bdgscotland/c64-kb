/** Palette query tools (Wave 2): per-composer mined vocabulary Claude inlines
 * into a Score. Read-only over the existing c64_hvsc graph. */
import { FalkorHvscClient, normalizeName } from "../services/falkor-hvsc.js";

export interface GestureRow { kind: string; rate_frames: number; depth_cents: number; weight: number }

export interface TimbreGestureRow {
  kind: string;
  archetype: string;
  depth_band: string;
  rate_band: string;
  resonance_band: string | null;
  mode: string | null;
  template: number[];
  weight: number;
}

export async function c64GestureLookup(
  args: { composer: string; graphName?: string },
): Promise<{ gestures: GestureRow[]; note: string }> {
  const client = new FalkorHvscClient(args.graphName ? { graphName: args.graphName } : {});
  await client.connect();
  try {
    const rows = await client.rawQuery<GestureRow>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_GESTURE]->(g:Gesture)
       RETURN g.kind AS kind, g.rate_frames AS rate_frames, g.depth_cents AS depth_cents, r.weight AS weight
       ORDER BY r.weight DESC, g.gesture_hash ASC LIMIT 25`,
      { name: normalizeName(args.composer) },
    );
    return {
      gestures: rows.map((g) => ({
        kind: g.kind, rate_frames: Number(g.rate_frames),
        depth_cents: Number(g.depth_cents), weight: Number(g.weight),
      })),
      note: "Favoured vibrato gestures (FAVORS_GESTURE); weight = incidence across the canon. Inline rate_frames/depth_cents into a Score voice.vibrato.",
    };
  } finally {
    await client.disconnect();
  }
}

export interface RhythmRow { slots: string; n_notes: number; occurrences: number }
export interface FamilyRow { id: string; key: string; weight: number }
export interface CountRow { label: string; count: number }

export async function c64RhythmLookup(
  args: { composer: string; graphName?: string },
): Promise<{ rhythms: RhythmRow[]; note: string }> {
  const client = new FalkorHvscClient(args.graphName ? { graphName: args.graphName } : {});
  await client.connect();
  try {
    // Bound USES_RHYTHM alias (u) summed per cell — no FAVORS_RHYTHM exists, so
    // aggregate occurrences across the composer's tunes (bound-alias rule).
    const rows = await client.rawQuery<RhythmRow>(
      `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune)-[u:USES_RHYTHM]->(rc:RhythmCell)
       WITH rc, sum(u.occurrences) AS occ
       RETURN rc.slots AS slots, rc.n_notes AS n_notes, occ AS occurrences
       ORDER BY occ DESC, rc.rhythm_hash ASC LIMIT 25`,
      { name: normalizeName(args.composer) },
    );
    return {
      rhythms: rows.map((r) => ({
        slots: r.slots, n_notes: Number(r.n_notes), occurrences: Number(r.occurrences),
      })),
      note: "Common rhythm cells aggregated from USES_RHYTHM. slots is a JSON array of [ioi,gate] slots (sixteenth-grid units).",
    };
  } finally {
    await client.disconnect();
  }
}

export interface ProgressionRow { degrees: string; length: number; weight: number; roman: string }

const _ROMAN = ["I", "bII", "II", "bIII", "III", "IV", "bV", "V", "bVI", "VI", "bVII", "VII"];

/** Render a key-relative degree string ("0min-10maj") as roman numerals
 * ("i-bVII") for human display only. Lowercase = minor quality. */
export function degreesToRoman(degrees: string): string {
  return degrees.split("-").map((tok) => {
    const m = tok.match(/^(\d+)(maj|min)$/);
    if (!m) return tok;
    const r = _ROMAN[Number(m[1]) % 12];
    return m[2] === "min" ? r.toLowerCase() : r;
  }).join("-");
}

export async function c64ProgressionLookup(
  args: { composer: string; graphName?: string },
): Promise<{ progressions: ProgressionRow[]; note: string }> {
  const client = new FalkorHvscClient(args.graphName ? { graphName: args.graphName } : {});
  await client.connect();
  try {
    const rows = await client.rawQuery<{ degrees: string; length: number; weight: number }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_PROGRESSION]->(p:Progression)
       RETURN p.degrees AS degrees, p.length AS length, r.weight AS weight
       ORDER BY r.weight DESC, p.id ASC LIMIT 25`,
      { name: normalizeName(args.composer) },
    );
    return {
      progressions: rows.map((r) => ({
        degrees: r.degrees, length: Number(r.length), weight: Number(r.weight),
        roman: degreesToRoman(r.degrees),
      })),
      note: "Favoured chord progressions (FAVORS_PROGRESSION); key-relative degrees, weight = section incidence. Fill Score sections[].chords by transposing degrees into meta.key.",
    };
  } finally {
    await client.disconnect();
  }
}

// --- Phrase lookup (SP-phrase, 2026-05-21) ---

export interface PhraseBeatsHint { iois_beats: number[]; gates_beats: number[] }
export interface PhraseRow {
  intervals: number[]; iois: number[]; gates: number[];
  n_notes: number; weight: number;
  beats_hint: PhraseBeatsHint;
}

function parseCsvInts(s: string): number[] {
  if (!s) return [];
  return s.split(",").map((x) => parseInt(x, 10));
}

function parseCsvFloats(s: string): number[] {
  if (!s) return [];
  return s.split(",").map((x) => parseFloat(x));
}

function phraseBeatsHint(iois: number[], gates: number[]): PhraseBeatsHint {
  return {
    iois_beats: iois.map((v) => v * 0.25),
    gates_beats: gates.map((v) => v * 0.25),
  };
}

/**
 * No role  → top FAVORS_PHRASE ordered by weight (Composer→Phrase direct edges).
 * With role → aggregate USES_PHRASE via VoicePart{role} — occurrence sum per phrase,
 *             sorted descending (mirrors c64RhythmLookup pattern).
 */
export async function c64PhraseLookup(
  args: { composer: string; role?: string; graphName?: string },
): Promise<{ phrases: PhraseRow[]; note: string }> {
  const client = new FalkorHvscClient(args.graphName ? { graphName: args.graphName } : {});
  await client.connect();
  try {
    const name = normalizeName(args.composer);
    if (args.role) {
      // Role path: aggregate USES_PHRASE occurrences across tunes for this role
      const rows = await client.rawQuery<{
        intervals: string; iois: string; gates: string; n_notes: number; occ: number;
      }>(
        `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune)-[:HAS_VOICE]->(v:VoicePart {role: $role})-[u:USES_PHRASE]->(p:Phrase)
         WITH p, sum(u.occurrences) AS occ
         RETURN p.intervals AS intervals, p.iois AS iois, p.gates AS gates, p.n_notes AS n_notes, occ
         ORDER BY occ DESC, p.id ASC LIMIT 25`,
        { name, role: args.role },
      );
      return {
        phrases: rows.map((r) => {
          const iois = parseCsvInts(r.iois);
          const gates = parseCsvInts(r.gates);
          return {
            intervals: parseCsvInts(r.intervals),
            iois, gates,
            n_notes: Number(r.n_notes),
            weight: Number(r.occ),
            beats_hint: phraseBeatsHint(iois, gates),
          };
        }),
        note: `Fused pitch+rhythm phrases for role '${args.role}' (USES_PHRASE, occurrence sum). iois/gates in 16th-grid units; beats_hint=×0.25.`,
      };
    } else {
      // No-role path: direct FAVORS_PHRASE from Composer node
      const rows = await client.rawQuery<{
        intervals: string; iois: string; gates: string; n_notes: number; weight: number;
      }>(
        `MATCH (c:Composer {name: $name})-[r:FAVORS_PHRASE]->(p:Phrase)
         RETURN p.intervals AS intervals, p.iois AS iois, p.gates AS gates, p.n_notes AS n_notes, r.weight AS weight
         ORDER BY r.weight DESC, p.id ASC LIMIT 25`,
        { name },
      );
      return {
        phrases: rows.map((r) => {
          const iois = parseCsvInts(r.iois);
          const gates = parseCsvInts(r.gates);
          return {
            intervals: parseCsvInts(r.intervals),
            iois, gates,
            n_notes: Number(r.n_notes),
            weight: Number(r.weight),
            beats_hint: phraseBeatsHint(iois, gates),
          };
        }),
        note: "Favoured fused pitch+rhythm phrases (FAVORS_PHRASE); weight = incidence across canon. iois/gates in 16th-grid units; beats_hint=×0.25.",
      };
    }
  } finally {
    await client.disconnect();
  }
}

// --- Arp lookup (SP-arp, 2026-05-21) ---

export interface ArpRow { chord_intervals: number[]; cycle: number[]; n_steps: number; rate_frames: number; rate_hz: number; quality: string; weight: number; }

function arpQuality(ci: number[]): string {
  const pcs = new Set(ci.map((x) => ((x % 12) + 12) % 12));
  const has = (x: number) => pcs.has(x);
  if (has(3) && has(7) && !has(4)) return has(10) ? "min7" : "min";
  if (has(4) && has(7)) return has(10) ? "dom7" : "maj";
  if (has(3) && has(6)) return "dim";
  if (has(5) && has(7)) return "sus4";
  return "other";
}

/**
 * No role  → top FAVORS_ARP ordered by weight (Composer→Arp direct edges).
 * With role → aggregate USES_ARP via VoicePart{role} — occurrence sum per arp,
 *             sorted descending (mirrors c64PhraseLookup pattern).
 */
export async function c64ArpLookup(
  args: { composer: string; role?: string; graphName?: string },
): Promise<{ arps: ArpRow[]; note: string }> {
  const client = new FalkorHvscClient(args.graphName ? { graphName: args.graphName } : {});
  await client.connect();
  try {
    const name = normalizeName(args.composer);
    const map = (r: { chord_intervals: string; cycle: string; n_steps: number; rate_frames: number; weight: number }): ArpRow => {
      const ci = parseCsvInts(r.chord_intervals);
      return { chord_intervals: ci, cycle: parseCsvInts(r.cycle), n_steps: Number(r.n_steps),
        rate_frames: Number(r.rate_frames), rate_hz: Math.round((50 / Math.max(1, Number(r.rate_frames))) * 10) / 10,
        quality: arpQuality(ci), weight: Number(r.weight) };
    };
    if (args.role) {
      const rows = await client.rawQuery<{ chord_intervals: string; cycle: string; n_steps: number; rate_frames: number; weight: number }>(
        `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune)-[:HAS_VOICE]->(v:VoicePart {role: $role})-[u:USES_ARP]->(a:Arp)
         WITH a, sum(u.occurrences) AS weight
         RETURN a.chord_intervals AS chord_intervals, a.cycle AS cycle, a.n_steps AS n_steps, a.rate_frames AS rate_frames, weight
         ORDER BY weight DESC, a.id ASC LIMIT 25`, { name, role: args.role });
      return { arps: rows.map(map), note: `Arpeggio gestures for role '${args.role}' (USES_ARP, occurrence sum). rate in frames (~50 Hz); rate_hz = 50/rate_frames.` };
    }
    const rows = await client.rawQuery<{ chord_intervals: string; cycle: string; n_steps: number; rate_frames: number; weight: number }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_ARP]->(a:Arp)
       RETURN a.chord_intervals AS chord_intervals, a.cycle AS cycle, a.n_steps AS n_steps, a.rate_frames AS rate_frames, r.weight AS weight
       ORDER BY r.weight DESC, a.id ASC LIMIT 25`, { name });
    return { arps: rows.map(map), note: "Favoured arpeggio gestures (FAVORS_ARP); rate in frames (~50 Hz). Build a Score voice's arps[] (ArpNote) for the chord shimmer." };
  } finally { await client.disconnect(); }
}

// --- Timbre lookup (SP-timbre, 2026-05-21): aggregate per-tune sid_native ---

export interface TimbreProfile {
  n_tunes: number;
  filter: {
    dominant_mode: string | null; active_fraction: number; cutoff_mean: number;
    cutoff_std: number; resonance_mean: number; routed_rate: number;
  };
  pwm: { depth: number; mean_width: number };
}

const _TIMBRE_NUM_KEYS = [
  "filter_active_fraction", "filter_cutoff_mean", "filter_cutoff_std",
  "filter_resonance_mean", "filter_routed_rate", "pwm_depth", "pwm_mean_width",
] as const;

/** Pure aggregator over a composer's per-tune sid_native dicts. No DB. */
export function aggregateTimbre(sids: Array<Record<string, unknown>>): TimbreProfile {
  const nums: Record<string, number[]> = {};
  const modes: Record<string, number> = {};
  let n = 0;
  for (const sn of sids) {
    if (!sn || Object.keys(sn).length === 0) continue;
    n++;
    for (const k of _TIMBRE_NUM_KEYS) {
      const v = sn[k];
      if (typeof v === "number" && Number.isFinite(v)) (nums[k] ??= []).push(v);
    }
    const m = sn["dominant_filter_mode"];
    if (typeof m === "string" && m) modes[m] = (modes[m] ?? 0) + 1;
  }
  const mean = (a?: number[]) => (a && a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const dom = Object.entries(modes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  return {
    n_tunes: n,
    filter: {
      dominant_mode: dom,
      active_fraction: r3(mean(nums["filter_active_fraction"])),
      cutoff_mean: r1(mean(nums["filter_cutoff_mean"])),
      cutoff_std: r1(mean(nums["filter_cutoff_std"])),
      resonance_mean: r1(mean(nums["filter_resonance_mean"])),
      routed_rate: r3(mean(nums["filter_routed_rate"])),
    },
    pwm: { depth: r1(mean(nums["pwm_depth"])), mean_width: r1(mean(nums["pwm_mean_width"])) },
  };
}

export async function composerSidNative(
  client: FalkorHvscClient, name: string,
): Promise<Array<Record<string, unknown>>> {
  const rows = await client.rawQuery<{ sn: string }>(
    `MATCH (t:Tune)-[:COMPOSED_BY]->(c:Composer {name: $name}) RETURN t.sid_native AS sn`,
    { name },
  );
  return rows.map((r) => { try { return JSON.parse(r.sn || "{}"); } catch { return {}; } });
}

/** Shared query + parse logic for FAVORS_TIMBRE_GESTURE rows. */
async function queryTimbreGestures(
  client: FalkorHvscClient,
  name: string,
): Promise<TimbreGestureRow[]> {
  const rows = await client.rawQuery<{
    kind: string; archetype: string; depth_band: string; rate_band: string;
    resonance_band: string | null; mode: string | null; template: string; weight: number;
  }>(
    `MATCH (c:Composer {name: $name})-[r:FAVORS_TIMBRE_GESTURE]->(g:Gesture)
     RETURN g.kind AS kind, g.archetype AS archetype, g.depth_band AS depth_band,
            g.rate_band AS rate_band, g.resonance_band AS resonance_band, g.mode AS mode,
            g.template AS template, r.weight AS weight
     ORDER BY r.weight DESC, g.gesture_hash ASC LIMIT 16`,
    { name },
  );
  return rows.map((g) => ({
    kind: g.kind,
    archetype: g.archetype,
    depth_band: g.depth_band,
    rate_band: g.rate_band,
    resonance_band: g.resonance_band ?? null,
    mode: g.mode ?? null,
    template: parseCsvFloats(g.template ?? ""),
    weight: Number(g.weight),
  }));
}

export async function c64TimbreLookup(
  args: { composer: string; graphName?: string },
): Promise<{ timbre: TimbreProfile; timbre_gestures: TimbreGestureRow[]; note: string }> {
  const client = new FalkorHvscClient(args.graphName ? { graphName: args.graphName } : {});
  await client.connect();
  try {
    const name = normalizeName(args.composer);
    const timbre = aggregateTimbre(await composerSidNative(client, name));
    const timbre_gestures = await queryTimbreGestures(client, name);
    const f = timbre.filter, p = timbre.pwm;
    const tgNote = timbre_gestures.length > 0
      ? ` timbre_gestures (${timbre_gestures.length} entries, split by kind): build Voice.timbre_gesture from these — ` +
        `pick the top pwm gesture for the lead's PW motion and the top filter gesture for routed voices; ` +
        `set center from the patch pulse_width / filter cutoff center and depth from a representative of depth_band; ` +
        `the template gives the faithful per-frame shape.`
      : "";
    return {
      timbre,
      timbre_gestures,
      note: `Mined timbre profile from ${timbre.n_tunes} tunes' sid_native (no re-ingest). ` +
        `PWM: set a lead/arp Voice.pwm { depth≈${Math.round(p.depth)}, center≈${Math.round(p.mean_width)} } ` +
        `for the SID 'breathing pulse'. FILTER: active ~${Math.round(f.active_fraction * 100)}% of frames → ` +
        `use mode '${f.dominant_mode ?? "lp"}' sparingly, resonance≈${Math.round(f.resonance_mean)}. ` +
        `cutoff_mean (${f.cutoff_mean}) averages over filter-off frames so it reads low — pick a musical ` +
        `cutoff_center (e.g. 800-1400) and sweep with lfo_depth.` + tgNote,
    };
  } finally {
    await client.disconnect();
  }
}

// --- Drum lookup (SP-drums, 2026-05-21): percussion-role rhythms + noise patch ---

export interface DrumProfile {
  n_percussion_voices: number;
  rhythms: Array<{ iois: number[]; gates: number[]; weight: number }>;
  noise_patch: { adsr: number[] } | null;
}

export async function c64DrumLookup(
  args: { composer: string; graphName?: string },
): Promise<{ drums: DrumProfile; note: string }> {
  const client = new FalkorHvscClient(args.graphName ? { graphName: args.graphName } : {});
  await client.connect();
  try {
    const name = normalizeName(args.composer);
    const rows = await client.rawQuery<{ iois: string; gates: string; occ: number }>(
      `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune)-[:HAS_VOICE]->(v:VoicePart {role:'percussion'})-[u:USES_PHRASE]->(p:Phrase)
       WITH p, sum(u.occurrences) AS occ
       RETURN p.iois AS iois, p.gates AS gates, occ ORDER BY occ DESC, p.id ASC LIMIT 12`,
      { name });
    const vcount = await client.rawQuery<{ n: number }>(
      `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune)-[:HAS_VOICE]->(v:VoicePart {role:'percussion'})
       RETURN count(v) AS n`, { name });
    const noise = await client.rawQuery<{ key: string }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_PATCH]->(f:PatchFamily)
       WHERE f.key CONTAINS 'noise' RETURN f.key AS key ORDER BY r.weight DESC LIMIT 1`, { name });
    // PatchFamily key format: "a,d,s,r|waveform|filter_routed|hr"
    let noise_patch: { adsr: number[] } | null = null;
    if (noise.length > 0) {
      const adsr = (noise[0].key.split("|")[0] ?? "").split(",").map((x) => parseInt(x, 10));
      if (adsr.length === 4 && adsr.every((n) => Number.isFinite(n))) noise_patch = { adsr };
    }
    const drums: DrumProfile = {
      n_percussion_voices: Number(vcount[0]?.n ?? 0),
      rhythms: rows.map((r) => ({
        iois: r.iois.split(",").map((x) => parseInt(x, 10)),
        gates: r.gates.split(",").map((x) => parseInt(x, 10)),
        weight: Number(r.occ),
      })),
      noise_patch,
    };
    return {
      drums,
      note: `Mined percussion rhythms (${drums.rhythms.length} patterns from ${drums.n_percussion_voices} percussion voices). ` +
        `iois are 16th-grid hit spacings — place DrumHits on a percussion voice at those spacings. ` +
        `TYPE convention (noise pitch carries no type): kick on strong beats/downbeats, snare on the backbeat, ` +
        `hihat on the remaining 16ths. noise_patch.adsr is a representative snare/hihat envelope.`,
    };
  } finally {
    await client.disconnect();
  }
}

// --- Grammar lookup (SP-grammar, layer 4, 2026-05-21) ---

export type DevOpKey = "repeat" | "sequence" | "invert" | "augment" | "vary";

export interface GrammarProfile {
  n_tunes: number;                                                    // tunes with a mined lead
  hook: { intervals: number[]; n_tunes: number; strength: number } | null;  // signature hook
  top_hooks: Array<{ intervals: number[]; n_tunes: number; strength: number }>;
  development: Record<DevOpKey, number>;                              // normalized 0..1 distribution
  phrasing: {
    leap_ratio: number; step_ratio: number; repetition_rate: number;
    mean_abs_interval: number; hook_strength: number;
  };
  contour_distribution: Array<{ archetype: string; count: number }>;
  hook_families: Array<{ contour: string; weight: number; intervals: number[] }>;  // FAVORS_HOOK (graph)
}

const _r3 = (x: unknown) => Math.round(Number(x) * 1000) / 1000;

// Floor for grammar aggregation: a lead needs this many notes to be a real
// melody, not an sfx/jingle subtune (those read 'flat' and skew the profile).
const MIN_GRAMMAR_NOTES = 8;

/** Aggregate a composer's per-tune grammar Tune-props into a GrammarProfile.
 * All single-node-prop aggregation over the 1-hop COMPOSED_BY pattern (like
 * song_forms/timbre) — no relationship-alias counting, so no path-collapse gotcha. */
export async function c64GrammarLookup(
  args: { composer: string; graphName?: string },
): Promise<{ grammar: GrammarProfile; note: string }> {
  const client = new FalkorHvscClient(args.graphName ? { graphName: args.graphName } : {});
  await client.connect();
  try {
    const name = normalizeName(args.composer);
    const agg = (await client.rawQuery<{
      n: number; leap: number; step: number; rep: number; mai: number; hookstr: number;
      d_rep: number; d_seq: number; d_inv: number; d_aug: number; d_var: number;
    }>(
      `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune) WHERE t.grammar_note_count >= $minNotes
       RETURN count(t) AS n, avg(t.grammar_leap_ratio) AS leap, avg(t.grammar_step_ratio) AS step,
              avg(t.grammar_repetition_rate) AS rep, avg(t.grammar_mean_abs_interval) AS mai,
              avg(t.grammar_hook_strength) AS hookstr,
              sum(t.grammar_dev_repeat) AS d_rep, sum(t.grammar_dev_sequence) AS d_seq,
              sum(t.grammar_dev_invert) AS d_inv, sum(t.grammar_dev_augment) AS d_aug,
              sum(t.grammar_dev_vary) AS d_var`,
      { name, minNotes: MIN_GRAMMAR_NOTES }))[0];
    const nTunes = Number(agg?.n ?? 0);

    const hookRows = await client.rawQuery<{ h: string; n: number; s: number }>(
      `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune) WHERE t.grammar_hook_intervals <> ''
       RETURN t.grammar_hook_intervals AS h, count(t) AS n, max(t.grammar_hook_strength) AS s
       ORDER BY n DESC, s DESC, h ASC LIMIT 8`,
      { name });
    const top_hooks = hookRows.map((r) => ({
      intervals: JSON.parse(r.h) as number[], n_tunes: Number(r.n), strength: _r3(r.s),
    }));

    const contourRows = await client.rawQuery<{ c: string; n: number }>(
      `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune)
       WHERE t.grammar_contour IS NOT NULL AND t.grammar_note_count >= $minNotes
       RETURN t.grammar_contour AS c, count(t) AS n ORDER BY n DESC, c ASC`,
      { name, minNotes: MIN_GRAMMAR_NOTES });

    // First-class hook vocabulary (FAVORS_HOOK -> HookFamily, like FAVORS_MOTIF).
    const hookFamRows = await client.rawQuery<{ contour: string; weight: number; samples: string[] }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_HOOK]->(f:HookFamily)
       OPTIONAL MATCH (h:Hook)-[:INSTANCE_OF]->(f)
       WITH f, r.weight AS weight, collect(h.intervals) AS samples
       RETURN f.key AS contour, weight, samples ORDER BY weight DESC, f.key ASC LIMIT 8`,
      { name });
    const hook_families = hookFamRows.map((r) => {
      // representative = the family member with the smallest leaps (avoid octave-jump outliers)
      const parsed = (r.samples ?? [])
        .map((s) => { try { return JSON.parse(s) as number[]; } catch { return null; } })
        .filter((x): x is number[] => Array.isArray(x) && x.length > 0);
      const rep = parsed.sort((a, b) =>
        Math.max(...a.map(Math.abs)) - Math.max(...b.map(Math.abs)))[0] ?? [];
      return { contour: r.contour, weight: Number(r.weight), intervals: rep };
    });

    const devCounts: Record<DevOpKey, number> = {
      repeat: Number(agg?.d_rep ?? 0), sequence: Number(agg?.d_seq ?? 0),
      invert: Number(agg?.d_inv ?? 0), augment: Number(agg?.d_aug ?? 0), vary: Number(agg?.d_var ?? 0),
    };
    const devTotal = Object.values(devCounts).reduce((a, b) => a + b, 0);
    const development = Object.fromEntries(
      (Object.keys(devCounts) as DevOpKey[]).map((k) => [k, devTotal > 0 ? _r3(devCounts[k] / devTotal) : 0]),
    ) as Record<DevOpKey, number>;

    const grammar: GrammarProfile = {
      n_tunes: nTunes,
      hook: top_hooks[0] ? { intervals: top_hooks[0].intervals, n_tunes: top_hooks[0].n_tunes, strength: top_hooks[0].strength } : null,
      top_hooks,
      development,
      phrasing: {
        leap_ratio: _r3(agg?.leap ?? 0), step_ratio: _r3(agg?.step ?? 0),
        repetition_rate: _r3(agg?.rep ?? 0), mean_abs_interval: _r3(agg?.mai ?? 0),
        hook_strength: _r3(agg?.hookstr ?? 0),
      },
      contour_distribution: contourRows.map((r) => ({ archetype: r.c, count: Number(r.n) })),
      hook_families,
    };
    return {
      grammar,
      note: nTunes === 0
        ? "No mined grammar for this composer (no lead voice with enough notes, or composer not in canon)."
        : "Mined melodic grammar (SP-grammar). hook = signature recurring figure (interval semitones) — STATE it, then DEVELOP it via the development distribution (sequence=transpose, invert=mirror, vary=ornament) instead of walking scales. phrasing.leap_ratio/mean_abs_interval set the melodic step-vs-leap character; contour_distribution is the lead's typical shape.",
    };
  } finally {
    await client.disconnect();
  }
}

// --- Form-as-dynamics lookup (SP-form, layer 5, 2026-05-21) ---

export interface FormProfile {
  n_tunes: number;                                              // tunes with a mined arc
  top_arc: string | null;                                       // most-favoured arc archetype
  arc_distribution: Array<{ arc: string; weight: number }>;     // FAVORS_ARC (graph)
  energy_by_section: Array<{ order: number; energy: number; n: number }>;  // typical trajectory (build target)
  peak_section_mean: number;
}

/** A composer's form-as-dynamics: favoured arc archetypes (FAVORS_ARC) + the typical
 * per-section energy trajectory (avg Section.energy by order) — the "build to here" target
 * for generation. All single-node/1-hop aggregation; FAVORS_ARC weight is bound count(u). */
export async function c64FormLookup(
  args: { composer: string; graphName?: string },
): Promise<{ form: FormProfile; note: string }> {
  const client = new FalkorHvscClient(args.graphName ? { graphName: args.graphName } : {});
  await client.connect();
  try {
    const name = normalizeName(args.composer);
    const arcRows = await client.rawQuery<{ arc: string; weight: number }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_ARC]->(a:ArcShape)
       RETURN a.arc AS arc, r.weight AS weight ORDER BY r.weight DESC, a.arc ASC`, { name });
    const arc_distribution = arcRows.map((r) => ({ arc: r.arc, weight: Number(r.weight) }));
    const n_tunes = arc_distribution.reduce((s, a) => s + a.weight, 0);

    const traj = await client.rawQuery<{ order: number; energy: number; n: number }>(
      `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune)-[:HAS_SECTION]->(s:Section)
       WHERE s.energy IS NOT NULL
       RETURN s.order AS order, avg(s.energy) AS energy, count(s) AS n
       ORDER BY s.order ASC LIMIT 16`, { name });
    const energy_by_section = traj.map((r) => ({
      order: Number(r.order), energy: Math.round(Number(r.energy) * 1000) / 1000, n: Number(r.n),
    }));
    const peakRow = await client.rawQuery<{ p: number }>(
      `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune)-[r:HAS_ARC]->(:ArcShape)
       RETURN avg(r.peak_section) AS p`, { name });

    return {
      form: {
        n_tunes, top_arc: arc_distribution[0]?.arc ?? null, arc_distribution, energy_by_section,
        peak_section_mean: Math.round(Number(peakRow[0]?.p ?? 0) * 100) / 100,
      },
      note: n_tunes === 0
        ? "No mined form for this composer (no sections/events, or not in canon)."
        : "Form-as-dynamics (SP-form). arc_distribution = favoured tension/release shapes; energy_by_section = the typical per-section energy trajectory (0..1) — BUILD the arrangement to follow it (raise density/voices/register into the peak section, release after) instead of a flat or hand-faked arc. Most SID tunes are loop-flat or oscillate; a deliberate arch/rising stands out.",
    };
  } finally {
    await client.disconnect();
  }
}

// --- Melodic-direction lookup (SP-direction, layer 4b, 2026-05-21) ---

export interface DirectionProfile {
  n_tunes: number;
  resolution_rate: number;   // mean: phrase-ends reached by step (voice-leading)
  qa_rate: number;           // mean: open→closed antecedent-consequent pairing
  mean_phrase_len: number;
  cadences: Array<{ degree: number; closed: boolean; weight: number }>;  // FAVORS_CADENCE (graph)
}

/** A composer's melodic direction: favoured cadences (FAVORS_CADENCE) + voice-leading /
 * Q&A / phrase-length stats. Cadence distribution is graph FAVORS_CADENCE; the rates are
 * single-node Tune-prop averages (the timbre/grammar-phrasing pattern). */
export async function c64DirectionLookup(
  args: { composer: string; graphName?: string },
): Promise<{ direction: DirectionProfile; note: string }> {
  const client = new FalkorHvscClient(args.graphName ? { graphName: args.graphName } : {});
  await client.connect();
  try {
    const name = normalizeName(args.composer);
    const agg = (await client.rawQuery<{ n: number; res: number; qa: number; plen: number }>(
      `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune) WHERE t.direction_n_phrases > 0
       RETURN count(t) AS n, avg(t.direction_resolution_rate) AS res,
              avg(t.direction_qa_rate) AS qa, avg(t.direction_mean_phrase_len) AS plen`, { name }))[0];
    const cadRows = await client.rawQuery<{ degree: number; closed: boolean; weight: number }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_CADENCE]->(cad:Cadence)
       RETURN cad.degree AS degree, cad.closed AS closed, r.weight AS weight
       ORDER BY r.weight DESC, cad.degree ASC`, { name });
    const r3 = (x: unknown) => Math.round(Number(x) * 1000) / 1000;
    return {
      direction: {
        n_tunes: Number(agg?.n ?? 0),
        resolution_rate: r3(agg?.res ?? 0), qa_rate: r3(agg?.qa ?? 0), mean_phrase_len: r3(agg?.plen ?? 0),
        cadences: cadRows.map((c) => ({ degree: Number(c.degree), closed: !!c.closed, weight: Number(c.weight) })),
      },
      note: Number(agg?.n ?? 0) === 0
        ? "No mined direction for this composer (no lead phrases, or not in canon)."
        : "Melodic direction (SP-direction). cadences = where phrases LAND (degree relative to key; closed=1/3/5 resolved, open otherwise) by incidence — END sections on the composer's favoured cadence. resolution_rate = how often phrase-ends are voice-led (stepwise); qa_rate = how often phrases pair antecedent→consequent (open question → closed answer). To stop a line wandering: build phrases that DRIVE to a goal note and pair Q&A at qa_rate, voice-leading into the goal at resolution_rate.",
    };
  } finally {
    await client.disconnect();
  }
}

export async function c64ComposerPalette(
  args: { composer: string; graphName?: string },
): Promise<{
  composer: string; tunes: number;
  patches: FamilyRow[]; motifs: FamilyRow[]; gestures: GestureRow[]; rhythms: RhythmRow[];
  song_forms: CountRow[]; voice_roles: Array<CountRow & { role: string }>; progressions: ProgressionRow[];
  phrases: PhraseRow[]; arps: ArpRow[]; timbre: TimbreProfile; timbre_gestures: TimbreGestureRow[];
  drums: DrumProfile; multiplex: MultiplexProfile;
  grammar: GrammarProfile; form: FormProfile; direction: DirectionProfile; note: string;
}> {
  const client = new FalkorHvscClient(args.graphName ? { graphName: args.graphName } : {});
  await client.connect();
  const name = normalizeName(args.composer);
  try {
    const tunesRows = await client.rawQuery<{ n: number }>(
      `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune) RETURN count(t) AS n`, { name });
    const patches = await client.rawQuery<FamilyRow>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_PATCH]->(f:PatchFamily)
       RETURN f.id AS id, f.key AS key, r.weight AS weight ORDER BY r.weight DESC LIMIT 12`, { name });
    const motifs = await client.rawQuery<FamilyRow>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_MOTIF]->(f:MotifFamily)
       RETURN f.id AS id, f.key AS key, r.weight AS weight ORDER BY r.weight DESC LIMIT 12`, { name });
    const gestures = await client.rawQuery<GestureRow>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_GESTURE]->(g:Gesture)
       RETURN g.kind AS kind, g.rate_frames AS rate_frames, g.depth_cents AS depth_cents, r.weight AS weight
       ORDER BY r.weight DESC, g.gesture_hash ASC LIMIT 12`, { name });
    const rhythms = await client.rawQuery<RhythmRow>(
      `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune)-[u:USES_RHYTHM]->(rc:RhythmCell)
       WITH rc, sum(u.occurrences) AS occ
       RETURN rc.slots AS slots, rc.n_notes AS n_notes, occ AS occurrences
       ORDER BY occ DESC, rc.rhythm_hash ASC LIMIT 12`, { name });
    const songForms = await client.rawQuery<{ label: string; count: number }>(
      `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune)
       WHERE t.repeat_shape IS NOT NULL
       RETURN t.repeat_shape AS label, count(t) AS count ORDER BY count DESC`, { name });
    const voiceRoles = await client.rawQuery<{ label: string; count: number }>(
      `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune)-[:HAS_VOICE]->(v:VoicePart)
       RETURN v.role AS label, count(v) AS count ORDER BY count DESC`, { name });
    const progressions = await client.rawQuery<{ degrees: string; length: number; weight: number }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_PROGRESSION]->(p:Progression)
       RETURN p.degrees AS degrees, p.length AS length, r.weight AS weight
       ORDER BY r.weight DESC, p.id ASC LIMIT 12`, { name });
    const phraseRows = await client.rawQuery<{
      intervals: string; iois: string; gates: string; n_notes: number; weight: number;
    }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_PHRASE]->(p:Phrase)
       RETURN p.intervals AS intervals, p.iois AS iois, p.gates AS gates, p.n_notes AS n_notes, r.weight AS weight
       ORDER BY r.weight DESC, p.id ASC LIMIT 12`, { name });
    const arpRows = await client.rawQuery<{ chord_intervals: string; cycle: string; n_steps: number; rate_frames: number; weight: number }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_ARP]->(a:Arp)
       RETURN a.chord_intervals AS chord_intervals, a.cycle AS cycle, a.n_steps AS n_steps, a.rate_frames AS rate_frames, r.weight AS weight
       ORDER BY r.weight DESC, a.id ASC LIMIT 8`, { name });
    const timbre = aggregateTimbre(await composerSidNative(client, name));
    const timbre_gestures = await queryTimbreGestures(client, name);
    const drums = (await c64DrumLookup({ composer: args.composer, graphName: args.graphName })).drums;
    const multiplex = (await c64MultiplexLookup({ composer: args.composer, graphName: args.graphName })).multiplex;
    const grammar = (await c64GrammarLookup({ composer: args.composer, graphName: args.graphName })).grammar;
    const form = (await c64FormLookup({ composer: args.composer, graphName: args.graphName })).form;
    const direction = (await c64DirectionLookup({ composer: args.composer, graphName: args.graphName })).direction;

    return {
      composer: args.composer,
      tunes: Number(tunesRows[0]?.n ?? 0),
      patches: patches.map((p) => ({ id: p.id, key: p.key, weight: Number(p.weight) })),
      motifs: motifs.map((m) => ({ id: m.id, key: m.key, weight: Number(m.weight) })),
      gestures: gestures.map((g) => ({ kind: g.kind, rate_frames: Number(g.rate_frames), depth_cents: Number(g.depth_cents), weight: Number(g.weight) })),
      rhythms: rhythms.map((r) => ({ slots: r.slots, n_notes: Number(r.n_notes), occurrences: Number(r.occurrences) })),
      song_forms: songForms.map((s) => ({ label: s.label, count: Number(s.count) })),
      voice_roles: voiceRoles.map((s) => ({ label: s.label, count: Number(s.count), role: s.label })),
      progressions: progressions.map((p) => ({
        degrees: p.degrees, length: Number(p.length), weight: Number(p.weight), roman: degreesToRoman(p.degrees),
      })),
      phrases: phraseRows.map((r) => {
        const iois = parseCsvInts(r.iois);
        const gates = parseCsvInts(r.gates);
        return {
          intervals: parseCsvInts(r.intervals), iois, gates,
          n_notes: Number(r.n_notes), weight: Number(r.weight),
          beats_hint: phraseBeatsHint(iois, gates),
        };
      }),
      arps: arpRows.map((r) => {
        const ci = parseCsvInts(r.chord_intervals);
        return { chord_intervals: ci, cycle: parseCsvInts(r.cycle), n_steps: Number(r.n_steps),
          rate_frames: Number(r.rate_frames), rate_hz: Math.round((50 / Math.max(1, Number(r.rate_frames))) * 10) / 10,
          quality: arpQuality(ci), weight: Number(r.weight) };
      }),
      timbre,
      timbre_gestures,
      drums,
      multiplex,
      grammar,
      form,
      direction,
      note: "One-call style palette: favoured patch/motif families, vibrato gestures, common rhythm cells, song-form distribution, voice-role conventions, chord progressions, fused pitch+rhythm phrases, arpeggio gestures, a mined timbre profile (PWM + shared-filter ranges → Voice.pwm / Score.filter), timbre_gestures (per-note PWM/filter articulation — pick top pwm gesture for lead PW motion and top filter gesture for routed voices; build Voice.timbre_gesture with center from patch pulse_width/filter center, depth from depth_band, template for per-frame shape), mined percussion rhythms (drums → Voice.drums), the melodic grammar (grammar → state hook + apply development ops instead of scales), and form-as-dynamics (form → build the arrangement along the energy arc, not flat). Compose a Score from these.",
    };
  } finally {
    await client.disconnect();
  }
}

// --- Multiplex lookup (SP-multiplex Part B, 2026-05-21) ---

export interface MultiplexProfile {
  n_voices: number;
  multiplex_rate: number;
  gap_fill_rate: number;                                  // mean over multiplexed voices
  common_role_pairs: Array<{ pair: string; count: number }>;
}

export function aggregateMultiplex(
  rows: Array<{ multiplex: boolean; role_set: string; gap_fill_rate: number }>,
): MultiplexProfile {
  const n = rows.length;
  const mux = rows.filter((r) => r.multiplex);
  const pairs: Record<string, number> = {};
  for (const r of mux) {
    const key = r.role_set || "";
    if (key.includes(",")) pairs[key] = (pairs[key] ?? 0) + 1;
  }
  const meanGap = mux.length ? mux.reduce((s, r) => s + (Number(r.gap_fill_rate) || 0), 0) / mux.length : 0;
  return {
    n_voices: n,
    multiplex_rate: n ? Math.round((mux.length / n) * 1000) / 1000 : 0,
    gap_fill_rate: Math.round(meanGap * 1000) / 1000,
    common_role_pairs: Object.entries(pairs).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6).map(([pair, count]) => ({ pair, count })),
  };
}

export async function c64MultiplexLookup(
  args: { composer: string; graphName?: string },
): Promise<{ multiplex: MultiplexProfile; note: string }> {
  const client = new FalkorHvscClient(args.graphName ? { graphName: args.graphName } : {});
  await client.connect();
  try {
    const rows = await client.rawQuery<{ multiplex: boolean; role_set: string; gap_fill_rate: number }>(
      `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune)-[:HAS_VOICE]->(v:VoicePart)
       RETURN v.multiplex AS multiplex, v.role_set AS role_set, v.gap_fill_rate AS gap_fill_rate`,
      { name: normalizeName(args.composer) });
    const mp = aggregateMultiplex(rows.map((r) => ({
      multiplex: !!r.multiplex, role_set: r.role_set ?? "", gap_fill_rate: Number(r.gap_fill_rate) || 0,
    })));
    const top = mp.common_role_pairs[0];
    return {
      multiplex: mp,
      note: `${Math.round(mp.multiplex_rate * 100)}% of ${mp.n_voices} voices multiplex` +
        (top ? `; most common pairing '${top.pair}'` : "") +
        `; mean gap-fill ${Math.round(mp.gap_fill_rate * 100)}%. Compose by interleaving the second role into the first voice's gaps (drums into an arp/lead's rests; mix_check screens for stutter).`,
    };
  } finally {
    await client.disconnect();
  }
}
