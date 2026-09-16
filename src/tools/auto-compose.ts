// NOTE: this tool shells out to the sid-stylometry research scripts,
// which are not part of the public KB distribution.
/** Auto-composer (SP-autocompose, 2026-05-21): a deterministic, seedable,
 * palette-driven "compose in style X" driver. Encodes the validated SID
 * generation recipe (what gen-hubbard-complete.py did by hand) into one call.
 *
 * Core is the PURE `buildScore(palette, opts)` — palette in, Score out, no DB,
 * no rendering — so the eval gets system-generated stimuli + ablations.
 * `autoCompose` is the thin async wrapper that fetches the palette. */
import type {
  FamilyRow, GestureRow, RhythmRow, CountRow, ProgressionRow,
  PhraseRow, ArpRow, TimbreProfile, DrumProfile, MultiplexProfile,
} from "./palette-mcp.js";
import { c64ComposerPalette } from "./palette-mcp.js";
import { degreesToChordSymbols, composeScore } from "./compose-run.js";
import { tonicPcFromKeyName } from "../hvsc/mine.js";
import { deriveScaffold } from "./scaffold.js";
import { FalkorHvscClient, normalizeName } from "../services/falkor-hvsc.js";
import { saliencizePalette } from "./salience.js";

/** The one-call style palette (return shape of c64ComposerPalette). */
export interface ComposerPalette {
  composer: string;
  tunes: number;
  patches: FamilyRow[];
  motifs: FamilyRow[];
  gestures: GestureRow[];
  rhythms: RhythmRow[];
  song_forms: CountRow[];
  voice_roles: Array<CountRow & { role: string }>;
  progressions: ProgressionRow[];
  phrases: PhraseRow[];
  arps: ArpRow[];
  timbre: TimbreProfile;
  drums: DrumProfile;
  multiplex: MultiplexProfile;
}

export type Ablation = "none" | "scramble_palette" | "no_timbre" | "generic_phrases";

export interface BuildOpts {
  seed?: number;
  ablation?: Ablation;
  key?: string;
  mode?: "major" | "minor";
  maxBars?: number;
  tempo?: number;
  /** Required when ablation === "scramble_palette": the alternate composer's palette. */
  scramblePalette?: ComposerPalette;
}

export interface BuildResult {
  score: Record<string, any>;
  plan: {
    form: string; key: string; mode: string; tempo: number;
    scaffold: { third: "arp" | "drums" | null; bass: "driving" | "sparse"; multiplex: boolean };
    sections: Array<{ label: string; bars: number; chords: string[]; drum_mode: string }>;
  };
  screen: { drum_density: number; stutter_score: number; verdict: "ok" | "drum wash" | "stuttery"; retries: number };
  palette_used: {
    patches: string[]; phrases: number; progressions: string[];
    timbre: boolean; drums: boolean; multiplex: boolean; ablation: Ablation; seed: number;
  };
}

const _PC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BARS_PER_SECTION = 4;
const DRUM_DENSITY_MAX = 10; // mirror mix_check's gate
const STUTTER_MAX = 0.10;

/** Deterministic 32-bit PRNG. Same seed → same sequence (no Date/Math.random). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


/** Max absolute cumulative pitch offset of a phrase contour (its register span). */
function phraseRange(intervals: number[]): number {
  let acc = 0, max = 0;
  for (const d of intervals) { acc += d; max = Math.max(max, Math.abs(acc)); }
  return max;
}

/** Parse a PatchFamily key "a,d,s,r|waveform|filter_routed|hr" → patch parts. */
function parsePatchKey(key: string): { waveform: string; adsr: number[]; filter_routed: boolean } {
  const [adsrStr = "0,0,0,0", waveform = "pulse", routed = "false"] = (key ?? "").split("|");
  const adsr = adsrStr.split(",").map((x) => parseInt(x, 10));
  return {
    waveform: waveform || "pulse",
    adsr: adsr.length === 4 && adsr.every(Number.isFinite) ? adsr : [0, 0, 0, 0],
    filter_routed: routed === "true",
  };
}

function chordRootPc(sym: string): number {
  const m = (sym ?? "").match(/^([A-G]#?)/);
  return m ? Math.max(0, _PC.indexOf(m[1])) : 0;
}

function clamp(x: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, x)); }

const GENERIC_PHRASE: PhraseRow = {
  intervals: [2, -2, 2, -2], iois: [2, 2, 2, 2, 2], gates: [2, 2, 2, 2, 2], n_notes: 5, weight: 1,
  beats_hint: { iois_beats: [0.5, 0.5, 0.5, 0.5, 0.5], gates_beats: [0.5, 0.5, 0.5, 0.5, 0.5] },
};

export function buildScore(palette: ComposerPalette, opts: BuildOpts = {}): BuildResult {
  const seed = opts.seed ?? 1;
  const ablation = opts.ablation ?? "none";
  const key = opts.key ?? "C";
  const mode = opts.mode ?? "minor";
  const maxBars = opts.maxBars ?? 24;
  // Structural scaffold from the composer's ontology (form/voices/bass/tempo) —
  // structure always comes from X (palette), even under scramble_palette.
  const scaffold = deriveScaffold(palette, opts.tempo ?? 128);
  const tempo = scaffold.tempo;
  const beatsPerBar = 4;
  const keyPc = tonicPcFromKeyName(key) ?? 0;
  const framesPerBeat = Math.max(1, Math.round(3000 / tempo));
  const rnd = mulberry32(seed);

  // STRUCTURE (arc/form, role mix) always comes from X; IDENTITY vocabulary
  // (progressions/phrases/patches/timbre/drums/gestures) comes from `vocab`,
  // which the scramble_palette ablation swaps to another composer.
  const vocab = ablation === "scramble_palette" && opts.scramblePalette ? opts.scramblePalette : palette;
  const noTimbre = ablation === "no_timbre";
  const genericPhrases = ablation === "generic_phrases";

  // --- 1. Arc: section labels from the composer's structural scaffold (ontology) ---
  const body = scaffold.form.slice(1).length ? scaffold.form.slice(1) : ["A"];
  const home = body[0] ?? "A";
  const nSections = Math.max(2, Math.floor(maxBars / BARS_PER_SECTION));
  const arcLabels: string[] = ["intro"];
  for (let i = 0; i < nSections - 1; i++) arcLabels.push(body[i % body.length]);

  // --- 2. Harmony: home + contrasting progression from the vocab ---
  // Mode-respect (fix: 2026-05-25 finding §8c) — when mode=minor/major is
  // requested, prefer progressions whose tonic chord matches that mode. The
  // live Hubbard palette orders 0maj-rooted progressions before 0min-rooted
  // ones, so the previous `find(startsTonic)` collapsed mode=minor → A-D-A-D.
  // Progression degrees use the 3-letter quality form ("0min", "8maj"); the
  // public `mode` arg is the full word ("minor"|"major") — bridge with modeShort.
  const modeShort = mode === "minor" ? "min" : "maj";
  const fallbackProg: ProgressionRow = { degrees: `0${modeShort}`, length: 1, weight: 1, roman: "i" };
  const progs = vocab.progressions.length ? vocab.progressions : [fallbackProg];
  const startsTonic = (p: ProgressionRow) => /^0(maj|min)/.test(p.degrees);
  const startsTonicInMode = (p: ProgressionRow) => p.degrees.startsWith(`0${modeShort}`);
  const homeProg = progs.find(startsTonicInMode) ?? progs.find(startsTonic) ?? progs[0];
  const contrastProg = progs.find((p) => p.degrees !== homeProg.degrees && !startsTonic(p))
    ?? progs.find((p) => p.degrees !== homeProg.degrees) ?? homeProg;
  const progFor = (label: string) => (label === home ? homeProg : contrastProg);

  // --- map sections → bars + per-bar chords ---
  const sections: Array<{ label: string; start_bar: number; bars: number; chords: string[]; drum_mode: string; lead: boolean }> = [];
  let barCursor = 0;
  const lastBodyIdx = arcLabels.length - 1;
  for (let i = 0; i < arcLabels.length; i++) {
    const label = arcLabels[i];
    const isIntro = label === "intro";
    let bars = BARS_PER_SECTION;
    if (i === arcLabels.length - 1) bars = maxBars - barCursor; // last section absorbs remainder
    if (bars <= 0) break;
    const syms = isIntro
      ? degreesToChordSymbols(homeProg.degrees, keyPc)
      : degreesToChordSymbols(progFor(label).degrees, keyPc);
    const chordSyms = syms.length ? syms : [_PC[keyPc] + (mode === "minor" ? "m" : "")];
    const chords = Array.from({ length: bars }, (_, b) => chordSyms[b % chordSyms.length]);
    const drum_mode = isIntro ? "hat" : i === lastBodyIdx ? "fill" : "full";
    sections.push({ label, start_bar: barCursor, bars, chords, drum_mode, lead: !isIntro });
    barCursor += bars;
  }
  const totalBars = barCursor;

  // --- 3. Lead voice: singable mined phrases (or generic filler), voicing findings baked in ---
  const singable = vocab.phrases.filter((p) => phraseRange(p.intervals) <= 12);
  const leadPhrasePool = genericPhrases ? [GENERIC_PHRASE] : (singable.length ? singable : [GENERIC_PHRASE]);
  const phraseSpan = (ph: PhraseRow) => Math.max(0.5, ph.beats_hint.iois_beats.reduce((s, x) => s + x, 0));
  const rotation = Math.floor(rnd() * leadPhrasePool.length);
  const leadPhrases: any[] = [];
  let placement = 0;
  // Place his real phrases BACK-TO-BACK across each lead section — a continuous
  // melodic line (a busy Hubbard lead), not one isolated lick every two bars.
  for (const sec of sections) {
    if (!sec.lead) continue;
    const secEnd = (sec.start_bar + sec.bars) * beatsPerBar;
    const anchor = sec.label === home ? 72 : 76; // contrast sections sit higher
    let beat = sec.start_bar * beatsPerBar;
    while (beat < secEnd - 0.01) {
      const ph = leadPhrasePool[(placement + rotation) % leadPhrasePool.length];
      leadPhrases.push({
        intervals: ph.intervals,
        iois: ph.beats_hint.iois_beats,
        gates: ph.beats_hint.gates_beats,
        anchor_midi: anchor, transpose: 0, at_beats: [Math.round(beat * 4) / 4],
      });
      beat += phraseSpan(ph);
      placement++;
    }
  }

  const topPatch = vocab.patches.find((p) => !p.key.includes("noise")) ?? vocab.patches[0];
  const pp = topPatch ? parsePatchKey(topPatch.key) : { waveform: "pulse", adsr: [0, 0, 3, 3], filter_routed: true };
  const [a, d, s, r] = pp.adsr;
  // Voicing findings: small attack (≥3) so the lead doesn't stab, off-square pulse
  // width, drop the per-note hard-restart (it clicks before every note). But KEEP the
  // mined decay/sustain/release character — flooring sustain high turned his plucky
  // lead into a sustained pad (the "not really Hubbard" identity loss). Floor release
  // just enough to avoid a clicky tail.
  const leadPatch = { waveform: pp.waveform || "pulse", adsr: [Math.max(3, a), d, s, Math.max(4, r)], pulse_width: 2400, hard_restart: "" };

  const gesture = vocab.gestures[0];
  const leadVoice: any = {
    voice: 1, sid_chip: 1, role: "lead", harmonize: true,
    route_to_filter: !noTimbre,
    patch: leadPatch,
    phrases: leadPhrases, notes: [], arps: [], drums: [],
  };
  if (!noTimbre) {
    leadVoice.pwm = { rate_frames: 28, depth: clamp(Math.round(vocab.timbre.pwm.depth) || 160, 80, 320), center: 2400, shape: "sine", onset_delay_frames: 8 };
  }
  if (gesture) leadVoice.vibrato = { rate_frames: gesture.rate_frames, depth_cents: gesture.depth_cents, onset_delay_frames: 8 };

  // --- 4. Bass voice: style from the scaffold (driving octave 8ths vs sparse roots) ---
  const driving = scaffold.bass === "driving";
  const bassNotes: any[] = [];
  for (const sec of sections) {
    for (let b = 0; b < sec.bars; b++) {
      const globalBar = sec.start_bar + b;
      const root = 36 + chordRootPc(sec.chords[b]);
      if (driving) {
        for (let k = 0; k < 8; k++) bassNotes.push({ beat: globalBar * 4 + k * 0.5, dur_beats: 0.45, midi: root + (k % 2 ? 12 : 0) });
      } else {
        bassNotes.push({ beat: globalBar * 4, dur_beats: 1.6, midi: root });
        bassNotes.push({ beat: globalBar * 4 + 2, dur_beats: 1.6, midi: root });
      }
    }
  }
  const bassVoice: any = {
    voice: 2, sid_chip: 1, role: "bass", harmonize: false,
    patch: { waveform: "triangle", adsr: [0, 4, 8, 6], pulse_width: 2048, hard_restart: "" },
    notes: bassNotes, phrases: [], arps: [], drums: [],
  };

  // --- 5. Third voice from the scaffold: drums OR arp OR none (per the role mix) ---
  const drums: any[] = [];
  const thirdVoices: any[] = [];
  if (scaffold.third === "drums") {
    for (const sec of sections) {
      for (let b = 0; b < sec.bars; b++) {
        const s0 = (sec.start_bar + b) * 4;
        const isLastBar = b === sec.bars - 1;
        if (sec.drum_mode === "hat" || sec.drum_mode === "full" || sec.drum_mode === "fill") {
          for (const x of [0.5, 1.5, 2.5, 3.5]) drums.push({ type: "hihat", beat: s0 + x });
        }
        if (sec.drum_mode === "full" || sec.drum_mode === "fill") {
          drums.push({ type: "snare", beat: s0 + 1 }, { type: "snare", beat: s0 + 3 });
        }
        if (sec.drum_mode === "fill" && isLastBar) {
          drums.push({ type: "snare", beat: s0 + 3.25 }, { type: "snare", beat: s0 + 3.75 }, { type: "hihat", beat: s0 + 3.0 });
        }
      }
    }
    thirdVoices.push({ voice: 3, sid_chip: 1, role: "percussion", route_to_filter: !noTimbre, drums, notes: [], phrases: [], arps: [] });
  } else if (scaffold.third === "arp") {
    // chord-following arp at the composer's mined rate (their shimmer)
    const arpRate = vocab.arps[0]?.rate_frames || 4;
    const arpNotes: any[] = [];
    for (const sec of sections) {
      for (let b = 0; b < sec.bars; b++) {
        const gb = sec.start_bar + b;
        const sym = sec.chords[b];
        const cyc = /m$/.test(sym) ? [0, 3, 7] : [0, 4, 7];
        arpNotes.push({ root_midi: 48 + chordRootPc(sym), chord_intervals: cyc, cycle: cyc, rate_frames: arpRate, at_beats: [gb * 4], dur_beats: beatsPerBar, transpose: 0 });
      }
    }
    thirdVoices.push({
      voice: 3, sid_chip: 1, role: "arp", harmonize: false, route_to_filter: !noTimbre,
      patch: { waveform: pp.waveform || "pulse", adsr: [0, 2, 5, 2], pulse_width: 2048, hard_restart: "" },
      arps: arpNotes, notes: [], phrases: [],
    });
  }

  // --- 6. Shared LP filter (Hubbard's own tool, used sparingly) ---
  const filter = noTimbre ? null : {
    mode: vocab.timbre.filter.dominant_mode === "off" ? "lp" : (vocab.timbre.filter.dominant_mode || "lp"),
    resonance: clamp(Math.round(vocab.timbre.filter.resonance_mean) + 1, 2, 5),
    cutoff_center: 1600, lfo_rate_frames: 120, lfo_depth: 300, lfo_shape: "sine",
  };

  const score: Record<string, any> = {
    meta: { title: `${palette.composer} (auto)`, key, mode, tempo_bpm: tempo, beats_per_bar: beatsPerBar, region: "PAL", target_composer: palette.composer },
    sections: sections.map((s) => ({ label: s.label, start_bar: s.start_bar, bars: s.bars, chords: s.chords })),
    voices: [leadVoice, bassVoice, ...thirdVoices],
  };
  if (filter) score.filter = filter;

  // --- 7. Score-derivable mix_check screen (+ deterministic drum thinning) ---
  let retries = 0;
  let density = drums.length / Math.max(1, totalBars);
  while (density > DRUM_DENSITY_MAX && drums.length > 0) {
    // thin hihats first (every other one) until under the wash gate
    for (let i = drums.length - 1; i >= 0 && density > DRUM_DENSITY_MAX; i -= 2) {
      if (drums[i].type === "hihat") { drums.splice(i, 1); density = drums.length / Math.max(1, totalBars); }
    }
    retries++;
    if (retries > 8) break;
  }
  const stutter = computeStutter([leadVoice, bassVoice], framesPerBeat, beatsPerBar);
  const verdict: "ok" | "drum wash" | "stuttery" =
    stutter > STUTTER_MAX ? "stuttery" : density > DRUM_DENSITY_MAX ? "drum wash" : "ok";

  return {
    score,
    plan: {
      form: scaffold.form.join(""), key, mode, tempo,
      scaffold: { third: scaffold.third, bass: scaffold.bass, multiplex: scaffold.multiplex },
      sections: sections.map((s) => ({ label: s.label, bars: s.bars, chords: s.chords, drum_mode: s.drum_mode })),
    },
    screen: { drum_density: Math.round(density * 10) / 10, stutter_score: Math.round(stutter * 1000) / 1000, verdict, retries },
    palette_used: {
      patches: topPatch ? [topPatch.id] : [],
      phrases: leadPhrases.length,
      progressions: [homeProg.degrees, contrastProg.degrees],
      timbre: !noTimbre, drums: drums.length > 0, multiplex: scaffold.multiplex,
      ablation, seed,
    },
  };
}

/** Fraction of melodic notes whose gate is < 4 frames (mix_check's stutter gate,
 * computed from the Score: phrase gates_beats + note dur_beats × frames-per-beat). */
function computeStutter(voices: any[], framesPerBeat: number, _beatsPerBar: number): number {
  let total = 0, truncated = 0;
  for (const v of voices) {
    for (const ph of v.phrases ?? []) {
      for (const g of ph.gates as number[]) { total++; if (Math.round(g * framesPerBeat) < 4) truncated++; }
    }
    for (const n of v.notes ?? []) { total++; if (Math.round((n.dur_beats ?? 1) * framesPerBeat) < 4) truncated++; }
  }
  return total ? truncated / total : 0;
}

export interface AutoComposeArgs {
  composer: string;
  seed?: number;
  ablation?: Ablation;
  key?: string;
  mode?: "major" | "minor";
  maxBars?: number;
  tempo?: number;
  /** Re-rank the palette by distinctiveness (salience) instead of raw frequency. */
  salient?: boolean;
  graphName?: string;
}

/** Highest-tune-count canon composer that isn't the target — the scramble_palette
 * negative control swaps in this composer's identity vocabulary. */
async function pickOtherComposer(target: string, graphName?: string): Promise<string | null> {
  const client = new FalkorHvscClient(graphName ? { graphName } : {});
  await client.connect();
  try {
    const rows = await client.rawQuery<{ name: string; n: number }>(
      `MATCH (c:Composer)<-[:COMPOSED_BY]-(t:Tune)
       RETURN c.name AS name, count(t) AS n ORDER BY n DESC, c.name ASC`, {});
    const tnorm = normalizeName(target);
    const other = rows.find((r) => normalizeName(r.name) !== tnorm);
    return other?.name ?? null;
  } finally {
    await client.disconnect();
  }
}

/** Average mined tempo for a composer (drives the scaffold's tempo). */
async function composerAvgTempo(composer: string, graphName?: string): Promise<number | undefined> {
  const client = new FalkorHvscClient(graphName ? { graphName } : {});
  await client.connect();
  try {
    const rows = await client.rawQuery<{ t: number }>(
      `MATCH (c:Composer {name:$name})<-[:COMPOSED_BY]-(t:Tune)
       WHERE t.tempo_bpm > 0 RETURN avg(t.tempo_bpm) AS t`, { name: normalizeName(composer) });
    const t = Number(rows[0]?.t);
    return Number.isFinite(t) && t > 0 ? t : undefined;
  } finally {
    await client.disconnect();
  }
}

/** Thin async wrapper: fetch the composer's palette (and, for scramble_palette,
 * an alternate composer's) + their mined tempo, then run the pure buildScore. */
export async function autoCompose(args: AutoComposeArgs): Promise<BuildResult> {
  let palette: ComposerPalette = await c64ComposerPalette({ composer: args.composer, graphName: args.graphName });
  let scramblePalette: ComposerPalette | undefined;
  if (args.ablation === "scramble_palette") {
    const other = await pickOtherComposer(args.composer, args.graphName);
    if (other) scramblePalette = await c64ComposerPalette({ composer: other, graphName: args.graphName });
  }
  if (args.salient) {
    palette = await saliencizePalette(palette, args.graphName);
    if (scramblePalette) scramblePalette = await saliencizePalette(scramblePalette, args.graphName);
  }
  // tempo: explicit arg wins, else the composer's mined average (structure from X).
  const tempo = args.tempo ?? await composerAvgTempo(args.composer, args.graphName);
  return buildScore(palette, {
    seed: args.seed, ablation: args.ablation, key: args.key, mode: args.mode,
    maxBars: args.maxBars, tempo, scramblePalette,
  });
}

// CLI: npm run compose:auto -- --composer "Rob Hubbard" [--seed N] [--ablation A]
//      [--key C] [--mode minor] [--max-bars 24] [--tempo 128] [--out /tmp/stem] [--render]
async function main(): Promise<void> {
  const { writeFileSync, copyFileSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const argv = process.argv;
  const get = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const has = (n: string) => argv.includes(`--${n}`);
  const composer = get("composer");
  if (!composer) { console.error("Missing --composer"); process.exit(1); }

  const result = await autoCompose({
    composer,
    seed: get("seed") ? Number(get("seed")) : undefined,
    ablation: (get("ablation") as Ablation | undefined) ?? undefined,
    key: get("key"), mode: get("mode") as "major" | "minor" | undefined,
    maxBars: get("max-bars") ? Number(get("max-bars")) : undefined,
    tempo: get("tempo") ? Number(get("tempo")) : undefined,
    salient: has("salient"),
  });

  const stem = get("out") ?? join(tmpdir(), `autocompose-${composer.replace(/\s+/g, "_")}-s${result.palette_used.seed}-${result.palette_used.ablation}`);
  const scorePath = `${stem}.score.json`;
  writeFileSync(scorePath, JSON.stringify(result.score, null, 2));
  console.log(JSON.stringify({ plan: result.plan, screen: result.screen, palette_used: result.palette_used }, null, 2));

  // render the .sid via the existing python compose package
  const { sidPath } = await composeScore(result.score);
  const sidOut = `${stem}.sid`;
  copyFileSync(sidPath, sidOut);
  console.log(`[compose:auto] score: ${scorePath}`);
  console.log(`[compose:auto] sid:   ${sidOut}`);

  if (has("render")) {
    const wavOut = `${stem}.wav`;
    const renderer = join(process.cwd(), "scripts", "sid-stylometry", "render-sid.sh");
    const rr = spawnSync("bash", [renderer, sidOut, wavOut, "33"], { encoding: "utf8" });
    if (rr.status !== 0) { console.error(`[compose:auto] render failed: ${rr.stderr || rr.stdout}`); return; }
    const py = join(process.cwd(), "analyzer", ".venv", "bin", "python");
    const mc = spawnSync(py, ["-m", "src.mix_check", "--wav", wavOut, "--score", scorePath],
      { cwd: join(process.cwd(), "analyzer"), encoding: "utf8" });
    console.log(`[compose:auto] wav:   ${wavOut}`);
    console.log(`[compose:auto] mix_check (audio): ${mc.stdout.trim()}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
