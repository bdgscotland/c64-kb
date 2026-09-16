import { FalkorHvscClient } from "../services/falkor-hvsc.js";
import { tonicPcFromKeyName } from "../hvsc/mine.js";
import { degreesToChordSymbols } from "./compose-run.js";

export interface ArrangeArgs { title?: string; fileMd5?: string; subtune?: number; key?: string; maxBars?: number; graphName?: string; }
export interface ArrangeResult { score: Record<string, any>; summary: { tune: string; sections: number; bars: number; voices: number; chords_used: string[]; fallbacks: string[] }; note: string; }

const _PC = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
function _tonicChord(keyPc: number, mode: string): string { return _PC[keyPc % 12] + (mode === "minor" ? "m" : ""); }
function _ci(s: string): number[] { return (s ?? "").split(",").filter((x) => x !== "").map((x) => parseInt(x, 10)); }
function _beats(s: string): number[] { return _ci(s).map((x) => x * 0.25); }
function _parseAdsr(s: string): number[] { try { const a = JSON.parse(s); return Array.isArray(a) && a.length === 4 ? a : [0,8,8,12]; } catch { return [0,8,8,12]; } }
function _chordRootPc(sym: string): number { const m = (sym ?? "").match(/^([A-G]#?)/); return m ? Math.max(0, _PC.indexOf(m[1])) : 0; }

export async function arrangeTune(args: ArrangeArgs): Promise<ArrangeResult> {
  const client = new FalkorHvscClient(args.graphName ? { graphName: args.graphName } : {});
  await client.connect();
  try {
    const subtune = args.subtune ?? 0;
    const maxBars = args.maxBars ?? 32;
    const [tuneCypher, tuneParams] = args.fileMd5
      ? [`MATCH (t:Tune {file_md5:$md5, subtune_index:$st}) OPTIONAL MATCH (t)-[:COMPOSED_BY]->(c:Composer)
         RETURN t.file_md5 AS md5, t.title AS title, c.name AS composer, t.key_signature AS key, t.key_mode AS mode, t.tempo_bpm AS tempo`,
         { md5: args.fileMd5, st: subtune }]
      : [`MATCH (t:Tune {title:$title, subtune_index:$st}) OPTIONAL MATCH (t)-[:COMPOSED_BY]->(c:Composer)
         RETURN t.file_md5 AS md5, t.title AS title, c.name AS composer, t.key_signature AS key, t.key_mode AS mode, t.tempo_bpm AS tempo LIMIT 1`,
         { title: args.title, st: subtune }];
    const tuneRows = await client.rawQuery<{ md5: string; title: string; composer: string; key: string; mode: string; tempo: number }>(
      tuneCypher, tuneParams);
    if (tuneRows.length === 0) throw new Error(`tune not found: ${args.title ?? args.fileMd5}`);
    const tune = tuneRows[0];
    const key = args.key ?? (tune.key && tune.key !== "" ? tune.key : "C");
    const mode = (tune.mode === "major" || tune.mode === "minor") ? tune.mode : "minor";
    const tempo = Number(tune.tempo) > 0 ? Number(tune.tempo) : 125;
    const beatsPerBar = 4;
    const framesPerBar = Math.max(1, Math.round(3000 / tempo)) * beatsPerBar;
    const keyPc = tonicPcFromKeyName(key) ?? 0;

    const secRows = await client.rawQuery<{ label: string; start: number; end: number }>(
      `MATCH (t:Tune {file_md5:$md5, subtune_index:$st})-[:HAS_SECTION]->(s:Section)
       RETURN s.label AS label, s.start_frame AS start, s.end_frame AS end ORDER BY s.start_frame ASC`,
      { md5: tune.md5, st: subtune });
    const progRows = await client.rawQuery<{ start: number; degrees: string }>(
      `MATCH (t:Tune {file_md5:$md5, subtune_index:$st})-[:HAS_SECTION]->(s:Section)-[:HAS_PROGRESSION]->(p:Progression)
       RETURN s.start_frame AS start, p.degrees AS degrees ORDER BY s.start_frame ASC`,
      { md5: tune.md5, st: subtune });
    const progByStart = new Map<number, string>();
    for (const r of progRows) if (!progByStart.has(Number(r.start))) progByStart.set(Number(r.start), r.degrees);

    const sections: Array<{ label: string; start_bar: number; bars: number; chords: string[] }> = [];
    let barCursor = 0, prevChords: string[] = [];
    for (const s of secRows) {
      const span = Number(s.end) - Number(s.start);
      let bars = Math.max(1, Math.round(span / framesPerBar));
      if (barCursor + bars > maxBars) bars = maxBars - barCursor;
      if (bars <= 0) break;
      const degrees = progByStart.get(Number(s.start));
      let chords = degrees ? degreesToChordSymbols(degrees, keyPc) : [];
      if (chords.length === 0) chords = prevChords.length ? prevChords : [_tonicChord(keyPc, mode)];
      prevChords = chords;
      const barChords = Array.from({ length: bars }, (_, i) => chords[i % chords.length]);
      sections.push({ label: s.label, start_bar: barCursor, bars, chords: barChords });
      barCursor += bars;
      if (barCursor >= maxBars) break;
    }

    // bar plan across the whole arrangement: each bar's start beat + chord root pc
    const barPlan: Array<{ startBeat: number; rootPc: number }> = [];
    { let beat = 0; for (const s of sections) for (let b = 0; b < s.bars; b++) {
        barPlan.push({ startBeat: beat, rootPc: _chordRootPc(s.chords[b]) }); beat += beatsPerBar; } }

    const vpRows = await client.rawQuery<{ voice: number; chip: number; role: string }>(
      `MATCH (t:Tune {file_md5:$md5, subtune_index:$st})-[:HAS_VOICE]->(v:VoicePart)
       RETURN v.voice AS voice, v.sid_chip AS chip, v.role AS role ORDER BY v.voice ASC`, { md5: tune.md5, st: subtune });
    const voices: any[] = []; const fallbacks: string[] = [];
    let leadEmitted = false;
    for (const vp of vpRows) {
      // Single primary lead: extra simultaneous leads stack into mud (verified by ear).
      if (vp.role === "lead" || vp.role === "dual") {
        if (leadEmitted) continue;
        leadEmitted = true;
      }
      const vparams = { md5: tune.md5, st: subtune, vo: Number(vp.voice), ch: Number(vp.chip) };
      const patchRows = await client.rawQuery<{ wf: string; adsr: string; hr: string; pw: number }>(
        `MATCH (v:VoicePart {file_md5:$md5, subtune_index:$st, voice:$vo, sid_chip:$ch})-[:PLAYS_PATCH]->(p:Patch)
         RETURN p.waveform AS wf, p.adsr AS adsr, p.hard_restart AS hr, p.pulse_width AS pw LIMIT 1`, vparams);
      const gestRows = await client.rawQuery<{ rate: number; depth: number }>(
        `MATCH (v:VoicePart {file_md5:$md5, subtune_index:$st, voice:$vo, sid_chip:$ch})-[:USES_GESTURE]->(g:Gesture)
         RETURN g.rate_frames AS rate, g.depth_cents AS depth ORDER BY g.rate_frames LIMIT 1`, vparams);
      const patch = patchRows.length
        ? { waveform: patchRows[0].wf || "pulse", adsr: _parseAdsr(patchRows[0].adsr), pulse_width: Number(patchRows[0].pw) || 2048, hard_restart: patchRows[0].hr || "" }
        : { waveform: "pulse", adsr: [0,8,8,12], pulse_width: 2048, hard_restart: "classic" };
      // A noise-waveform "lead" is a mis-mined/percussive patch — never voice a melody with it.
      if ((vp.role === "lead" || vp.role === "dual") && patch.waveform === "noise") patch.waveform = "pulse";
      const vibrato = gestRows.length ? { rate_frames: Number(gestRows[0].rate), depth_cents: Number(gestRows[0].depth), onset_delay_frames: 6 } : null;
      const voice: any = { voice: Number(vp.voice), sid_chip: Number(vp.chip), role: vp.role, patch, vibrato, notes: [], phrases: [], arps: [],
        harmonize: vp.role === "lead" || vp.role === "dual" };

      if (vp.role === "lead" || vp.role === "dual") {
        const phr = await client.rawQuery<{ intervals: string; iois: string; gates: string }>(
          `MATCH (v:VoicePart {file_md5:$md5, subtune_index:$st, voice:$vo, sid_chip:$ch})-[u:USES_PHRASE]->(p:Phrase)
           RETURN p.intervals AS intervals, p.iois AS iois, p.gates AS gates ORDER BY u.occurrences DESC, p.id ASC LIMIT 8`, vparams);
        if (phr.length === 0) fallbacks.push(`v${vp.voice}:lead`);
        for (let bi = 0; bi < barPlan.length; bi += 2) {
          if (phr.length === 0) break;
          const ph = phr[(bi / 2) % phr.length];
          const anchor = 72;
          voice.phrases.push({ intervals: _ci(ph.intervals), iois: _beats(ph.iois), gates: _beats(ph.gates),
            anchor_midi: anchor, transpose: ((barPlan[bi].rootPc - (anchor % 12)) % 12 + 12) % 12, at_beats: [barPlan[bi].startBeat] });
        }
      } else if (vp.role === "arp") {
        const arp = await client.rawQuery<{ ci: string; cy: string; rate: number }>(
          `MATCH (v:VoicePart {file_md5:$md5, subtune_index:$st, voice:$vo, sid_chip:$ch})-[u:USES_ARP]->(a:Arp)
           RETURN a.chord_intervals AS ci, a.cycle AS cy, a.rate_frames AS rate ORDER BY u.occurrences DESC, a.id ASC LIMIT 1`, vparams);
        if (arp.length === 0) fallbacks.push(`v${vp.voice}:arp`);
        for (const bp of barPlan) {
          if (arp.length === 0) break;
          voice.arps.push({ root_midi: 48, chord_intervals: _ci(arp[0].ci), cycle: _ci(arp[0].cy),
            rate_frames: Number(arp[0].rate), at_beats: [bp.startBeat], dur_beats: beatsPerBar, transpose: bp.rootPc });
        }
      } else if (vp.role === "bass") {
        // Sparse, clean bass: root half-notes on a mellow triangle. (Busy octave-jump
        // patterns on the mined filter-routed patch rendered static = the "weird buzzy
        // bass" that dominated; SID has no per-voice volume, so keep it simple + soft.)
        voice.patch = { waveform: "triangle", adsr: [0, 6, 8, 8], pulse_width: 2048, hard_restart: "" };
        for (const bp of barPlan) {
          voice.notes.push({ beat: bp.startBeat, dur_beats: 1.6, midi: 36 + bp.rootPc });
          voice.notes.push({ beat: bp.startBeat + 2, dur_beats: 1.6, midi: 36 + bp.rootPc });
        }
      } // percussion: omit (no drum primitive in v1)
      voices.push(voice);
    }

    const composer = tune.composer || "Rob Hubbard";
    const score: Record<string, any> = {
      meta: { title: `${tune.title} (arranged)`, key, mode, tempo_bpm: tempo, beats_per_bar: beatsPerBar,
              region: "PAL", target_composer: composer },
      sections, voices,
    };
    return { score, summary: { tune: tune.title, sections: sections.length, bars: barCursor, voices: voices.length,
      chords_used: [...new Set(sections.flatMap((s) => s.chords))], fallbacks },
      note: "Tune-seed scaffold: real form + per-section harmony from the mined tune. Refine voices then c64_compose." };
  } finally { await client.disconnect(); }
}
