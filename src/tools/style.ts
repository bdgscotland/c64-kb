/** style_proximity (Wave 3): grade how in-style a draft's choices are vs a
 * target composer's FAVORS palette. Read-only over c64_hvsc. */
import { createHash } from "node:crypto";
import { FalkorHvscClient, normalizeName } from "../services/falkor-hvsc.js";
import { patchFamilyKey, motifContourKey, type RawPatch, parseChordSymbol, tonicPcFromKeyName, collapseRuns, progressionDegreesString, type HarmonyChord } from "../hvsc/mine.js";
import { aggregateTimbre, type TimbreProfile } from "./palette-mcp.js";

const ADSR_TOLERANCE = 4; // must match clusterPatchesInGraph

function familyId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/** Longest contiguous run of equal chord tokens shared by a and b. */
function longestCommonRun(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const dp = new Array<number>(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : 0;
      if (dp[j] > best) best = dp[j];
      prev = tmp;
    }
  }
  return best;
}

export interface ScoreTimbre {
  pwm: Array<{ depth: number; center: number }>;
  filter: { active: boolean } | null;
}

/** Timbre proximity: does the draft use PWM/filter the way the composer does?
 * PWM expected when the composer's mean depth is non-trivial; filter expected when
 * he engages it often. Absent-but-not-expected costs nothing. */
export function timbreProximity(
  st: ScoreTimbre | undefined, comp: TimbreProfile,
): { score: number; in_palette: boolean } {
  const pwmExpected = comp.pwm.depth >= 50;
  const pwmPresent = !!st?.pwm?.some((p) => p.depth > 0);
  const pwmOk = pwmExpected ? pwmPresent : true;
  const filterExpected = comp.filter.active_fraction >= 0.15;
  const filterPresent = !!st?.filter?.active;
  const filterOk = filterExpected ? filterPresent : true;
  const score = (Number(pwmOk) + Number(filterOk)) / 2;
  return { score, in_palette: score >= 0.5 };
}

/** Drum proximity: does the draft's inter-hit rhythm match the composer's mined
 * percussion rhythms? Longest contiguous run of equal 16th-grid spacings. */
export function drumProximity(
  scoreIois: number[], composerRhythms: number[][],
): { score: number; in_palette: boolean } {
  if (scoreIois.length === 0 || composerRhythms.length === 0) return { score: 0, in_palette: false };
  let best = 0;
  for (const r of composerRhythms) {
    const run = longestCommonRun(scoreIois.map(String), r.map(String));
    if (run > best) best = run;
  }
  const score = best >= 2 ? Math.min(1, best / Math.max(2, scoreIois.length)) : 0;
  return { score, in_palette: best >= 2 };
}

export interface StyleVoice {
  patch: { waveform: string; adsr: number[]; hard_restart?: string; filter_routed?: boolean };
  vibrato?: { rate_frames: number; depth_cents: number } | null;
  /** Per-note PWM or filter articulation for this voice. Absent = not penalized.
   *  kind + archetype form the primary match key (chip-agnostic); depth_band/rate_band
   *  are stored but not used for matching because the 6581/8580 filter-cutoff ranges
   *  differ and make absolute bands chip-relative. */
  timbre_gesture?: { kind: "pwm" | "filter"; archetype: string; depth_band?: string; rate_band?: string } | null;
  midis: number[];
  onsets?: number[];  // per-note onset time in beats
  gates?: number[];   // per-note duration (gate) in beats
  arp?: { chord_intervals: number[]; cycle: number[]; rate_frames: number };
}

export interface VoiceProximity {
  patch_in_palette: boolean;
  motif_in_palette: boolean;
  phrase_in_palette: boolean;
  arp_in_palette: boolean;
  gesture_in_palette: boolean;
  timbre_gesture_in_palette: boolean;
  score: number;
}

export interface StylePalette {
  patches: string[];   // top favoured PatchFamily keys (e.g. "0,2,2,3|pulse|false|hr") — aim adsr/4 here
  motifs: string[];    // top favoured motif contours (e.g. "1,-1,1")
  gestures: Array<{ rate_frames: number; depth_cents: number }>;
}

export async function styleProximity(
  args: { composer: string; voices: StyleVoice[]; graphName?: string;
          chords?: string[]; key?: string; mode?: "major" | "minor";
          timbre?: ScoreTimbre; drums?: number[] },
): Promise<{ composer: string; in_style_pct: number; per_voice: VoiceProximity[];
            palette: StylePalette; harmony_in_palette?: boolean;
            closest_progression?: string; timbre_in_palette?: boolean;
            drum_in_palette?: boolean; note: string }> {
  const client = new FalkorHvscClient(args.graphName ? { graphName: args.graphName } : {});
  await client.connect();
  const name = normalizeName(args.composer);
  try {
    const patchRows = await client.rawQuery<{ id: string; key: string; w: number }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_PATCH]->(f:PatchFamily)
       RETURN f.id AS id, f.key AS key, r.weight AS w ORDER BY r.weight DESC`, { name });
    const favPatch = new Set(patchRows.map((r) => r.id));
    const motifRows = await client.rawQuery<{ key: string; w: number }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_MOTIF]->(f:MotifFamily)
       RETURN f.key AS key, r.weight AS w ORDER BY r.weight DESC`, { name });
    const favMotif = new Set(motifRows.map((r) => r.key));
    const favGesture = await client.rawQuery<{ rate: number; depth: number; w: number }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_GESTURE]->(g:Gesture)
       RETURN g.rate_frames AS rate, g.depth_cents AS depth, r.weight AS w ORDER BY r.weight DESC`, { name });
    const favGestureSet = new Set(favGesture.map((g) => `${Number(g.rate)}|${Number(g.depth)}`));

    // Query the composer's favoured timbre gestures (T2/T3 layer: FAVORS_TIMBRE_GESTURE).
    // Match key: `${kind}|${archetype}` — the archetype encodes the shape of the trajectory
    // (sweep_up, slow_sweep, cutoff_dip, etc.) and is the salient perceptual axis.
    // depth_band and rate_band are NOT used for matching because the 6581/8580 chips have
    // different filter-cutoff ranges, making absolute bands chip-relative; using them would
    // produce false negatives when comparing tunes across chip revisions. Absent timbre gesture
    // on a draft voice is treated identically to absent vibrato: not penalized, and the
    // dimension is only folded into the per-voice score when the voice supplies one.
    const favTimbreGestureRows = await client.rawQuery<{ kind: string; archetype: string; w: number }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_TIMBRE_GESTURE]->(g:Gesture)
       RETURN g.kind AS kind, g.archetype AS archetype, r.weight AS w
       ORDER BY r.weight DESC`, { name });
    const favTimbreGestureSet = new Set(favTimbreGestureRows.map((g) => `${g.kind}|${g.archetype}`));

    // Query favoured phrases (FAVORS_PHRASE). p.intervals/iois/gates are comma-strings
    // of 16th-grid integers stored at upsert time.
    const favPhraseRows = await client.rawQuery<{ intervals: string; iois: string; gates: string }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_PHRASE]->(p:Phrase)
       RETURN p.intervals AS intervals, p.iois AS iois, p.gates AS gates ORDER BY r.weight DESC, p.id ASC LIMIT 5000`, { name });
    const havePhrases = favPhraseRows.length > 0;

    // Build palette phrase key set + interleaved token arrays for partial matching.
    // Palette values are already 16th-grid ints — no re-quantization needed.
    const palettePhraseKeys = new Set<string>();
    const palettePhraseTokens: string[][] = [];
    for (const row of favPhraseRows) {
      const ivs = row.intervals.split(",").map(Number);
      const is_ = row.iois.split(",").map(Number);
      const gs = row.gates.split(",").map(Number);
      const n = gs.length; // 5
      // Build phraseKey to match the mining convention
      const key = ivs.join(",") + "|" + is_.map((io, i) => `${io}:${gs[i]}`).join(";");
      palettePhraseKeys.add(key);
      // Interleaved token array: [ g_0, iv_0, g_1, iv_1, ..., iv_{n-2}, g_{n-1} ]
      const tokens: string[] = [];
      for (let k = 0; k < n; k++) {
        tokens.push(`${is_[k]}:${gs[k]}`); // rhythm token g_k
        if (k < n - 1) tokens.push(`${ivs[k]}`); // pitch token iv_k
      }
      palettePhraseTokens.push(tokens);
    }

    const favArpRows = await client.rawQuery<{ chord_intervals: string; cycle: string; rate_frames: number }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_ARP]->(a:Arp)
       RETURN a.chord_intervals AS chord_intervals, a.cycle AS cycle, a.rate_frames AS rate_frames ORDER BY r.weight DESC, a.id ASC LIMIT 5000`, { name });
    const haveArps = favArpRows.length > 0;
    const palArps = favArpRows.map((r) => ({ ci: r.chord_intervals, cy: r.cycle, rate: Number(r.rate_frames) }));
    const palArpKeys = new Set(palArps.map((a) => `${a.ci}|${a.cy}|r${a.rate}`));

    // Timbre dimension (SP-timbre): aggregate the composer's sid_native, score the
    // draft's PWM/filter usage against it. Tune-level, like harmony.
    const compTimbre = aggregateTimbre(
      (await client.rawQuery<{ sn: string }>(
        `MATCH (t:Tune)-[:COMPOSED_BY]->(c:Composer {name: $name}) RETURN t.sid_native AS sn`, { name },
      )).map((r) => { try { return JSON.parse(r.sn || "{}"); } catch { return {}; } }),
    );
    let timbre_in_palette: boolean | undefined;
    let timbreScore = 0;
    let timbreEvaluated = false;
    if (compTimbre.n_tunes > 0) {
      const tp = timbreProximity(args.timbre, compTimbre);
      timbreScore = tp.score;
      timbre_in_palette = tp.in_palette;
      timbreEvaluated = true;
    }

    // Drum dimension (SP-drums): score the draft's inter-hit rhythm vs his mined
    // percussion rhythms. Tune-level, like timbre/harmony.
    let drum_in_palette: boolean | undefined;
    let drumScore = 0;
    let drumEvaluated = false;
    if (args.drums && args.drums.length > 0) {
      const percRows = await client.rawQuery<{ iois: string }>(
        `MATCH (c:Composer {name: $name})<-[:COMPOSED_BY]-(t:Tune)-[:HAS_VOICE]->(v:VoicePart {role:'percussion'})-[u:USES_PHRASE]->(p:Phrase)
         WITH p, sum(u.occurrences) AS occ
         RETURN p.iois AS iois ORDER BY occ DESC, p.id ASC LIMIT 25`, { name });
      if (percRows.length > 0) {
        const rhythms = percRows.map((r) => r.iois.split(",").map((x) => parseInt(x, 10)));
        const dp = drumProximity(args.drums, rhythms);
        drumScore = dp.score;
        drum_in_palette = dp.in_palette;
        drumEvaluated = true;
      }
    }

    const palette: StylePalette = {
      patches: patchRows.slice(0, 8).map((r) => r.key),
      motifs: motifRows.slice(0, 8).map((r) => r.key),
      gestures: favGesture.slice(0, 8).map((g) => ({ rate_frames: Number(g.rate), depth_cents: Number(g.depth) })),
    };

    let harmony_in_palette: boolean | undefined;
    let closest_progression: string | undefined;
    let harmonyScore = 0;
    // Only count harmony as a dimension when the composer actually HAS mined
    // progressions — otherwise an empty palette would dilute in_style_pct with a
    // phantom 0 and report a misleading harmony_in_palette:false on no evidence.
    let harmonyEvaluated = false;
    const haveChords = (args.chords?.length ?? 0) > 0 && !!args.key;
    if (haveChords) {
      const keyPc = tonicPcFromKeyName(args.key);
      const scoreChords: HarmonyChord[] = [];
      for (const sym of args.chords!) {
        const parsed = parseChordSymbol(sym);
        if (parsed && keyPc !== null) {
          scoreChords.push({ degree: ((parsed.root_pc - keyPc) % 12 + 12) % 12, quality: parsed.quality });
        }
      }
      const collapsed = collapseRuns(scoreChords, (a, b) => a.degree === b.degree && a.quality === b.quality);
      const sTokens = progressionDegreesString(collapsed).split("-").filter((t) => t.length > 0);
      const favProg = await client.rawQuery<{ degrees: string }>(
        `MATCH (c:Composer {name: $name})-[r:FAVORS_PROGRESSION]->(p:Progression)
         RETURN p.degrees AS degrees ORDER BY r.weight DESC, p.id ASC LIMIT 50`, { name });
      if (favProg.length > 0) {
        let best = 0;
        for (const fp of favProg) {
          const pTokens = fp.degrees.split("-");
          let s: number;
          if (sTokens.join("-") === fp.degrees) s = 1.0;
          else { const run = longestCommonRun(sTokens, pTokens); s = run >= 2 && sTokens.length > 0 ? run / sTokens.length : 0; }
          if (s > best) { best = s; closest_progression = fp.degrees; }
        }
        harmonyScore = best;
        harmony_in_palette = best >= 0.5;
        harmonyEvaluated = true;
      }
    }

    // q: beats → 16th-grid units
    const q = (beats: number) => Math.max(1, Math.round(beats * 4));

    const per_voice: VoiceProximity[] = args.voices.map((v) => {
      const raw: RawPatch = {
        patch_hash: "", adsr: v.patch.adsr, waveform: v.patch.waveform,
        filter_routed: v.patch.filter_routed ?? false, hard_restart: v.patch.hard_restart ?? "",
      };
      const patch_in_palette = favPatch.has(familyId(patchFamilyKey(raw, ADSR_TOLERANCE)));

      let motif_in_palette = false;
      for (let i = 0; i + 4 <= v.midis.length; i++) {
        const win = v.midis.slice(i, i + 4);
        const intervals = [win[1] - win[0], win[2] - win[1], win[3] - win[2]];
        if (favMotif.has(motifContourKey(intervals))) { motif_in_palette = true; break; }
      }

      let gesture_in_palette = false;
      if (v.vibrato) {
        const qDepth = Math.round(v.vibrato.depth_cents / 10) * 10;
        gesture_in_palette = favGestureSet.has(`${v.vibrato.rate_frames}|${qDepth}`);
      }

      // Phrase check — only attempted when the composer has phrases AND the voice
      // supplies per-note onset/gate timing with the correct array lengths.
      const usePhrase = havePhrases &&
        !!v.onsets && !!v.gates &&
        v.onsets.length === v.midis.length &&
        v.gates.length === v.midis.length;

      let phrase_in_palette = false;
      if (usePhrase) {
        const onsets = v.onsets!;
        const gates = v.gates!;
        const midis = v.midis;
        outer: for (let i = 0; i + 5 <= midis.length; i++) {
          // Build intervals (4 values) for window i..i+4
          const ivs: number[] = [];
          for (let j = 0; j < 4; j++) ivs.push(midis[i + 1 + j] - midis[i + j]);
          // Build quantized iois (5 values): j=0..3 = spacing to next; j=4 = last note's gate
          const qIois: number[] = [];
          for (let j = 0; j < 4; j++) qIois.push(q(onsets[i + 1 + j] - onsets[i + j]));
          qIois.push(q(gates[i + 4]));
          // Build quantized gates (5 values)
          const qGates: number[] = [];
          for (let k = 0; k < 5; k++) qGates.push(q(gates[i + k]));
          // Candidate phraseKey
          const candidateKey = ivs.join(",") + "|" + qIois.map((io, idx) => `${io}:${qGates[idx]}`).join(";");
          // Exact match
          if (palettePhraseKeys.has(candidateKey)) { phrase_in_palette = true; break; }
          // Interleaved token array for partial match
          const candidateTokens: string[] = [];
          for (let k = 0; k < 5; k++) {
            candidateTokens.push(`${qIois[k]}:${qGates[k]}`);
            if (k < 4) candidateTokens.push(`${ivs[k]}`);
          }
          for (const palTokens of palettePhraseTokens) {
            if (longestCommonRun(candidateTokens, palTokens) >= 5) {
              phrase_in_palette = true;
              break outer;
            }
          }
        }
      }

      let arp_in_palette = false;
      const useArp = haveArps && !!v.arp;
      if (useArp) {
        const ciStr = v.arp!.chord_intervals.join(",");
        const cyStr = v.arp!.cycle.join(",");
        const candKey = `${ciStr}|${cyStr}|r${v.arp!.rate_frames}`;
        arp_in_palette = palArpKeys.has(candKey) ||
          palArps.some((a) => a.ci === ciStr && a.cy === cyStr && Math.abs(a.rate - v.arp!.rate_frames) <= 1);
      }

      // Timbre-gesture dimension: score the voice's per-note PWM/filter articulation
      // against the composer's FAVORS_TIMBRE_GESTURE palette. Primary match key is
      // `kind|archetype` (chip-agnostic shape of the trajectory). Absent = not penalized,
      // mirroring the vibrato gesture_in_palette semantics: the dimension is only added
      // to `terms` when the voice declares a timbre_gesture. A present-but-off-palette
      // gesture contributes 0; a matching one contributes 1.
      let timbre_gesture_in_palette = false;
      const useTimbreGesture = !!v.timbre_gesture && favTimbreGestureSet.size > 0;
      if (useTimbreGesture) {
        const tgKey = `${v.timbre_gesture!.kind}|${v.timbre_gesture!.archetype}`;
        timbre_gesture_in_palette = favTimbreGestureSet.has(tgKey);
      }

      // When the voice supplies rhythm and the composer has phrases, phrase
      // supersedes motif as the melodic dimension; otherwise fall back to motif.
      const melodic = usePhrase ? phrase_in_palette : motif_in_palette;
      const terms = [Number(patch_in_palette), Number(melodic), Number(gesture_in_palette)];
      if (useArp) terms.push(Number(arp_in_palette));
      if (useTimbreGesture) terms.push(Number(timbre_gesture_in_palette));
      const score = terms.reduce((s, x) => s + x, 0) / terms.length;
      return { patch_in_palette, motif_in_palette, phrase_in_palette, arp_in_palette, gesture_in_palette, timbre_gesture_in_palette, score };
    });

    const allScores = per_voice.map((v) => v.score);
    if (harmonyEvaluated) allScores.push(harmonyScore);
    if (timbreEvaluated) allScores.push(timbreScore);
    if (drumEvaluated) allScores.push(drumScore);
    const in_style_pct = allScores.length
      ? Math.round((allScores.reduce((s, x) => s + x, 0) / allScores.length) * 1000) / 10
      : 0;
    return {
      composer: args.composer, in_style_pct, per_voice, palette,
      harmony_in_palette, closest_progression, timbre_in_palette, drum_in_palette,
      note: "Per-voice in-palette checks (patch, motif/phrase, vibrato-gesture, arp; timbre-gesture when declared) + tune-level harmony (when chords given) + timbre-presence (PWM/filter vs sid_native) + drum dimension (percussion rhythm vs mined patterns). A compass for iteration, not a grade.",
    };
  } finally {
    await client.disconnect();
  }
}
