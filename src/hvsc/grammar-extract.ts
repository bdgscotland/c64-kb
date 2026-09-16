/**
 * Shared SP-grammar extraction: pick a tune's lead melody and mine its grammar
 * (hook + development ops + phrasing profile) into the flat prop shape persisted
 * on the Tune node. Used by both the per-tune hydrate path and the corpus-wide
 * cache back-fill (cluster-grammar) so the two stay in lock-step.
 */
import { computeVoiceStats, classifyVoiceRole, type VoiceStats, type RoleEvent } from "./roles.js";
import { mineGrammar } from "./mine.js";
import type { FalkorHvscClient } from "../services/falkor-hvsc.js";

// Hooks run from 3 notes (below the 4-note motif floor — many hooks are 3-note
// cells) to 6, recurring >= 2x.
export const GRAMMAR_MIN_HOOK = 3, GRAMMAR_MAX_HOOK = 6, GRAMMAR_MIN_OCC = 2;

export interface TuneGrammarProps {
  hook_intervals: string; hook_strength: number; hook_length: number; hook_occurrences: number;
  contour: string; leap_ratio: number; step_ratio: number; repetition_rate: number;
  mean_abs_interval: number; note_count: number;
  dev_repeat: number; dev_sequence: number; dev_invert: number; dev_augment: number; dev_vary: number;
}

/** Pick the melodic lead voice to mine grammar from: the highest-pitched 'lead',
 * else the highest-pitched 'dual', else the highest-pitched non-percussion voice.
 * Returns null when no usable voice exists. */
export function pickLeadVoice(
  stats: Array<VoiceStats & { sidChip: number }>,
): { voice: number; sidChip: number } | null {
  const ranked = (role: (s: VoiceStats) => boolean) =>
    stats.filter(role).sort((a, b) => b.avgPitchHz - a.avgPitchHz)[0];
  const lead = ranked((s) => classifyVoiceRole(s) === "lead");
  const dual = ranked((s) => classifyVoiceRole(s) === "dual");
  const melodic = ranked((s) => classifyVoiceRole(s) !== "percussion");
  const pick = lead ?? dual ?? melodic;
  return pick ? { voice: pick.voice, sidChip: pick.sidChip } : null;
}

/** Mine the lead-voice grammar of one tune's event stream into Tune props.
 * Returns null when there's no usable lead voice. */
export function extractGrammarProps(events: RoleEvent[]): TuneGrammarProps | null {
  if (events.length === 0) return null;
  const lead = pickLeadVoice(computeVoiceStats(events));
  if (!lead) return null;
  const leadEvents = events.filter(
    (e) => (e.sid_chip ?? 1) === lead.sidChip && e.voice === lead.voice,
  );
  const g = mineGrammar(leadEvents, {
    minHookLength: GRAMMAR_MIN_HOOK, maxHookLength: GRAMMAR_MAX_HOOK, minOccurrences: GRAMMAR_MIN_OCC,
  });
  return {
    hook_intervals: g.hook ? JSON.stringify(g.hook.intervals) : "",
    hook_strength: g.hook?.strength ?? 0,
    hook_length: g.hook?.length ?? 0,
    hook_occurrences: g.hook?.occurrences ?? 0,
    contour: g.phrasing.contour_archetype,
    leap_ratio: g.phrasing.leap_ratio,
    step_ratio: g.phrasing.step_ratio,
    repetition_rate: g.phrasing.repetition_rate,
    mean_abs_interval: g.phrasing.mean_abs_interval,
    note_count: g.note_count,
    dev_repeat: g.development.repeat,
    dev_sequence: g.development.sequence,
    dev_invert: g.development.invert,
    dev_augment: g.development.augment,
    dev_vary: g.development.vary,
  };
}

/** Persist a tune's grammar both as Tune props AND as a first-class Hook node
 * (+ Tune-USES_HOOK). Single source of truth for the hydrate + back-fill paths. */
export async function persistTuneGrammar(
  falkor: FalkorHvscClient, fileMd5: string, subtuneIndex: number, props: TuneGrammarProps,
): Promise<void> {
  await falkor.setTuneGrammar(fileMd5, subtuneIndex, props);
  if (props.hook_intervals !== "") {
    await falkor.upsertHook(fileMd5, subtuneIndex, {
      intervals: JSON.parse(props.hook_intervals) as number[],
      strength: props.hook_strength,
      occurrences: props.hook_occurrences,
      n_notes: props.hook_length,
    });
  }
}
