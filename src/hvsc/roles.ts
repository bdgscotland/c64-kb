/**
 * Heuristic voice-role classifier (v1).
 *
 * SID has no fixed channel semantics (unlike NES's square1/square2/triangle/
 * noise), so bass/lead/arp/percussion is a learned label per (tune, voice).
 *
 * v1 uses simple thresholds; gold-set acceptance threshold is F1 >= 0.85
 * macro across 5 classes. If we don't hit that, we move to a learned
 * classifier in v2 (planned for Phase 1).
 */

export type VoiceRole = "lead" | "bass" | "arp" | "percussion" | "dual";

export interface VoiceStats {
  voice: number;             // 1, 2, or 3
  avgPitchHz: number;
  pitchRange: number;        // max - min pitch in Hz
  noteCount: number;
  noisePercent: number;      // 0-1: fraction of gate-on events with NOISE waveform
  avgGateLengthFrames: number;
  rhythmRegularity: number;  // 0-1: 1 = perfectly periodic gate triggers
  distinctPitches: number;   // # distinct semitone pitches among on-events (lead=many, arp=few)
  arpScore: number;          // 0-1: max periodicity of the pitch sequence at lag 2-4 (a real arp cycles chord tones)
}

export interface RoleEvent {
  frame: number;
  voice: number;
  kind: string;       // "on" | "off"
  pitch: number;      // Hz
  sid_chip?: number;
  waveform?: string;
}

/**
 * Aggregate a note-event stream into per-(sid_chip, voice) VoiceStats, ready to
 * feed classifyVoiceRole. Voices with no gate-on notes are omitted. Output is
 * sorted by (sid_chip, voice) for determinism.
 */
export function computeVoiceStats(
  events: RoleEvent[],
): Array<VoiceStats & { sidChip: number }> {
  const groups = new Map<string, RoleEvent[]>();
  for (const e of events) {
    const chip = e.sid_chip ?? 1;
    const key = `${chip}:${e.voice}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  const out: Array<VoiceStats & { sidChip: number }> = [];
  for (const [key, evs] of groups) {
    const [chipStr, voiceStr] = key.split(":");
    const sidChip = Number(chipStr);
    const voice = Number(voiceStr);

    const ons = evs.filter((e) => e.kind === "on");
    const noteCount = ons.length;
    if (noteCount === 0) continue;

    const pitches = ons.map((e) => e.pitch).filter((p) => p > 0);
    let avgPitchHz = 0;
    let pitchRange = 0;
    if (pitches.length > 0) {
      let sum = 0, min = pitches[0], max = pitches[0];
      for (const p of pitches) {
        sum += p;
        if (p < min) min = p;
        if (p > max) max = p;
      }
      avgPitchHz = sum / pitches.length;
      pitchRange = max - min;
    }

    const noiseCount = ons.filter((e) => e.waveform === "noise").length;
    const noisePercent = noiseCount / noteCount;

    // Gate lengths: pair each on with the next off, in frame order.
    const sorted = [...evs].sort((a, b) => a.frame - b.frame);
    const gateLengths: number[] = [];
    let openFrame: number | null = null;
    for (const e of sorted) {
      if (e.kind === "on") openFrame = e.frame;
      else if (e.kind === "off" && openFrame !== null) {
        gateLengths.push(e.frame - openFrame);
        openFrame = null;
      }
    }
    const avgGateLengthFrames = gateLengths.length
      ? gateLengths.reduce((a, b) => a + b, 0) / gateLengths.length
      : 0;

    // Rhythm regularity: 1 - coefficient of variation of inter-onset intervals.
    const onFrames = ons.map((e) => e.frame).sort((a, b) => a - b);
    let rhythmRegularity = 0;
    if (onFrames.length >= 3) {
      const iois: number[] = [];
      for (let i = 1; i < onFrames.length; i++) iois.push(onFrames[i] - onFrames[i - 1]);
      const mean = iois.reduce((a, b) => a + b, 0) / iois.length;
      if (mean > 0) {
        const variance = iois.reduce((a, b) => a + (b - mean) ** 2, 0) / iois.length;
        const cv = Math.sqrt(variance) / mean;
        rhythmRegularity = Math.max(0, Math.min(1, 1 - cv));
      }
    }

    // pitch-sequence features (onset order): distinct pitches + arp periodicity.
    const midiSeq = ons.slice().sort((a, b) => a.frame - b.frame)
      .map((e) => e.pitch).filter((p) => p > 0)
      .map((hz) => Math.round(69 + 12 * Math.log2(hz / 440)));
    const distinctPitches = new Set(midiSeq).size;
    let arpScore = 0;
    for (const p of [2, 3, 4]) {
      if (midiSeq.length > p + 2) {
        let same = 0;
        for (let i = p; i < midiSeq.length; i++) if (midiSeq[i] === midiSeq[i - p]) same++;
        arpScore = Math.max(arpScore, same / (midiSeq.length - p));
      }
    }

    out.push({
      voice, sidChip, avgPitchHz, pitchRange, noteCount,
      noisePercent, avgGateLengthFrames, rhythmRegularity,
      distinctPitches, arpScore: Math.round(arpScore * 1000) / 1000,
    });
  }

  out.sort((a, b) => a.sidChip - b.sidChip || a.voice - b.voice);
  return out;
}

const NOISE_PERCUSSION_THRESHOLD = 0.5;
// v1.1 (2026-05-21): the old 200/250 Hz split over-labelled mid/high voices as "bass"
// and left a 200-250 Hz dead-zone -> "dual" (leads were under-detected). Tightened so
// only genuinely low voices are bass (~<E3) and the dead-zone is narrow (165-185 Hz).
// The robust fix remains the planned v2 RELATIVE/learned classifier (rank voices within
// a tune: lowest pitch = bass, most-melodic high = lead) — these are still absolute.
const BASS_PITCH_CEILING_HZ = 165;
const LEAD_PITCH_FLOOR_HZ = 185;
// #2 arp detector (2026-05-21): a real arp is a short cycle through chord tones, so the
// pitch sequence REPEATS at lag 2-4 (high arpScore), uses few distinct pitches, and is busy.
// This replaces the leaky "gate<=3 + regular + >50 notes" proxy (which also caught fast leads).
const ARP_SCORE_FLOOR = 0.6;
const ARP_DISTINCT_MIN = 2;   // cycles >=2 pitches (excludes a droning single note)
const ARP_DISTINCT_MAX = 6;   // ...but few (excludes melodies)
const ARP_MIN_NOTES = 30;

function isArp(s: VoiceStats): boolean {
  return s.arpScore >= ARP_SCORE_FLOOR &&
    s.distinctPitches >= ARP_DISTINCT_MIN &&
    s.distinctPitches <= ARP_DISTINCT_MAX &&
    s.noteCount > ARP_MIN_NOTES;
}

/**
 * Classify a single voice's role based on aggregated stats over a song
 * section (or whole song if no sections detected).
 *
 * Order of checks matters: noise % first (percussion), then arp (fast
 * cyclic notes), then bass (low pitch), then lead (high pitch). Anything
 * unclassified falls to "dual".
 */
export function classifyVoiceRole(s: VoiceStats): VoiceRole {
  if (s.noisePercent > NOISE_PERCUSSION_THRESHOLD) return "percussion";
  if (isArp(s)) return "arp";
  if (s.avgPitchHz < BASS_PITCH_CEILING_HZ) return "bass";
  if (s.avgPitchHz >= LEAD_PITCH_FLOOR_HZ) return "lead";
  return "dual";
}

const BASS_PLAUSIBILITY_CEILING_HZ = 330;   // a "lowest" voice above ~E4 isn't really a bass

/**
 * #1 RELATIVE classifier: assign roles to a tune's voices *together* so bass/lead are
 * decided by rank within the tune, not by absolute Hz (which mislabeled mid/high leads
 * as bass). Percussion (noise) and arp (periodic chord cycle) are intrinsic per-voice;
 * the remaining pitched voices are ranked by pitch: lowest = bass (if plausibly low),
 * highest = lead, middle(s) = dual. Grouped per sid_chip (each chip is its own 3 voices).
 * Returns roles aligned to the input order. Falls back to absolute classifyVoiceRole for
 * a single pitched voice (no rank context).
 */
export function classifyVoices(stats: Array<VoiceStats & { sidChip?: number }>): VoiceRole[] {
  const roles = new Array<VoiceRole>(stats.length);
  const groups = new Map<number, number[]>();
  stats.forEach((s, i) => {
    const c = s.sidChip ?? 1;
    const arr = groups.get(c) ?? [];
    arr.push(i);
    groups.set(c, arr);
  });
  for (const idxs of groups.values()) {
    const pitched: number[] = [];
    for (const i of idxs) {
      const s = stats[i];
      if (s.noisePercent > NOISE_PERCUSSION_THRESHOLD) roles[i] = "percussion";
      else if (isArp(s)) roles[i] = "arp";
      else pitched.push(i);
    }
    pitched.sort((a, b) => stats[a].avgPitchHz - stats[b].avgPitchHz);
    if (pitched.length === 1) {
      roles[pitched[0]] = classifyVoiceRole(stats[pitched[0]]);   // no rank context -> absolute
    } else if (pitched.length >= 2) {
      const lo = pitched[0], hi = pitched[pitched.length - 1];
      roles[lo] = stats[lo].avgPitchHz < BASS_PLAUSIBILITY_CEILING_HZ ? "bass" : "dual";
      roles[hi] = "lead";
      for (let k = 1; k < pitched.length - 1; k++) roles[pitched[k]] = "dual";
    }
  }
  return roles;
}

// --- SP-multiplex Part B: per-voice role timeline + multiplex detection ---

export interface MultiplexResult {
  multiplex: boolean;
  role_set: string[];      // distinct roles seen across the song's windows
  gap_fill_rate: number;   // fraction of this voice's noise hits interleaved between non-noise notes
}

const MUX_WINDOWS = 4;
const MUX_MIN_WINDOW_NOTES = 4;
const MUX_MINORITY_MIN = 0.1;

/** Per (sid_chip, voice): segment the song into windows, classify each (reusing
 * classifyVoiceRole), and flag multiplexing. A voice is multiplexed when it shows ≥2
 * distinct roles across windows OR mixes noise + non-noise gate-ons (the percussion-in-
 * melody interleave). Pure — no DB. Key = `${chip}:${voice}`. */
export function analyzeMultiplex(events: RoleEvent[]): Map<string, MultiplexResult> {
  const byVoice = new Map<string, RoleEvent[]>();
  for (const e of events) {
    const k = `${e.sid_chip ?? 1}:${e.voice}`;
    const arr = byVoice.get(k) ?? [];
    arr.push(e);
    byVoice.set(k, arr);
  }
  const maxFrame = events.reduce((m, e) => Math.max(m, e.frame), 0) || 1;
  const out = new Map<string, MultiplexResult>();
  for (const [k, evs] of byVoice) {
    const ons = evs.filter((e) => e.kind === "on").sort((a, b) => a.frame - b.frame);
    const roles = new Set<string>();
    const wlen = Math.max(1, Math.ceil((maxFrame + 1) / MUX_WINDOWS));
    for (let w = 0; w < MUX_WINDOWS; w++) {
      const lo = w * wlen, hi = (w + 1) * wlen;
      const we = evs.filter((e) => e.frame >= lo && e.frame < hi);
      if (we.filter((e) => e.kind === "on").length < MUX_MIN_WINDOW_NOTES) continue;
      const stats = computeVoiceStats(we);
      if (stats.length > 0) roles.add(classifyVoiceRole(stats[0]));
    }
    if (roles.size === 0) {
      const s = computeVoiceStats(evs);
      if (s.length > 0) roles.add(classifyVoiceRole(s[0]));
    }
    const noiseCount = ons.filter((e) => e.waveform === "noise").length;
    let interleaved = 0;
    for (let i = 1; i < ons.length - 1; i++) {
      if (ons[i].waveform === "noise" && ons[i - 1].waveform !== "noise" && ons[i + 1].waveform !== "noise") interleaved++;
    }
    const gap_fill_rate = noiseCount > 0 ? interleaved / noiseCount : 0;
    const melCount = ons.length - noiseCount;
    const minority = ons.length > 0 ? Math.min(noiseCount, melCount) / ons.length : 0;
    const multiplex = roles.size >= 2 || (noiseCount > 0 && melCount > 0 && minority >= MUX_MINORITY_MIN);
    out.set(k, { multiplex, role_set: [...roles].sort(), gap_fill_rate: Math.round(gap_fill_rate * 1000) / 1000 });
  }
  return out;
}
