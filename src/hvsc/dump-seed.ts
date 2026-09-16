/** Dump a seed tune's mined vocabulary from c64_hvsc into the JSON shape the
 * Python generation assembler (realize.py) consumes. Read-only. */
import type { FalkorHvscClient } from "../services/falkor-hvsc.js";

export interface SeedVocabulary {
  tune: { key_signature: string | null; key_mode: string | null; tempo_bpm: number | null; repeat_shape: string | null; chip: string | null };
  sections: Array<{ order: number; label: string; start_frame: number; end_frame: number; length_frames: number }>;
  voices: Array<{
    voice: number; sid_chip: number; role: string; avg_pitch_hz: number; pitch_range: number;
    motifs: Array<{ intervals: number[]; occurrences: number }>;
    rhythms: Array<{ slots: number[][]; occurrences: number }>;
    patches: Array<Record<string, unknown>>;
    vibrato: { rate_frames: number; depth_cents: number; onset_delay_frames: number; fraction: number } | null;
  }>;
}

export async function dumpSeed(client: FalkorHvscClient, fileMd5: string, subtuneIndex: number): Promise<SeedVocabulary> {
  const p = { f: fileMd5, s: subtuneIndex };

  const tuneRows = await client.rawQuery<{ ks: string | null; km: string | null; tempo: number | null; shape: string | null; chip: string | null }>(
    `MATCH (t:Tune {file_md5: $f, subtune_index: $s})
     RETURN t.key_signature AS ks, t.key_mode AS km, t.tempo_bpm AS tempo, t.repeat_shape AS shape, t.chip AS chip`, p);
  const t0 = tuneRows[0] ?? { ks: null, km: null, tempo: null, shape: null, chip: null };

  const sections = (await client.rawQuery<{ order: number; label: string; sf: number; ef: number; lf: number }>(
    `MATCH (:Tune {file_md5: $f, subtune_index: $s})-[:HAS_SECTION]->(sec:Section)
     RETURN sec.order AS order, sec.label AS label, sec.start_frame AS sf, sec.end_frame AS ef, sec.length_frames AS lf
     ORDER BY sec.order`, p)).map((r) => ({
       order: Number(r.order), label: r.label, start_frame: Number(r.sf), end_frame: Number(r.ef), length_frames: Number(r.lf),
     }));

  const vparts = await client.rawQuery<{ voice: number; chip: number; role: string; aph: number; pr: number }>(
    `MATCH (:Tune {file_md5: $f, subtune_index: $s})-[:HAS_VOICE]->(v:VoicePart)
     RETURN v.voice AS voice, v.sid_chip AS chip, v.role AS role, v.avg_pitch_hz AS aph, v.pitch_range AS pr
     ORDER BY v.sid_chip, v.voice`, p);

  const voices = [];
  for (const vp of vparts) {
    const voice = Number(vp.voice);
    const motifs = (await client.rawQuery<{ intervals: string; occ: number }>(
      `MATCH (:Tune {file_md5: $f, subtune_index: $s})-[u:USES_MOTIF {voice: $v}]->(m:Motif)
       RETURN m.intervals AS intervals, u.occurrences AS occ`, { ...p, v: voice }))
      .map((r) => ({ intervals: JSON.parse(r.intervals) as number[], occurrences: Number(r.occ ?? 1) }));
    const rhythms = (await client.rawQuery<{ slots: string; occ: number }>(
      `MATCH (:Tune {file_md5: $f, subtune_index: $s})-[u:USES_RHYTHM {voice: $v}]->(rc:RhythmCell)
       RETURN rc.slots AS slots, u.occurrences AS occ`, { ...p, v: voice }))
      .map((r) => ({ slots: JSON.parse(r.slots) as number[][], occurrences: Number(r.occ ?? 1) }));
    const patches = (await client.rawQuery<Record<string, unknown>>(
      `MATCH (:Tune {file_md5: $f, subtune_index: $s})-[u:USES_PATCH {voice: $v}]->(pa:Patch)
       RETURN pa.waveform AS waveform, pa.adsr AS adsr, pa.duration_frames AS duration_frames,
              pa.filter_routed AS filter_routed, pa.hard_restart AS hard_restart,
              pa.ring_mod AS ring_mod, pa.hard_sync AS hard_sync, u.occurrences AS occurrences`, { ...p, v: voice }))
      .map((r) => ({
        waveform: r.waveform, adsr: JSON.parse((r.adsr as string) ?? "[0,0,0,0]"),
        duration_frames: Number(r.duration_frames ?? 0), filter_routed: r.filter_routed ?? false,
        hard_restart: r.hard_restart ?? "", ring_mod: r.ring_mod ?? false, hard_sync: r.hard_sync ?? false,
        pulse_pattern: [], filter_pattern: [], occurrences: Number(r.occurrences ?? 1),
      }));
    const gestureRows = await client.rawQuery<{ rate: number; depth: number; onset: number; frac: number }>(
      `MATCH (:Tune {file_md5: $f, subtune_index: $s})-[:HAS_VOICE]->(v:VoicePart {voice: $v, sid_chip: $chip})-[u:USES_GESTURE]->(g:Gesture)
       RETURN g.rate_frames AS rate, g.depth_cents AS depth, u.onset_delay_frames AS onset, u.fraction AS frac
       LIMIT 1`,
      { ...p, v: voice, chip: Number(vp.chip) });
    const vibrato = gestureRows[0]
      ? { rate_frames: Number(gestureRows[0].rate), depth_cents: Number(gestureRows[0].depth),
          onset_delay_frames: Number(gestureRows[0].onset), fraction: Number(gestureRows[0].frac) }
      : null;
    voices.push({ voice, sid_chip: Number(vp.chip), role: vp.role, avg_pitch_hz: Number(vp.aph ?? 440), pitch_range: Number(vp.pr ?? 0), motifs, rhythms, patches, vibrato });
  }

  return {
    tune: { key_signature: t0.ks, key_mode: t0.km, tempo_bpm: t0.tempo === null ? null : Number(t0.tempo), repeat_shape: t0.shape, chip: t0.chip },
    sections, voices,
  };
}
