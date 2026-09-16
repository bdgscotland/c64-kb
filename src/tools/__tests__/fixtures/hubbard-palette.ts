/** A trimmed but representative Rob Hubbard palette (captured from
 * c64_composer_palette on 2026-05-21), used as an injected fixture so the pure
 * Score-builder can be unit-tested without a live FalkorDB. */
import type { ComposerPalette } from "../../auto-compose.js";

export const HUBBARD_PALETTE: ComposerPalette = {
  composer: "Rob Hubbard",
  tunes: 91,
  patches: [
    { id: "6dfb20e1df2b785f", key: "0,0,3,3|pulse|true|hr", weight: 622 },
    { id: "1f2c76ae64772a72", key: "0,2,2,3|pulse|false|hr", weight: 287 },
    { id: "0462f31157da0ab2", key: "0,2,2,3|pulse|false|", weight: 93 },
    { id: "a31de2196e993743", key: "1,2,1,2|pulse|false|", weight: 80 },
  ],
  motifs: [
    { id: "e7e423867efe6b8a", key: "1,-1,1", weight: 152 },
    { id: "bb9d0f126f7fb9cf", key: "-1,1,-1", weight: 135 },
  ],
  gestures: [
    { kind: "vibrato", rate_frames: 8, depth_cents: 20, weight: 21 },
    { kind: "vibrato", rate_frames: 3, depth_cents: 30, weight: 10 },
  ],
  rhythms: [
    { slots: "[[1,1],[1,1],[1,1],[1,1]]", n_notes: 4, occurrences: 3081 },
    { slots: "[[2,1],[2,1],[2,1],[2,1]]", n_notes: 4, occurrences: 1074 },
  ],
  song_forms: [
    { label: "loop", count: 48 },
    { label: "AB", count: 18 },
    { label: "ABC", count: 3 },
    { label: "ABA", count: 1 },
  ],
  voice_roles: [
    { label: "lead", count: 98, role: "lead" },
    { label: "bass", count: 57, role: "bass" },
    { label: "percussion", count: 44, role: "percussion" },
    { label: "dual", count: 9, role: "dual" },
    { label: "arp", count: 5, role: "arp" },
  ],
  progressions: [
    { degrees: "11min-8min", length: 2, weight: 13, roman: "vii-bvi" },
    { degrees: "0min-8maj", length: 2, weight: 5, roman: "i-bVI" },
    { degrees: "5maj-0maj", length: 2, weight: 4, roman: "IV-I" },
    { degrees: "0maj-3maj", length: 2, weight: 3, roman: "I-bIII" },
  ],
  phrases: [
    { intervals: [0, 0, 3, 2], iois: [2, 2, 2, 4, 1], gates: [1, 1, 1, 1, 1], n_notes: 5, weight: 3,
      beats_hint: { iois_beats: [0.5, 0.5, 0.5, 1, 0.25], gates_beats: [0.25, 0.25, 0.25, 0.25, 0.25] } },
    { intervals: [0, 0, 0, 3], iois: [1, 2, 2, 2, 1], gates: [1, 1, 1, 1, 1], n_notes: 5, weight: 3,
      beats_hint: { iois_beats: [0.25, 0.5, 0.5, 0.5, 0.25], gates_beats: [0.25, 0.25, 0.25, 0.25, 0.25] } },
    { intervals: [0, 3, 0, -1], iois: [6, 1, 7, 1, 7], gates: [6, 1, 7, 1, 7], n_notes: 5, weight: 2,
      beats_hint: { iois_beats: [1.5, 0.25, 1.75, 0.25, 1.75], gates_beats: [1.5, 0.25, 1.75, 0.25, 1.75] } },
    // an octave-jump phrase — too wide for a singable lead; the builder should skip it
    { intervals: [-20, 2, 18, -18], iois: [2, 2, 4, 2, 2], gates: [1, 2, 4, 1, 2], n_notes: 5, weight: 2,
      beats_hint: { iois_beats: [0.5, 0.5, 1, 0.5, 0.5], gates_beats: [0.25, 0.5, 1, 0.25, 0.5] } },
    { intervals: [-1, 1, -1, 1], iois: [1, 1, 1, 1, 1], gates: [1, 1, 1, 1, 1], n_notes: 5, weight: 2,
      beats_hint: { iois_beats: [0.25, 0.25, 0.25, 0.25, 0.25], gates_beats: [0.25, 0.25, 0.25, 0.25, 0.25] } },
  ],
  arps: [
    { chord_intervals: [0, 12, 24], cycle: [12, 0, 12, 0], n_steps: 4, rate_frames: 6, rate_hz: 8.3, quality: "other", weight: 1 },
  ],
  timbre: {
    n_tunes: 91,
    filter: { dominant_mode: "lp", active_fraction: 0.198, cutoff_mean: 95.7, cutoff_std: 48.2, resonance_mean: 1.3, routed_rate: 0.013 },
    pwm: { depth: 196.8, mean_width: 947.9 },
  },
  drums: {
    n_percussion_voices: 44,
    rhythms: [
      { iois: [1, 1, 1, 1, 1], gates: [1, 1, 1, 1, 1], weight: 52 },
      { iois: [1, 2, 1, 1, 1], gates: [1, 1, 1, 1, 1], weight: 37 },
    ],
    noise_patch: { adsr: [0, 2, 0, 0] },
  },
  multiplex: {
    n_voices: 213,
    multiplex_rate: 0.023,
    gap_fill_rate: 0,
    common_role_pairs: [{ pair: "dual,lead", count: 2 }],
  },
};

/** A contrasting palette (Galway-ish stand-in) for the scramble_palette ablation
 * test: different progressions/phrases so we can assert the swap took effect. */
export const OTHER_PALETTE: ComposerPalette = {
  ...HUBBARD_PALETTE,
  composer: "Martin Galway",
  progressions: [
    { degrees: "0maj-5maj", length: 2, weight: 9, roman: "I-IV" },
    { degrees: "0maj-7maj", length: 2, weight: 6, roman: "I-V" },
  ],
  phrases: [
    { intervals: [2, 2, 1, 2], iois: [2, 2, 2, 2, 1], gates: [1, 1, 1, 1, 1], n_notes: 5, weight: 5,
      beats_hint: { iois_beats: [0.5, 0.5, 0.5, 0.5, 0.25], gates_beats: [0.25, 0.25, 0.25, 0.25, 0.25] } },
  ],
  song_forms: [{ label: "ABAB", count: 12 }, { label: "AB", count: 6 }],
};
