/**
 * Clustering layer: group instruments, motifs, rhythm patterns, and
 * structures into canonical clusters across the canon.
 *
 * Determinism: cluster IDs are derived from canonicalized content keys,
 * not incremental numbering. Re-running yields identical IDs. The
 * `hashClusteringParams` helper feeds into the Phase 0 cache key per
 * decision A2 (cache busts when clustering hyperparameters change).
 */

import { createHash } from "node:crypto";

// Spread-free min/max. `Math.min(...arr)` / `Math.max(...arr)` blow the call stack
// ("Maximum call stack size exceeded") on very large arrays — V8 caps spread args at
// ~64-128k, which the full-corpus note/energy arrays exceed. These are O(n), stack-safe.
const minOf = (a: number[]): number => a.reduce((m, v) => (v < m ? v : m), Infinity);
const maxOf = (a: number[]): number => a.reduce((m, v) => (v > m ? v : m), -Infinity);

export interface RawInstrument {
  id: string;
  adsr: number[];
  waveform: string;
  filter_routed: boolean;
  hard_restart: boolean;
  pulse_pattern: number[];
}

export interface InstrumentClusterParams {
  adsrTolerance: number; // 0 = exact match
  pwTolerance: number;   // pulse-width quantization step
}

export interface MotifParams {
  minLength: number;
  minOccurrences: number;
}

export function hashClusteringParams(params: Record<string, unknown>): string {
  // Sort keys for stable JSON serialization
  const ordered = JSON.stringify(params, Object.keys(params).sort());
  return createHash("sha256").update(ordered).digest("hex").slice(0, 16);
}

function _instrumentKey(inst: RawInstrument, p: InstrumentClusterParams): string {
  // Quantize ADSR by tolerance: bucket = floor(val / step) where step = max(1, tolerance).
  // tolerance=0 → step=1 (exact); tolerance=16 → bucket width of 16.
  const adsrStep = Math.max(1, p.adsrTolerance);
  const pwStep = Math.max(1, p.pwTolerance);
  const adsr = inst.adsr.map((n) => Math.floor(n / adsrStep)).join(",");
  const pw = inst.pulse_pattern.length > 0
    ? Math.floor(inst.pulse_pattern[0] / pwStep)
    : 0;
  return `${adsr}|${inst.waveform}|${inst.filter_routed}|${inst.hard_restart}|${pw}`;
}

/**
 * Cluster instruments by quantized (ADSR + waveform + filter + restart + PW).
 * Returns a Map<clusterKey, members[]>.
 */
export function clusterInstruments(
  raw: RawInstrument[],
  p: InstrumentClusterParams,
): Map<string, RawInstrument[]> {
  const clusters = new Map<string, RawInstrument[]>();
  for (const inst of raw) {
    const key = _instrumentKey(inst, p);
    const bucket = clusters.get(key) ?? [];
    bucket.push(inst);
    clusters.set(key, bucket);
  }
  return clusters;
}

export interface RawPatch {
  patch_hash: string;
  adsr: number[];
  waveform: string;
  filter_routed: boolean;
  hard_restart: string;
}

/** Fuzzy family key: quantized ADSR + waveform + filter + restart-presence. */
export function patchFamilyKey(p: RawPatch, adsrTolerance: number): string {
  const step = Math.max(1, adsrTolerance);
  const adsr = p.adsr.map((n) => Math.floor(n / step)).join(",");
  const hr = p.hard_restart ? "hr" : "";
  return `${adsr}|${p.waveform}|${p.filter_routed}|${hr}`;
}

export interface MotifMatch {
  intervals: number[];  // pitch-interval sequence in semitones
  occurrences: Array<{ frame: number; voice: number }>;
}

/**
 * Fuzzy MotifFamily key: the melodic contour — the sign of each interval
 * (+1 up / -1 down / 0 repeat), ignoring exact interval sizes. Groups motifs
 * with the same up/down shape regardless of transposition or ornament size.
 */
export function motifContourKey(intervals: number[]): string {
  return intervals.map((n) => Math.sign(n)).join(",");
}

function _hzToMidi(hz: number): number {
  if (hz <= 0) return -1;
  return Math.round(69 + 12 * Math.log2(hz / 440));
}

interface RawEvent {
  frame: number;
  voice: number;
  kind: string;
  pitch: number;
}

/**
 * Mine repeated pitch-interval n-grams from note-on events.
 *
 * For each voice independently: build the ordered list of note-on midi
 * pitches, derive the interval sequence between consecutive notes, then
 * scan for repeated minLength-grams that appear at least minOccurrences
 * times.
 */
export function mineMotifs(events: RawEvent[], p: MotifParams): MotifMatch[] {
  const byVoice = new Map<number, Array<{ frame: number; midi: number }>>();
  for (const e of events) {
    if (e.kind !== "on") continue;
    const midi = _hzToMidi(e.pitch);
    if (midi < 0) continue;
    const arr = byVoice.get(e.voice) ?? [];
    arr.push({ frame: e.frame, midi });
    byVoice.set(e.voice, arr);
  }

  // minLength is note count; each n-gram spans (minLength - 1) intervals.
  const intervalLen = p.minLength - 1;
  const motifs: MotifMatch[] = [];
  for (const [voice, notes] of byVoice) {
    if (notes.length < p.minLength) continue;
    const intervals: number[] = [];
    for (let i = 1; i < notes.length; i++) {
      intervals.push(notes[i].midi - notes[i - 1].midi);
    }
    const seen = new Map<string, Array<{ frame: number; voice: number }>>();
    for (let i = 0; i <= intervals.length - intervalLen; i++) {
      const slice = intervals.slice(i, i + intervalLen);
      const key = slice.join(",");
      const bucket = seen.get(key) ?? [];
      bucket.push({ frame: notes[i].frame, voice });
      seen.set(key, bucket);
    }
    for (const [key, occs] of seen) {
      if (occs.length >= p.minOccurrences) {
        motifs.push({
          intervals: key.split(",").map(Number),
          occurrences: occs,
        });
      }
    }
  }
  return motifs;
}

export interface RhythmMatch {
  slots: number[][]; // per note: [ioi_steps, gate_steps]; length = minLength
  voice: number;
  occurrences: number;
}

export interface RhythmParams {
  minLength: number;
  minOccurrences: number;
  stepFrames?: number; // tempo-derived quantization step; undefined -> per-voice median ioi
}

/**
 * Mine repeated note-timing n-grams per voice from the note-event stream.
 *
 * Pairs each note-on with its following note-off (re-gate without an off closes
 * the open note at the new onset). Per note: ioi = frames to the next onset (last
 * note uses its gate length); gate = frames gated on. Both are quantized to a
 * step (tempo-derived sixteenth, or per-voice median ioi as fallback), then
 * scanned for minLength-grams of [ioi,gate] slots occurring >= minOccurrences.
 * Sibling of mineMotifs (which mines pitch contour, time-invariant).
 */
export function mineRhythm(events: RawEvent[], p: RhythmParams): RhythmMatch[] {
  const byVoice = new Map<number, Array<{ onset: number; gateLen: number }>>();
  const openByVoice = new Map<number, number>();
  const ordered = [...events].sort((a, b) => a.frame - b.frame);
  for (const e of ordered) {
    if (e.kind === "on") {
      const prev = openByVoice.get(e.voice);
      if (prev !== undefined) {
        const arr = byVoice.get(e.voice) ?? [];
        arr.push({ onset: prev, gateLen: Math.max(1, e.frame - prev) });
        byVoice.set(e.voice, arr);
      }
      openByVoice.set(e.voice, e.frame);
    } else if (e.kind === "off") {
      const onset = openByVoice.get(e.voice);
      if (onset === undefined) continue;
      const arr = byVoice.get(e.voice) ?? [];
      arr.push({ onset, gateLen: Math.max(1, e.frame - onset) });
      byVoice.set(e.voice, arr);
      openByVoice.delete(e.voice);
    }
  }

  const cells: RhythmMatch[] = [];
  for (const [voice, notes] of byVoice) {
    if (notes.length < p.minLength) continue;
    const iois: number[] = notes.map((n, i) =>
      i + 1 < notes.length ? notes[i + 1].onset - notes[i].onset : n.gateLen,
    );
    let step = p.stepFrames;
    if (step === undefined || step < 1) {
      const sorted = [...iois].sort((a, b) => a - b);
      step = Math.max(1, sorted[Math.floor(sorted.length / 2)] ?? 1);
    }
    const slots: number[][] = notes.map((n, i) => [
      Math.max(1, Math.round(iois[i] / step!)),
      Math.max(1, Math.round(n.gateLen / step!)),
    ]);
    const seen = new Map<string, number>();
    for (let i = 0; i <= slots.length - p.minLength; i++) {
      const key = JSON.stringify(slots.slice(i, i + p.minLength));
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const [key, count] of seen) {
      if (count >= p.minOccurrences) {
        cells.push({ slots: JSON.parse(key) as number[][], voice, occurrences: count });
      }
    }
  }
  return cells;
}

// --- Harmony mining (SP-harmony, 2026-05-20) ---------------------------------
// Sibling of mineMotifs/mineRhythm: infer a key-relative triad progression per
// Section from the note-event stream. Pure (no graph). Chords are key-relative:
// degree = (root_pc - tonic_pc) mod 12, quality maj/min.

export interface HarmonyChord { degree: number; quality: "maj" | "min" }
export interface SectionProgression { order: number; chords: HarmonyChord[] }
export interface HarmonyParams {
  windowFrames: number;        // beat window in frames (caller derives from tempo)
  weakWindowMinWeight: number; // window dropped-to-inherit if total weight < this * windowFrames
  minDistinctChords: number;   // collapsed progressions shorter than this are dropped
  mode: "major" | "minor";     // tonic quality for first-window inheritance
}

const _LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Key/chord-root name -> pitch class. Tolerant of music21 ("B-") and score.py
 * ("Bb") flat spellings and "#"/"s" sharps. Returns null if unparseable. */
export function tonicPcFromKeyName(name: string | null | undefined): number | null {
  if (!name) return null;
  const s = name.trim();
  if (s.length === 0) return null;
  const base = _LETTER_PC[s[0].toUpperCase()];
  if (base === undefined) return null;
  let pc = base;
  for (const ch of s.slice(1)) {
    if (ch === "#" || ch === "s" || ch === "S") pc += 1;
    else if (ch === "-" || ch === "b" || ch === "B") pc -= 1;
  }
  return ((pc % 12) + 12) % 12;
}

/** Parse a triad chord symbol -> {root_pc, quality}. Port of score.py parse_chord. */
export function parseChordSymbol(symbol: string): { root_pc: number; quality: "maj" | "min" } | null {
  let body = symbol.trim();
  if (!body) return null;
  let quality: "maj" | "min" = "maj";
  const low = body.toLowerCase();
  if (low.endsWith("min")) { quality = "min"; body = body.slice(0, -3); }
  else if (low.endsWith("maj")) { body = body.slice(0, -3); }
  else if (body.endsWith("m")) { quality = "min"; body = body.slice(0, -1); }
  const pc = tonicPcFromKeyName(body);
  if (pc === null) return null;
  return { root_pc: pc, quality };
}

export function collapseRuns<T>(xs: T[], eq: (a: T, b: T) => boolean): T[] {
  const out: T[] = [];
  for (const x of xs) if (out.length === 0 || !eq(out[out.length - 1], x)) out.push(x);
  return out;
}

export function progressionDegreesString(chords: HarmonyChord[]): string {
  return chords.map((c) => `${c.degree}${c.quality}`).join("-");
}

const _TRIADS: Array<{ root: number; quality: "maj" | "min"; tones: number[] }> = (() => {
  const t: Array<{ root: number; quality: "maj" | "min"; tones: number[] }> = [];
  for (let r = 0; r < 12; r++) {
    t.push({ root: r, quality: "maj", tones: [r, (r + 4) % 12, (r + 7) % 12] });
    t.push({ root: r, quality: "min", tones: [r, (r + 3) % 12, (r + 7) % 12] });
  }
  return t;
})();

interface _Span { on: number; off: number; pc: number }

function _harmonySpans(events: Array<RawEvent & { sid_chip?: number }>): { spans: _Span[]; maxFrame: number } {
  const ordered = [...events].sort((a, b) => a.frame - b.frame);
  const open = new Map<string, { on: number; pc: number }>();
  const spans: _Span[] = [];
  let maxFrame = 0;
  for (const e of ordered) {
    maxFrame = Math.max(maxFrame, e.frame);
    const k = `${e.sid_chip ?? 1}:${e.voice}`;
    if (e.kind === "on") {
      const prev = open.get(k);
      if (prev) spans.push({ on: prev.on, off: e.frame, pc: prev.pc });
      const midi = _hzToMidi(e.pitch);
      if (midi >= 0) open.set(k, { on: e.frame, pc: ((midi % 12) + 12) % 12 });
      else open.delete(k);
    } else if (e.kind === "off") {
      const prev = open.get(k);
      if (prev) { spans.push({ on: prev.on, off: e.frame, pc: prev.pc }); open.delete(k); }
    }
  }
  for (const [, prev] of open) spans.push({ on: prev.on, off: maxFrame, pc: prev.pc });
  return { spans, maxFrame };
}

function _bestChord(
  spans: _Span[], wStart: number, wEnd: number, p: HarmonyParams,
  prev: HarmonyChord | null, tonicPc: number,
): HarmonyChord {
  const hist = new Array<number>(12).fill(0);
  let total = 0;
  for (const s of spans) {
    const ov = Math.min(s.off, wEnd) - Math.max(s.on, wStart);
    if (ov > 0) { hist[s.pc] += ov; total += ov; }
  }
  if (total < p.weakWindowMinWeight * (wEnd - wStart)) {
    return prev ?? { degree: 0, quality: p.mode === "major" ? "maj" : "min" };
  }
  let best = _TRIADS[0], bestScore = -1;
  for (const tr of _TRIADS) {
    const score = hist[tr.tones[0]] + hist[tr.tones[1]] + hist[tr.tones[2]];
    // tie-break: first triad (lowest root, maj before min) wins on strict >, deterministic
    if (score > bestScore) { bestScore = score; best = tr; }
  }
  return { degree: ((best.root - tonicPc) % 12 + 12) % 12, quality: best.quality };
}

// --- Phrase mining (SP-phrase, 2026-05-21) ---
export interface PhraseMatch {
  key: string; intervals: number[]; iois: number[]; gates: number[];
  voice: number; sid_chip: number; occurrences: number;
}
export interface PhraseParams { length: number; minOccurrences: number; stepFrames?: number; }

export function phraseKey(intervals: number[], iois: number[], gates: number[]): string {
  const rhythm = iois.map((io, i) => `${io}:${gates[i]}`).join(";");
  return `${intervals.join(",")}|${rhythm}`;
}

export function minePhrases(events: Array<RawEvent & { sid_chip?: number }>, p: PhraseParams): PhraseMatch[] {
  // pair on/off into notes (onset, gateLen, midi) per (chip,voice) [mirrors mineRhythm]
  const byVoice = new Map<string, Array<{ onset: number; gateLen: number; midi: number }>>();
  const open = new Map<string, { onset: number; midi: number }>();
  for (const e of [...events].sort((a, b) => a.frame - b.frame)) {
    const k = `${e.sid_chip ?? 1}:${e.voice}`;
    if (e.kind === "on") {
      const prev = open.get(k);
      if (prev) {
        const arr = byVoice.get(k) ?? [];
        arr.push({ onset: prev.onset, gateLen: Math.max(1, e.frame - prev.onset), midi: prev.midi });
        byVoice.set(k, arr);
      }
      const midi = _hzToMidi(e.pitch);
      if (midi >= 0) open.set(k, { onset: e.frame, midi }); else open.delete(k);
    } else if (e.kind === "off") {
      const prev = open.get(k);
      if (prev) {
        const arr = byVoice.get(k) ?? [];
        arr.push({ onset: prev.onset, gateLen: Math.max(1, e.frame - prev.onset), midi: prev.midi });
        byVoice.set(k, arr);
        open.delete(k);
      }
    }
  }
  const out: PhraseMatch[] = [];
  for (const [k, notes] of byVoice) {
    if (notes.length < p.length) continue;
    const [chip, voice] = k.split(":").map(Number);
    // tempo-derived step or per-voice median ioi
    const iois = notes.map((n, i) => i + 1 < notes.length ? notes[i + 1].onset - notes[i].onset : n.gateLen);
    let step = p.stepFrames;
    if (!step || step < 1) { const s = [...iois].sort((a, b) => a - b); step = Math.max(1, s[Math.floor(s.length / 2)] ?? 1); }
    const seen = new Map<string, { count: number; ivs: number[]; io: number[]; ga: number[] }>();
    for (let i = 0; i + p.length <= notes.length; i++) {
      const win = notes.slice(i, i + p.length);
      const ivs = win.slice(1).map((n, j) => n.midi - win[j].midi);
      const io = win.map((_, j) => Math.max(1, Math.round((j + 1 < p.length ? win[j + 1].onset - win[j].onset : win[j].gateLen) / step!)));
      const ga = win.map(n => Math.max(1, Math.round(n.gateLen / step!)));
      const key = phraseKey(ivs, io, ga);
      const rec = seen.get(key) ?? { count: 0, ivs, io, ga };
      rec.count++; seen.set(key, rec);
    }
    for (const [key, r] of seen) if (r.count >= p.minOccurrences) out.push({ key, intervals: r.ivs, iois: r.io, gates: r.ga, voice, sid_chip: chip, occurrences: r.count });
  }
  return out;
}

// --- Arp mining (SP-arp, 2026-05-21) ---
export interface ArpMatch {
  key: string; chord_intervals: number[]; cycle: number[]; n_steps: number;
  rate_frames: number; voice: number; sid_chip: number; occurrences: number;
}
export interface ArpParams { minSteps: number; maxTones: number; maxRateFrames: number; periodMax: number; }

export function arpKey(chord_intervals: number[], cycle: number[], rate_frames: number): string {
  return `${chord_intervals.join(",")}|${cycle.join(",")}|r${rate_frames}`;
}

/** Smallest period p in [1..maxP] s.t. seq repeats every p; else min(maxP, len). */
function detectPeriod(seq: number[], maxP: number): number {
  for (let p = 1; p <= Math.min(maxP, seq.length); p++) {
    let ok = true;
    for (let x = p; x < seq.length; x++) if (seq[x] !== seq[x - p]) { ok = false; break; }
    if (ok) return p;
  }
  return Math.min(maxP, seq.length);
}

export function mineArps(events: Array<RawEvent & { sid_chip?: number }>, p: ArpParams): ArpMatch[] {
  const byVoice = new Map<string, Array<{ onset: number; midi: number }>>();
  const open = new Map<string, { onset: number; midi: number }>();
  const pushNote = (k: string, onset: number, midi: number) => {
    const arr = byVoice.get(k) ?? []; arr.push({ onset, midi }); byVoice.set(k, arr);
  };
  for (const e of [...events].sort((a, b) => a.frame - b.frame)) {
    const k = `${e.sid_chip ?? 1}:${e.voice}`;
    if (e.kind === "on") {
      const prev = open.get(k);
      if (prev) pushNote(k, prev.onset, prev.midi);
      const midi = _hzToMidi(e.pitch);
      if (midi >= 0) open.set(k, { onset: e.frame, midi }); else open.delete(k);
    } else if (e.kind === "off") {
      const prev = open.get(k);
      if (prev) { pushNote(k, prev.onset, prev.midi); open.delete(k); }
    }
  }
  const raw: ArpMatch[] = [];
  for (const [k, notes] of byVoice) {
    if (notes.length < p.minSteps) continue;
    const [chip, voice] = k.split(":").map(Number);
    const ioiAt = (x: number) => notes[x + 1].onset - notes[x].onset;
    let i = 0;
    while (i < notes.length - 1) {
      let j = i;
      while (j < notes.length - 1 && ioiAt(j) >= 1 && ioiAt(j) <= p.maxRateFrames) j++;
      const span = notes.slice(i, j + 1);
      if (span.length >= p.minSteps) {
        const minPitch = minOf(span.map((n) => n.midi));
        const offsets = span.map((n) => n.midi - minPitch);
        const distinct = new Set(offsets);
        if (distinct.size >= 2 && distinct.size <= p.maxTones) {
          const iois: number[] = []; for (let x = i; x < j; x++) iois.push(ioiAt(x));
          iois.sort((a, b) => a - b);
          const rate = Math.max(1, iois[Math.floor(iois.length / 2)] ?? 1);
          const period = detectPeriod(offsets, p.periodMax);
          const cycle = offsets.slice(0, period);
          const chord_intervals = [...distinct].sort((a, b) => a - b);
          raw.push({ key: arpKey(chord_intervals, cycle, rate), chord_intervals, cycle,
            n_steps: cycle.length, rate_frames: rate, voice, sid_chip: chip,
            occurrences: Math.floor(offsets.length / period) });
        }
      }
      i = j > i ? j + 1 : i + 1;
    }
  }
  const merged = new Map<string, ArpMatch>();
  for (const a of raw) {
    const ex = merged.get(a.key);
    if (ex) ex.occurrences += a.occurrences; else merged.set(a.key, { ...a });
  }
  return [...merged.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

// --- Grammar mining (SP-grammar, ontology layer 4, 2026-05-21) ---
// Sibling of mineMotifs/minePhrases, one layer up: mine the *grammar* of a lead
// melody — its hook (most-recurrent motif), the development ops between successive
// hook statements, and a phrasing profile. Pure. Intervals are transposition-
// invariant, so an interval n-gram match already counts transposed restatements.
// The caller filters `events` to the lead/dual voice's stream first.

export type DevelopmentOp = "repeat" | "sequence" | "invert" | "augment" | "vary";
export type ContourArchetype = "arch" | "rise" | "fall" | "oscillate" | "flat";

export interface GrammarHook {
  intervals: number[];   // interval signature in semitones (transposition-invariant)
  length: number;        // note count (= intervals.length + 1)
  occurrences: number;   // exact-interval recurrence (counts transposed restatements)
  strength: number;      // recurrence fraction 0..1 (occurrences / candidate windows)
}

export interface PhrasingProfile {
  leap_ratio: number;        // |interval| >= 3 / total intervals
  step_ratio: number;        // |interval| in {1,2} / total intervals
  repetition_rate: number;   // fraction of notes covered by a recurring motif
  mean_abs_interval: number; // average |interval| in semitones
  contour_archetype: ContourArchetype;
}

export interface GrammarResult {
  hook: GrammarHook | null;
  development: Record<DevelopmentOp, number>;
  phrasing: PhrasingProfile;
  note_count: number;
}

export interface GrammarParams {
  minHookLength: number;   // min hook length in notes (e.g. 3)
  maxHookLength: number;   // max hook length to consider in notes (e.g. 6)
  minOccurrences: number;  // min recurrence to qualify as a hook (e.g. 2)
}

function _intervalsOf(notes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < notes.length; i++) out.push(notes[i] - notes[i - 1]);
  return out;
}
function _eqArr(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Overall melodic shape of a midi-note sequence. */
export function contourArchetype(notes: number[]): ContourArchetype {
  if (notes.length < 2) return "flat";
  const min = minOf(notes), max = maxOf(notes);
  if (max - min <= 1) return "flat";
  const ivs = _intervalsOf(notes);
  const nz = ivs.filter((v) => v !== 0);
  let changes = 0;
  for (let i = 1; i < nz.length; i++) if (Math.sign(nz[i]) !== Math.sign(nz[i - 1])) changes++;
  const changeRatio = nz.length > 1 ? changes / (nz.length - 1) : 0;
  if (changeRatio >= 0.4) return "oscillate";
  let peakIdx = 0;
  for (let i = 1; i < notes.length; i++) if (notes[i] > notes[peakIdx]) peakIdx = i;
  const n = notes.length;
  if (peakIdx > 0 && peakIdx < n - 1 && notes[peakIdx] > notes[0] && notes[peakIdx] > notes[n - 1]) return "arch";
  const net = notes[n - 1] - notes[0];
  if (net > 1) return "rise";
  if (net < -1) return "fall";
  return "oscillate";
}

/**
 * Classify the transform between two equal-length midi-note windows (the
 * development op a composer applied to restate a motif). Optional iois (length
 * = window notes - 1) enable rhythmic augmentation/diminution detection.
 */
export function classifyDevelopmentOp(
  a: number[], b: number[], ra?: number[], rb?: number[],
): DevelopmentOp {
  const ia = _intervalsOf(a), ib = _intervalsOf(b);
  if (_eqArr(ia, ib)) {
    if (ra && rb && ra.length === rb.length && ra.length > 0) {
      const ratios = ra.map((v, i) => (v === 0 ? 1 : rb[i] / v));
      const r0 = ratios[0];
      const consistent = ratios.every((r) => Math.abs(r - r0) < 1e-6);
      if (consistent && (r0 >= 1.5 || r0 <= 0.67)) return "augment";
    }
    return _eqArr(a, b) ? "repeat" : "sequence";
  }
  if (_eqArr(ib, ia.map((x) => -x))) return "invert";
  return "vary";
}

/** True when window B is a development of window A (vs an unrelated contrast). */
function _isDevelopment(a: number[], b: number[], op: DevelopmentOp): boolean {
  if (op !== "vary") return true;
  const sa = _intervalsOf(a).map(Math.sign);
  const sb = _intervalsOf(b).map(Math.sign);
  return _eqArr(sa, sb) || _eqArr(sb, sa.map((x) => -x));
}

/**
 * Mine a lead melody's grammar. Builds the ordered note-on midi stream, finds
 * the hook (interval n-gram with the greatest coverage that recurs >=
 * minOccurrences), classifies the development ops between successive hook-length
 * statements, and computes the phrasing profile.
 */
export function mineGrammar(
  events: Array<RawEvent & { sid_chip?: number }>,
  p: GrammarParams,
): GrammarResult {
  const ordered = [...events].sort((a, b) => a.frame - b.frame);
  const notes: number[] = [];
  const onsets: number[] = [];
  for (const e of ordered) {
    if (e.kind !== "on") continue;
    const midi = _hzToMidi(e.pitch);
    if (midi < 0) continue;
    notes.push(midi);
    onsets.push(e.frame);
  }
  const note_count = notes.length;
  const development: Record<DevelopmentOp, number> = {
    repeat: 0, sequence: 0, invert: 0, augment: 0, vary: 0,
  };
  const intervals = _intervalsOf(notes);
  const iois: number[] = [];
  for (let i = 1; i < onsets.length; i++) iois.push(onsets[i] - onsets[i - 1]);

  // Phrasing profile (over the whole stream).
  const nIv = intervals.length;
  const leaps = intervals.filter((v) => Math.abs(v) >= 3).length;
  const steps = intervals.filter((v) => Math.abs(v) === 1 || Math.abs(v) === 2).length;
  const meanAbs = nIv > 0 ? intervals.reduce((s, v) => s + Math.abs(v), 0) / nIv : 0;
  const phrasing: PhrasingProfile = {
    leap_ratio: nIv > 0 ? Math.round((leaps / nIv) * 1000) / 1000 : 0,
    step_ratio: nIv > 0 ? Math.round((steps / nIv) * 1000) / 1000 : 0,
    repetition_rate: 0,
    mean_abs_interval: Math.round(meanAbs * 1000) / 1000,
    contour_archetype: contourArchetype(notes),
  };

  // repetition_rate: fraction of notes covered by a recurring (>= minOccurrences)
  // n-gram of the minimum hook length.
  if (note_count >= p.minHookLength) {
    const baseLen = p.minHookLength - 1; // interval count
    const seen = new Map<string, number[]>();
    for (let i = 0; i + baseLen <= nIv; i++) {
      const key = intervals.slice(i, i + baseLen).join(",");
      const arr = seen.get(key) ?? [];
      arr.push(i);
      seen.set(key, arr);
    }
    const covered = new Set<number>();
    for (const [, starts] of seen) {
      if (starts.length < p.minOccurrences) continue;
      for (const s of starts) for (let k = 0; k < p.minHookLength; k++) covered.add(s + k);
    }
    phrasing.repetition_rate = Math.round((covered.size / note_count) * 1000) / 1000;
  }

  // Hook: best coverage (occurrences * length) among recurring interval n-grams.
  let hook: GrammarHook | null = null;
  let bestScore = -1;
  const maxLen = Math.min(p.maxHookLength, note_count);
  for (let L = p.minHookLength; L <= maxLen; L++) {
    const ivLen = L - 1;
    if (ivLen < 1 || ivLen > nIv) continue;
    const numWindows = nIv - ivLen + 1;
    const seen = new Map<string, number>();
    for (let i = 0; i + ivLen <= nIv; i++) {
      const key = intervals.slice(i, i + ivLen).join(",");
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const [key, occ] of seen) {
      if (occ < p.minOccurrences) continue;
      // A hook must carry melodic motion — skip all-static (held/retriggered
      // note) n-grams, which otherwise dominate by raw recurrence.
      if (key.split(",").every((s) => s === "0")) continue;
      const score = occ * L;
      const cand = { key, occ, L };
      // tie-break: coverage desc, then occ desc, then length desc, then key asc
      const better = score > bestScore
        || (score === bestScore && hook !== null && (
          occ > hook.occurrences
          || (occ === hook.occurrences && L > hook.length)
          || (occ === hook.occurrences && L === hook.length && key < hook.intervals.join(","))
        ));
      if (better) {
        bestScore = score;
        hook = {
          intervals: cand.key.split(",").map(Number),
          length: L,
          occurrences: occ,
          strength: Math.round((occ / numWindows) * 1000) / 1000,
        };
      }
    }
  }

  // Development ops between successive hook-length statements.
  if (hook) {
    const L = hook.length;
    let prevStart = -1;
    for (let s = 0; s + L <= note_count; s += L) {
      if (prevStart >= 0) {
        const a = notes.slice(prevStart, prevStart + L);
        const b = notes.slice(s, s + L);
        const ra = iois.slice(prevStart, prevStart + L - 1);
        const rb = iois.slice(s, s + L - 1);
        const op = classifyDevelopmentOp(a, b, ra, rb);
        if (_isDevelopment(a, b, op)) development[op] += 1;
      }
      prevStart = s;
    }
  }

  return { hook, development, phrasing, note_count };
}

// --- Form-as-dynamics mining (SP-form, ontology layer 5, 2026-05-21) ---
// Layer 5: form is not just Section labels — it's the tension/release ARC. Per Section we
// derive an energy (density + voice activity + register); the sequence of section energies
// is classified into an arc archetype. Pure. A flat arc is the reliable "boring" signal.

export type ArcArchetype = "flat" | "rising" | "falling" | "arch" | "oscillate";

export interface SectionEnergy {
  order: number;
  density: number;        // note onsets per frame (raw)
  register: number;       // mean midi of on-events (raw, 0 if none)
  voice_activity: number; // distinct voices sounding in the section
  energy: number;         // 0..1 composite, normalized across the tune's sections
}

export interface FormResult {
  sections: SectionEnergy[];
  arc: ArcArchetype;
  peak_section: number;   // order of the max-energy section
  energy_range: number;   // max - min normalized energy
}

/** Classify an energy trajectory (each value 0..1) into an arc archetype. Single interior
 * peak = arch (checked before oscillate so a clean low-high-low isn't mislabelled). */
export function arcArchetype(e: number[]): ArcArchetype {
  if (e.length < 2) return "flat";
  const max = maxOf(e), min = minOf(e);
  if (max - min <= 0.2) return "flat";
  const diffs: number[] = [];
  for (let i = 1; i < e.length; i++) diffs.push(e[i] - e[i - 1]);
  const nz = diffs.filter((d) => Math.abs(d) > 1e-9);
  let changes = 0;
  for (let i = 1; i < nz.length; i++) if (Math.sign(nz[i]) !== Math.sign(nz[i - 1])) changes++;
  let peak = 0;
  for (let i = 1; i < e.length; i++) if (e[i] > e[peak]) peak = i;
  const n = e.length;
  if (peak > 0 && peak < n - 1 && e[peak] >= e[0] && e[peak] >= e[n - 1] && changes <= 1) return "arch";
  if (changes >= 2) return "oscillate";
  const net = e[n - 1] - e[0];
  if (net > 0.15) return "rising";
  if (net < -0.15) return "falling";
  return "oscillate";
}

/**
 * Mine a tune's form-as-dynamics: per-section energy + the overall arc. Energy is a 0..1
 * composite of min-max-normalized density, voice-activity and register across the tune's
 * own sections (so it's a within-tune shape, comparable across tunes).
 */
export function mineForm(
  events: Array<RawEvent & { sid_chip?: number }>,
  sections: Array<{ order: number; start_frame: number; end_frame: number }>,
  p: { wDensity?: number; wVoice?: number; wRegister?: number } = {},
): FormResult {
  const wD = p.wDensity ?? 0.5, wV = p.wVoice ?? 0.3, wR = p.wRegister ?? 0.2;
  const ons = events.filter((e) => e.kind === "on");
  const raw = sections.map((s) => {
    const span = Math.max(1, s.end_frame - s.start_frame);
    const inSec = ons.filter((e) => e.frame >= s.start_frame && e.frame < s.end_frame);
    const voices = new Set(inSec.map((e) => `${e.sid_chip ?? 1}:${e.voice}`)).size;
    const midis = inSec.map((e) => _hzToMidi(e.pitch)).filter((m) => m >= 0);
    const register = midis.length ? midis.reduce((a, b) => a + b, 0) / midis.length : 0;
    return { order: s.order, density: inSec.length / span, register, voice_activity: voices };
  });

  const norm = (vals: number[]) => {
    const lo = minOf(vals), hi = maxOf(vals);
    return vals.map((v) => (hi - lo < 1e-9 ? 0 : (v - lo) / (hi - lo)));
  };
  const nd = norm(raw.map((r) => r.density));
  const nv = norm(raw.map((r) => r.voice_activity));
  const nr = norm(raw.map((r) => r.register));
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const energies = raw.map((_, i) => r3(wD * nd[i] + wV * nv[i] + wR * nr[i]));

  const secOut: SectionEnergy[] = raw.map((r, i) => ({
    order: r.order, density: r3(r.density), register: r3(r.register),
    voice_activity: r.voice_activity, energy: energies[i],
  }));
  let peakIdx = 0;
  for (let i = 1; i < energies.length; i++) if (energies[i] > energies[peakIdx]) peakIdx = i;
  return {
    sections: secOut,
    arc: arcArchetype(energies),
    peak_section: secOut[peakIdx]?.order ?? 0,
    energy_range: energies.length ? r3(maxOf(energies) - minOf(energies)) : 0,
  };
}

// --- Melodic-direction mining (SP-direction, grammar layer 4b, 2026-05-21) ---
// The syntax of MOTION: where the line is going. Per phrase (a note run between rests) we
// classify its cadence (key-relative landing degree, closed on 1/3/5-stable vs open), whether
// the end is reached by step (voice-leading) or leap, and antecedent->consequent (open->closed)
// pairing. A wandering line has no closed cadences and no Q&A pairing. Pure.

export interface CadenceClass { degree: number; closed: boolean }
export interface DirectionResult {
  n_phrases: number;
  cadences: CadenceClass[];   // per phrase end
  resolution_rate: number;    // fraction of phrase-ends reached by step (voice-leading)
  qa_rate: number;            // fraction of consecutive phrase pairs going open -> closed
  mean_phrase_len: number;
}

// closed (resolved) landings: tonic (0), minor/major third (3/4). The 5th (7) reads as a
// half-cadence (open); 2/4/6/7 scale degrees are open/unresolved.
const _CLOSED_DEGREES = new Set([0, 3, 4]);

export function mineDirection(
  events: Array<RawEvent & { sid_chip?: number }>,
  tonicPc: number,
  p: { gapFactor?: number; minPhraseNotes?: number; maxPhraseNotes?: number } = {},
): DirectionResult {
  const empty: DirectionResult = { n_phrases: 0, cadences: [], resolution_rate: 0, qa_rate: 0, mean_phrase_len: 0 };
  const gapFactor = p.gapFactor ?? 2.5;
  const minNotes = p.minPhraseNotes ?? 2;
  const maxNotes = p.maxPhraseNotes ?? 12;   // SID leads are near-continuous → bound phrase length
  const ons = events
    .filter((e) => e.kind === "on")
    .map((e) => ({ frame: e.frame, midi: _hzToMidi(e.pitch) }))
    .filter((e) => e.midi >= 0)
    .sort((a, b) => a.frame - b.frame);
  if (ons.length === 0) return empty;

  const iois: number[] = [];
  for (let i = 1; i < ons.length; i++) iois.push(ons[i].frame - ons[i - 1].frame);
  const med = iois.length ? [...iois].sort((a, b) => a - b)[Math.floor(iois.length / 2)] : 0;
  const gapThresh = Math.max(1, med * gapFactor);

  // hard-gap segments [a,b)
  const segs: Array<[number, number]> = [];
  let start = 0;
  for (let i = 1; i < ons.length; i++) {
    if (ons[i].frame - ons[i - 1].frame > gapThresh) { segs.push([start, i]); start = i; }
  }
  segs.push([start, ons.length]);
  // bounded: subdivide any segment longer than maxNotes at its largest internal gap
  // (tie → closest to the midpoint), so continuous SID runs split into musical-length phrases.
  const ranges: Array<[number, number]> = [];
  const stack = [...segs];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a <= maxNotes || b - a < 2 * minNotes) { ranges.push([a, b]); continue; }
    const mid = (a + b) / 2;
    let best = -1, bestIoi = -1, bestDist = Infinity;
    for (let s = a + minNotes; s <= b - minNotes; s++) {
      const io = ons[s].frame - ons[s - 1].frame;
      const dist = Math.abs(s - mid);
      if (io > bestIoi || (io === bestIoi && dist < bestDist)) { best = s; bestIoi = io; bestDist = dist; }
    }
    if (best < 0) { ranges.push([a, b]); continue; }
    stack.push([best, b]); stack.push([a, best]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const kept = ranges.map(([a, b]) => ons.slice(a, b).map((o) => o.midi)).filter((ph) => ph.length >= minNotes);
  if (kept.length === 0) return empty;

  const cadences: CadenceClass[] = [];
  let stepwise = 0;
  for (const ph of kept) {
    const last = ph[ph.length - 1];
    const degree = (((last % 12) - tonicPc) % 12 + 12) % 12;
    cadences.push({ degree, closed: _CLOSED_DEGREES.has(degree) });
    if (Math.abs(last - ph[ph.length - 2]) <= 2) stepwise++;
  }
  let qa = 0;
  for (let i = 0; i < cadences.length - 1; i++) if (!cadences[i].closed && cadences[i + 1].closed) qa++;
  const pairs = cadences.length - 1;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    n_phrases: kept.length,
    cadences,
    resolution_rate: r3(stepwise / kept.length),
    qa_rate: pairs > 0 ? r3(qa / pairs) : 0,
    mean_phrase_len: r3(kept.reduce((s, ph) => s + ph.length, 0) / kept.length),
  };
}

export function mineHarmony(
  events: Array<RawEvent & { sid_chip?: number }>,
  sections: Array<{ start_frame: number; end_frame: number }>,
  tonicPc: number,
  p: HarmonyParams,
): SectionProgression[] {
  const { spans } = _harmonySpans(events);
  const out: SectionProgression[] = [];
  sections.forEach((sec, order) => {
    if (sec.end_frame <= sec.start_frame) return;
    const nWindows = Math.max(1, Math.ceil((sec.end_frame - sec.start_frame) / p.windowFrames));
    const windowChords: HarmonyChord[] = [];
    let prev: HarmonyChord | null = null;
    for (let i = 0; i < nWindows; i++) {
      const wStart = sec.start_frame + i * p.windowFrames;
      const wEnd = Math.min(sec.end_frame, wStart + p.windowFrames);
      const c = _bestChord(spans, wStart, wEnd, p, prev, tonicPc);
      windowChords.push(c);
      prev = c;
    }
    const collapsed = collapseRuns(windowChords, (a, b) => a.degree === b.degree && a.quality === b.quality);
    if (collapsed.length >= p.minDistinctChords) out.push({ order, chords: collapsed });
  });
  return out;
}
