/**
 * Hydrate an extracted tune into the c64_hvsc FalkorDB graph.
 *
 * Each call is idempotent (MERGE-based) — re-running on the same
 * (file_md5, subtune_index) does NOT duplicate nodes.
 *
 * Tune similarity (c64_similar_tunes) is computed by graph overlap over shared
 * canonical vocabulary, not vector embeddings — so nothing here writes Qdrant.
 */

import type { TuneExtract } from "./ingest.js";
import type { FalkorHvscClient } from "../services/falkor-hvsc.js";
import { mineMotifs, mineRhythm, mineHarmony, tonicPcFromKeyName, progressionDegreesString, minePhrases, mineArps, mineForm, mineDirection } from "./mine.js";
import { computeVoiceStats, classifyVoices, analyzeMultiplex, type RoleEvent } from "./roles.js";
import { extractGrammarProps, persistTuneGrammar, pickLeadVoice } from "./grammar-extract.js";
import { parseTuneFunction } from "./title-parser.js";

// Motif mining thresholds (locked 2026-05-20): 4-note motifs (3 intervals)
// repeating >= 2x within a subtune. Balances real riffs/arps against trivial
// fragment noise. See the generative-ontology design (layer 4).
const MOTIF_MIN_LENGTH = 4;
const MOTIF_MIN_OCCURRENCES = 2;

// Rhythm mining (layer 4r): same n-gram thresholds as motifs — 4-note cells
// repeating >= 2x within a subtune.
const RHYTHM_MIN_LENGTH = 4;
const RHYTHM_MIN_OCCURRENCES = 2;
// PAL frames/minute = 50 * 60 = 3000; frames per sixteenth = (3000/bpm)/4 = 750/bpm.
const PAL_FRAMES_PER_SIXTEENTH_NUMERATOR = 750;

// A voice "uses vibrato" only if at least this share of its analyzable (long)
// notes vibrato — keeps incidental wobble from tagging the whole voice.
const GESTURE_MIN_FRACTION = 0.25;

// Phrase mining (SP-phrase): 5-note fused pitch+rhythm n-grams repeating >= 2x.
const PHRASE_LEN = 5;
const PHRASE_MIN_OCCURRENCES = 2;

// Arp mining (SP-arp): fast-cycling pitch patterns per voice.
const ARP_MIN_STEPS = 6, ARP_MAX_TONES = 4, ARP_MAX_RATE_FRAMES = 6, ARP_PERIOD_MAX = 4;

// Harmony (SP-harmony): beat-window chord inference per section. Window = one beat
// when tempo is known (PAL frames/beat = 3000/bpm), else a fixed fallback.
const HARMONY_WINDOW_FALLBACK_FRAMES = 24;
const HARMONY_WEAK_WINDOW_MIN_WEIGHT = 0.5;
const HARMONY_MIN_DISTINCT_CHORDS = 2;
const PAL_FRAMES_PER_MINUTE = 3000;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface HydrateOpts {
  falkor: FalkorHvscClient;
  // Vestigial: hydrate never writes Qdrant. Retained because the orchestrator +
  // ingest callers still thread it.
  skipQdrant?: boolean;
}

export interface CatalogEnrichment {
  length_sec?: number;          // from Songlengths.md5 lookup for this (md5, subtune)
  stil_comment?: string;        // from STIL.txt entry's comment field
  stil_credits?: Array<{ name: string; role: string }>;  // forwarded to M4 (CREDITED_IN edges)
  stil_title?: string;          // STIL TITLE: — the cover-source title
  stil_name?: string;           // STIL NAME: — alternate/long name
  stil_cover_relations?: Array<{ kind: string; target_path: string }>;
}

interface TuneMetaShape {
  title: string;
  composer?: string;
  year?: number;
  chip?: "6581" | "8580" | "either";
  region?: "PAL" | "NTSC" | "both";
  length_sec?: number;
  hvsc_path: string;
}

export async function hydrateOneTune(
  extract: TuneExtract,
  opts: HydrateOpts,
  enrichment: CatalogEnrichment = {},
): Promise<void> {
  const meta = extract.meta as unknown as TuneMetaShape;

  // Layer 7 (Function) extraction — parse tune title + STIL cover-source title
  // into function_role / source_work / level_number / section_marker.  Pure
  // regex/structural; no I/O.  See src/hvsc/title-parser.ts.
  const fn = parseTuneFunction(meta.title, enrichment.stil_title);

  await opts.falkor.upsertTune({
    file_md5: extract.file_md5,
    subtune_index: extract.subtune_index,
    title: meta.title,
    composer: meta.composer ?? "Unknown",
    year: meta.year ?? null,
    chip: meta.chip ?? "either",
    region: meta.region ?? "PAL",
    length_sec: enrichment.length_sec ?? meta.length_sec ?? null,
    hvsc_path: meta.hvsc_path,
    stil_comment: enrichment.stil_comment ?? "",
    stil_title: enrichment.stil_title ?? "",
    stil_name: enrichment.stil_name ?? "",
    function_role: fn.function_role,
    source_work: fn.source_work,
    source_type: fn.source_type,
    level_number: fn.level_number,
    section_marker: fn.section_marker,
    // NEW (M4.1): tracker / driver / credits
    tracker_id: (meta as any).tracker_id ?? "unknown",
    tracker_confidence: (meta as any).tracker_confidence ?? 0.0,
    driver_hash: (extract.driver as any)?.hash ?? "",
    driver_byte_signature: (extract.driver as any)?.byte_signature ?? "",
    driver_play_offset: (extract.driver as any)?.play_offset ?? 0,
    driver_init_offset: (extract.driver as any)?.init_offset ?? 0,
    sid_count: (meta as any).sid_count ?? 1,
    is_rsid: (meta as any).is_rsid ?? false,
    credits: enrichment.stil_credits ?? [],
    // NEW (Phase 0c):
    key_signature: (meta as any).key_signature ?? null,
    key_mode: (meta as any).key_mode ?? null,
    key_confidence: (meta as any).key_confidence ?? 0.0,
    tempo_bpm: (meta as any).tempo_bpm ?? null,
    time_signature_numerator: (meta as any).time_signature_numerator ?? null,
    time_signature_denominator: (meta as any).time_signature_denominator ?? null,
    top_instruments: (meta as any).top_instruments ?? [],
    sid_native: (meta as any).sid_native ?? {},
  });

  // STIL cover relations (REMIX/EDIT/VERSION/COVER/...).  Best-effort: the
  // target Tune may not be in the graph yet (depending on ingest order); the
  // backfill script resolves whatever's still unresolved once the full corpus
  // is loaded.  No-op when there are no relations.
  if ((enrichment.stil_cover_relations ?? []).length > 0) {
    await opts.falkor.upsertCoverRelations(
      extract.file_md5,
      extract.subtune_index,
      enrichment.stil_cover_relations ?? [],
    );
  }

  const patches = (extract as unknown as { patches?: Array<Record<string, unknown>> }).patches ?? [];
  if (patches.length > 0) {
    // The Python extractor now emits one record per (patch_hash, sid_chip, voice)
    // carrying real per-voice provenance (was hardcoded voice 0). Pass it through
    // so USES_PATCH.voice is real and upsertVoiceParts can build PLAYS_PATCH edges.
    await opts.falkor.upsertPatches(
      extract.file_md5,
      extract.subtune_index,
      patches.map((p) => ({
        ...p,
        voice: (p.voice as number) ?? 0,
        sid_chip: (p.sid_chip as number) ?? 1,
        occurrences: (p.occurrences as number) ?? 1,
      })),
    );
  }

  // Song-form structure (layer 2): detect_sections() already runs in the
  // Python extractors and rides along in extract.structure. Persist it as
  // Section nodes. Guarded on sections.length so structure-less extracts
  // (and the legacy mock-falkor tests) don't touch the new code path.
  const structure = (extract as unknown as {
    structure?: {
      sections?: Array<{ label: string; start_frame: number; end_frame: number; repeat_of?: string | null }>;
      repeat_shape?: string | null;
      intro_frames?: number;
    };
  }).structure ?? {};
  if ((structure.sections?.length ?? 0) > 0) {
    await opts.falkor.upsertSections(extract.file_md5, extract.subtune_index, structure);
  }

  // Harmony (SP-harmony): infer a key-relative chord progression per section from
  // the event stream and persist Progression nodes. Runs AFTER upsertSections
  // (Section nodes must exist) and is guarded on a parseable key + sections.
  const harmonyEvents = (extract as unknown as {
    events?: Array<{ frame: number; voice: number; kind: string; pitch: number; sid_chip?: number }>;
  }).events ?? [];
  const tonicPc = tonicPcFromKeyName((extract.meta as Record<string, unknown>).key_signature as string | null);
  if ((structure.sections?.length ?? 0) > 0 && harmonyEvents.length > 0 && tonicPc !== null) {
    const tempo = (extract.meta as Record<string, unknown>).tempo_bpm as number | null;
    const windowFrames =
      typeof tempo === "number" && tempo > 0 && tempo <= 300
        ? Math.max(1, Math.round(PAL_FRAMES_PER_MINUTE / tempo))
        : HARMONY_WINDOW_FALLBACK_FRAMES;
    const mode = ((extract.meta as Record<string, unknown>).key_mode as string) === "minor" ? "minor" : "major";
    const progs = mineHarmony(
      harmonyEvents,
      (structure.sections ?? []).map((s: { start_frame: number; end_frame: number }) => ({ start_frame: s.start_frame, end_frame: s.end_frame })),
      tonicPc,
      { windowFrames, weakWindowMinWeight: HARMONY_WEAK_WINDOW_MIN_WEIGHT, minDistinctChords: HARMONY_MIN_DISTINCT_CHORDS, mode },
    );
    if (progs.length > 0) {
      await opts.falkor.upsertProgressions(
        extract.file_md5,
        extract.subtune_index,
        progs.map((sp) => ({
          order: sp.order,
          degrees: progressionDegreesString(sp.chords),
          length: sp.chords.length,
        })),
      );
    }
  }

  // Motifs (layer 4): mine repeated pitch-interval n-grams per voice from the
  // note-event stream (previously extracted then dropped). One MotifMatch is
  // per-voice, so all its occurrences share a voice.
  const events = (extract as unknown as { events?: Array<{ frame: number; voice: number; kind: string; pitch: number }> }).events ?? [];
  if (events.length > 0) {
    const matches = mineMotifs(events, { minLength: MOTIF_MIN_LENGTH, minOccurrences: MOTIF_MIN_OCCURRENCES });
    if (matches.length > 0) {
      await opts.falkor.upsertMotifs(
        extract.file_md5,
        extract.subtune_index,
        matches.map((m) => ({
          intervals: m.intervals,
          voice: m.occurrences[0]?.voice ?? 0,
          occurrences: m.occurrences.length,
        })),
      );
    }
  }

  // Rhythm (layer 4r): mine per-voice note-timing cells from the event stream,
  // quantized to a tempo-derived sixteenth grid (median-ioi fallback inside
  // mineRhythm when tempo is missing/implausible). Must run before
  // upsertVoiceParts (which links PLAYS_RHYTHM).
  if (events.length > 0) {
    const tempo = (extract.meta as Record<string, unknown>).tempo_bpm as number | null;
    const stepFrames =
      typeof tempo === "number" && tempo > 0 && tempo <= 300
        ? Math.max(1, Math.round(PAL_FRAMES_PER_SIXTEENTH_NUMERATOR / tempo))
        : undefined;
    const cells = mineRhythm(events, {
      minLength: RHYTHM_MIN_LENGTH,
      minOccurrences: RHYTHM_MIN_OCCURRENCES,
      stepFrames,
    });
    if (cells.length > 0) {
      await opts.falkor.upsertRhythm(extract.file_md5, extract.subtune_index, cells);
    }
  }

  // Voice roles (layer 3): classify each (sid_chip, voice) from the event stream
  // and persist VoicePart, linking PLAYS->Motif (motifs upserted just above).
  if (events.length > 0) {
    const stats = computeVoiceStats(events);
    if (stats.length > 0) {
      const mux = analyzeMultiplex(events);
      const roles = classifyVoices(stats);   // #1 relative within-tune (lowest=bass, highest=lead)
      await opts.falkor.upsertVoiceParts(
        extract.file_md5,
        extract.subtune_index,
        stats.map((s, i) => {
          const m = mux.get(`${s.sidChip}:${s.voice}`);
          return {
            voice: s.voice,
            sid_chip: s.sidChip,
            role: roles[i],
            avgPitchHz: s.avgPitchHz,
            pitchRange: s.pitchRange,
            noteCount: s.noteCount,
            noisePercent: s.noisePercent,
            avgGateLengthFrames: s.avgGateLengthFrames,
            rhythmRegularity: s.rhythmRegularity,
            multiplex: m?.multiplex ?? false,
            roleSet: m?.role_set ?? [],
            gapFillRate: m?.gap_fill_rate ?? 0,
          };
        }),
      );
    }
  }

  // Timbre gestures (layer 6 — PWM/filter articulation): aggregate per-patch
  // coarse gesture descriptors per (voice, sid_chip, kind, gesture_hash).
  // count = patch occurrences for that gesture on that voice;
  // fraction = count / total patch occurrences on that voice+chip.
  // Runs AFTER upsertVoiceParts (USES_TIMBRE_GESTURE is a VoicePart edge).
  {
    type GestureDesc = {
      kind: string; archetype: string; depth_band: string; rate_band: string;
      resonance_band?: string; mode?: string; gesture_hash: string; template: number[];
    };
    type PatchWithGesture = {
      voice?: number; sid_chip?: number; occurrences?: number;
      pwm_gesture?: GestureDesc | null;
      filter_gesture?: GestureDesc | null;
    };
    const typedPatches = patches as PatchWithGesture[];
    // total patch occurrences per (voice, sid_chip) — denominator for fraction.
    const voiceTotals = new Map<string, number>();
    for (const p of typedPatches) {
      const k = `${p.sid_chip ?? 1}:${p.voice ?? 0}`;
      voiceTotals.set(k, (voiceTotals.get(k) ?? 0) + (p.occurrences ?? 1));
    }
    // Accumulate gesture counts per (voice, sid_chip, kind, gesture_hash).
    type GestureKey = string;
    const gestureAcc = new Map<GestureKey, {
      voice: number; sid_chip: number;
      kind: "pwm" | "filter";
      archetype: string; depth_band: string; rate_band: string;
      resonance_band?: string; mode?: string;
      gesture_hash: string; template: number[];
      count: number;
    }>();
    for (const p of typedPatches) {
      const voice = p.voice ?? 0;
      const chip = p.sid_chip ?? 1;
      const occ = p.occurrences ?? 1;
      for (const [kindKey, gest] of [
        ["pwm", p.pwm_gesture],
        ["filter", p.filter_gesture],
      ] as [string, GestureDesc | null | undefined][]) {
        if (!gest) continue;
        const k: GestureKey = `${chip}:${voice}:${kindKey}:${gest.gesture_hash}`;
        const existing = gestureAcc.get(k);
        if (existing) {
          existing.count += occ;
        } else {
          gestureAcc.set(k, {
            voice, sid_chip: chip,
            kind: kindKey as "pwm" | "filter",
            archetype: gest.archetype,
            depth_band: gest.depth_band,
            rate_band: gest.rate_band,
            resonance_band: gest.resonance_band,
            mode: gest.mode,
            gesture_hash: gest.gesture_hash,
            template: gest.template,
            count: occ,
          });
        }
      }
    }
    if (gestureAcc.size > 0) {
      const timbreGestures = Array.from(gestureAcc.values()).map((g) => {
        // Invariant: voiceTotals always has this key (it was populated from the
        // same patches a gesture was accumulated from) and is always >= 1, so
        // the `?? 1` is a defensive default, not a real divide-by-zero path.
        const totalOcc = voiceTotals.get(`${g.sid_chip}:${g.voice}`) ?? 1;
        return { ...g, fraction: g.count / totalOcc };
      });
      await opts.falkor.upsertTimbreGestures(
        extract.file_md5,
        extract.subtune_index,
        timbreGestures,
      );
    }
  }

  // Gestures (layer 6 — vibrato): aggregate the Python per-note vibrato results
  // per voice. A voice uses vibrato if a meaningful fraction of its analyzable
  // notes do; params are the median rate/depth/onset over the vibrato'd notes.
  // Runs AFTER upsertVoiceParts (USES_GESTURE is a VoicePart edge).
  const vibrato = (extract as unknown as {
    vibrato?: Array<{ voice: number; sid_chip: number; has_vibrato: boolean;
                      rate_frames?: number; depth_cents?: number; onset_delay_frames?: number }>;
  }).vibrato ?? [];
  if (vibrato.length > 0) {
    const byVoice = new Map<string, typeof vibrato>();
    for (const r of vibrato) {
      const k = `${r.sid_chip}:${r.voice}`;
      const arr = byVoice.get(k) ?? [];
      arr.push(r);
      byVoice.set(k, arr);
    }
    const gestures: Array<{ voice: number; sid_chip: number; rate_frames: number;
                            depth_cents: number; onset_delay_frames: number; fraction: number }> = [];
    for (const [k, recs] of byVoice) {
      const vd = recs.filter((r) => r.has_vibrato);
      if (vd.length === 0) continue;
      const fraction = vd.length / recs.length;
      if (fraction < GESTURE_MIN_FRACTION) continue;
      const [chip, voice] = k.split(":").map(Number);
      gestures.push({
        voice, sid_chip: chip,
        rate_frames: Math.round(median(vd.map((r) => r.rate_frames ?? 0))),
        depth_cents: median(vd.map((r) => r.depth_cents ?? 0)),
        onset_delay_frames: Math.round(median(vd.map((r) => r.onset_delay_frames ?? 0))),
        fraction,
      });
    }
    if (gestures.length > 0) {
      await opts.falkor.upsertGestures(extract.file_md5, extract.subtune_index, gestures);
    }
  }

  // Phrases (SP-phrase): mine fused pitch+rhythm 5-grams per voice, quantized to
  // the same tempo-derived sixteenth grid as the rhythm block. USES_PHRASE is a
  // VoicePart edge, so this runs AFTER upsertVoiceParts.
  if (events.length > 0) {
    const tempo = (extract.meta as Record<string, unknown>).tempo_bpm as number | null;
    const stepFrames =
      typeof tempo === "number" && tempo > 0 && tempo <= 300
        ? Math.max(1, Math.round(PAL_FRAMES_PER_SIXTEENTH_NUMERATOR / tempo))
        : undefined;
    const phr = minePhrases(events, { length: PHRASE_LEN, minOccurrences: PHRASE_MIN_OCCURRENCES, stepFrames });
    if (phr.length > 0) await opts.falkor.upsertPhrases(extract.file_md5, extract.subtune_index, phr);

    const arps = mineArps(events, { minSteps: ARP_MIN_STEPS, maxTones: ARP_MAX_TONES, maxRateFrames: ARP_MAX_RATE_FRAMES, periodMax: ARP_PERIOD_MAX });
    if (arps.length > 0) await opts.falkor.upsertArps(extract.file_md5, extract.subtune_index, arps);
  }

  // Grammar (SP-grammar, layer 4): mine the lead melody's hook + development ops
  // + phrasing profile and store as Tune props (composer-level stats aggregate at
  // query time, like timbre). Runs AFTER voice roles so we can pick the lead.
  if (events.length > 0) {
    const grammar = extractGrammarProps(events as RoleEvent[]);
    if (grammar) {
      await persistTuneGrammar(opts.falkor, extract.file_md5, extract.subtune_index, grammar);
    }
  }

  // Form-as-dynamics (SP-form, layer 5): per-section energy + the arc archetype. Runs AFTER
  // upsertSections (Section nodes must exist) and is guarded on sections + events.
  if ((structure.sections?.length ?? 0) > 0 && events.length > 0) {
    const form = mineForm(
      events as RoleEvent[],
      (structure.sections ?? []).map((s, i) => ({ order: i, start_frame: s.start_frame, end_frame: s.end_frame })),
    );
    await opts.falkor.upsertForm(extract.file_md5, extract.subtune_index, form);
  }

  // Direction (SP-direction, layer 4b): lead-voice cadence + voice-leading + Q&A vs the key.
  if (events.length > 0 && tonicPc !== null) {
    const lead = pickLeadVoice(computeVoiceStats(events as RoleEvent[]));
    if (lead) {
      const leadEvents = (events as RoleEvent[]).filter((e) => (e.sid_chip ?? 1) === lead.sidChip && e.voice === lead.voice);
      const dir = mineDirection(leadEvents, tonicPc);
      if (dir.n_phrases > 0) await opts.falkor.upsertDirection(extract.file_md5, extract.subtune_index, dir);
    }
  }
}
