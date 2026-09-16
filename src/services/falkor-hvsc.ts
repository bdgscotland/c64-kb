/**
 * FalkorHvscClient: dedicated client for the c64_hvsc graph.
 *
 * Parallel to src/services/falkor.ts but writes to a separate FalkorDB
 * graph (env: FALKOR_HVSC_GRAPH, default "c64_hvsc"). Keeps HVSC ontology
 * isolated from the existing c64 graph per eng-review decision C5.
 *
 * Tune key is COMPOSITE (file_md5, subtune_index) per Codex C2 — a SID
 * file can contain multiple subtunes with different structures/instruments/roles.
 * upsertTune uses MERGE on that composite key for idempotent re-ingest.
 */

import { FalkorDB } from "falkordb";
import { createHash } from "node:crypto";
import { config, FALKOR_HVSC_GRAPH } from "../config.js";

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Range indexes for every property the ingest + clustering passes MERGE/MATCH on
 * by value. Without these, each MERGE (Patch {patch_hash}), MERGE (Tune {file_md5}),
 * etc. is a label scan — invisible at the canon's scale but O(n²)-ish across a
 * 5k-tune ingest (and slow for every palette query after). Mirrors the main c64
 * graph's ensureSchema() index seeding. Idempotent: a duplicate index just throws,
 * which we swallow.
 */
const HVSC_NODE_INDEXES: ReadonlyArray<readonly [string, string]> = [
  ["Tune", "file_md5"],
  ["VoicePart", "file_md5"],   // tune-local; per-tune MATCHes were full label scans → O(n²) ingest at scale
  ["Section", "file_md5"],     // tune-local; same label-scan bottleneck (degraded ingest 114→22/min by 19k tunes)
  ["Composer", "name"],
  ["Person", "name"],
  ["Driver", "driver_hash"],
  ["Tracker", "id"],
  ["Patch", "patch_hash"],
  ["Motif", "motif_hash"],
  ["RhythmCell", "rhythm_hash"],
  ["Gesture", "gesture_hash"],
  ["Phrase", "id"],
  ["Arp", "id"],
  ["Progression", "id"],
  ["Hook", "hook_hash"],
  ["ArcShape", "arc"],
  ["Cadence", "degree"],
  ["PatchFamily", "id"],
  ["MotifFamily", "id"],
  ["HookFamily", "id"],
];

export interface TuneInput {
  file_md5: string;
  subtune_index: number;
  title: string;
  composer: string;
  year: number | null;
  chip: "6581" | "8580" | "either";
  region: "PAL" | "NTSC" | "both";
  length_sec: number | null;
  hvsc_path: string;
  stil_comment?: string;
  // STIL TITLE: field — the cover-source title (e.g. "Heart [from Actually]"),
  // distinct from the tune's own title.  Empty when STIL doesn't carry one.
  stil_title?: string;
  // STIL NAME: field — alternate / long name for the tune.  Empty when missing.
  stil_name?: string;
  // Layer 7 (Function) — derived from title + stil_title.  See title-parser.ts.
  function_role?: string;   // enum (see FunctionRole); "" when no match
  source_work?: string;     // free-text work name from "[from <X>]" in STIL title
  source_type?: string;     // qualifier classification: movie/tv_series/arcade_game/...
  level_number?: number | null;  // explicit level marker, null otherwise
  section_marker?: string;  // raw trailing "(...)" parenthetical from the tune title
  // NEW (M4.1):
  tracker_id?: string;         // canonical slug; "unknown" if not detected
  tracker_confidence?: number; // 0.0 - 1.0
  driver_hash?: string;
  driver_byte_signature?: string;
  driver_play_offset?: number;
  driver_init_offset?: number;
  sid_count?: number;          // 1 / 2 / 3
  is_rsid?: boolean;
  credits?: Array<{ name: string; role: string }>;
  // NEW (Phase 0c):
  key_signature?: string | null;
  key_mode?: "major" | "minor" | null;
  key_confidence?: number;
  tempo_bpm?: number | null;
  time_signature_numerator?: number | null;
  time_signature_denominator?: number | null;
  top_instruments?: Array<{ id: string; total_duration_sec: number; percentage: number }>;
  sid_native?: Record<string, unknown>;
}

export class FalkorHvscClient {
  private db: FalkorDB | null = null;
  /** Target graph name. Public so corpus-global passes (e.g. the python melody
   * extractor in clusterAll) target the SAME graph as this client, not the env default. */
  readonly graphName: string;

  constructor(opts: { graphName?: string } = {}) {
    this.graphName = opts.graphName ?? FALKOR_HVSC_GRAPH;
  }

  async connect(
    host: string = config.falkor.host,
    port: number = config.falkor.port
  ): Promise<void> {
    this.db = await FalkorDB.connect({ socket: { host, port } });
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  async dropGraph(): Promise<void> {
    if (!this.db) throw new Error("Not connected to FalkorDB");
    try {
      await this.db.selectGraph(this.graphName).delete();
    } catch {
      // Graph may not exist yet — that's fine.
    }
  }

  private graph() {
    if (!this.db) throw new Error("Not connected to FalkorDB");
    return this.db.selectGraph(this.graphName);
  }

  /**
   * Seed range indexes on every value-matched MERGE/MATCH key (HVSC_NODE_INDEXES).
   * Call once after connect() before ingest/clustering — indexes persist at the
   * graph level, so a single seed covers the whole pipeline (they are dropped only
   * by dropGraph(), so re-seed after a clean re-ingest). Idempotent.
   *
   * @returns the number of indexes newly created (0 if all already present).
   */
  async ensureIndexes(): Promise<number> {
    const g = this.graph();
    let created = 0;
    for (const [label, prop] of HVSC_NODE_INDEXES) {
      try {
        await g.createNodeRangeIndex(label, prop);
        created++;
      } catch {
        // Index already exists — FalkorDB throws on duplicate; that's fine.
      }
    }
    return created;
  }

  /**
   * Idempotent upsert of a Tune node plus all M4.1 ontology nodes/edges.
   * MERGE on (file_md5, subtune_index) — the composite primary key (C2).
   *
   * Each MERGE is its own g.query call (FalkorDB Cypher doesn't support
   * multi-statement transactions). All MERGEs are idempotent.
   */
  async upsertTune(t: TuneInput): Promise<void> {
    const g = this.graph();

    // 1. Core Tune node + Person:Composer node + COMPOSED_BY edge
    await g.query(
      `MERGE (tune:Tune {file_md5: $file_md5, subtune_index: $subtune_index})
       SET tune.title = $title,
           tune.year = $year,
           tune.chip = $chip,
           tune.region = $region,
           tune.length_sec = $length_sec,
           tune.hvsc_path = $hvsc_path,
           tune.stil_comment = $stil_comment,
           tune.tracker_id = $tracker_id,
           tune.sid_count = $sid_count,
           tune.is_rsid = $is_rsid,
           tune.key_signature = $key_signature,
           tune.key_mode = $key_mode,
           tune.key_confidence = $key_confidence,
           tune.tempo_bpm = $tempo_bpm,
           tune.time_signature_numerator = $time_signature_numerator,
           tune.time_signature_denominator = $time_signature_denominator,
           tune.top_instruments = $top_instruments,
           tune.sid_native = $sid_native,
           tune.stil_title = $stil_title,
           tune.stil_name = $stil_name,
           tune.function_role = $function_role,
           tune.source_work = $source_work,
           tune.source_type = $source_type,
           tune.level_number = $level_number,
           tune.section_marker = $section_marker
       MERGE (c:Person:Composer {name: $composer_key})
         ON CREATE SET c.display_name = $composer, c.is_composer = true
       MERGE (tune)-[:COMPOSED_BY]->(c)`,
      {
        params: {
          file_md5: t.file_md5,
          subtune_index: t.subtune_index,
          title: t.title,
          year: t.year,
          chip: t.chip,
          region: t.region,
          length_sec: t.length_sec,
          hvsc_path: t.hvsc_path,
          stil_comment: t.stil_comment ?? "",
          tracker_id: t.tracker_id ?? "unknown",
          sid_count: t.sid_count ?? 1,
          is_rsid: t.is_rsid ?? false,
          composer_key: normalizeName(t.composer),
          composer: t.composer,
          key_signature: t.key_signature ?? null,
          key_mode: t.key_mode ?? null,
          key_confidence: t.key_confidence ?? 0.0,
          tempo_bpm: t.tempo_bpm ?? null,
          time_signature_numerator: t.time_signature_numerator ?? null,
          time_signature_denominator: t.time_signature_denominator ?? null,
          top_instruments: JSON.stringify(t.top_instruments ?? []),
          sid_native: JSON.stringify(t.sid_native ?? {}),
          stil_title: t.stil_title ?? "",
          stil_name: t.stil_name ?? "",
          function_role: t.function_role ?? "",
          source_work: t.source_work ?? "",
          source_type: t.source_type ?? "",
          level_number: t.level_number ?? null,
          section_marker: t.section_marker ?? "",
        },
      } as Parameters<typeof g.query>[1]
    );

    // 2. Driver node + USES_DRIVER edge
    if (t.driver_hash) {
      await g.query(
        `MATCH (tune:Tune {file_md5: $file_md5, subtune_index: $subtune_index})
         MERGE (d:Driver {driver_hash: $driver_hash})
         SET d.byte_signature = $driver_byte_signature,
             d.play_offset = $driver_play_offset,
             d.init_offset = $driver_init_offset
         MERGE (tune)-[:USES_DRIVER]->(d)`,
        {
          params: {
            file_md5: t.file_md5,
            subtune_index: t.subtune_index,
            driver_hash: t.driver_hash,
            driver_byte_signature: t.driver_byte_signature ?? "",
            driver_play_offset: t.driver_play_offset ?? 0,
            driver_init_offset: t.driver_init_offset ?? 0,
          },
        } as Parameters<typeof g.query>[1]
      );
    }

    // 3. Tracker node + USES_TRACKER + EMITTED_BY (only when tracker known)
    if (t.tracker_id && t.tracker_id !== "unknown" && t.driver_hash) {
      await g.query(
        `MATCH (tune:Tune {file_md5: $file_md5, subtune_index: $subtune_index})
         MATCH (d:Driver {driver_hash: $driver_hash})
         MERGE (tr:Tracker {id: $tracker_id})
           ON CREATE SET tr.display_name = $tracker_id
         MERGE (tune)-[r1:USES_TRACKER]->(tr)
           SET r1.confidence = $tracker_confidence
         MERGE (d)-[r2:EMITTED_BY]->(tr)
           SET r2.confidence = $tracker_confidence`,
        {
          params: {
            file_md5: t.file_md5,
            subtune_index: t.subtune_index,
            driver_hash: t.driver_hash,
            tracker_id: t.tracker_id,
            tracker_confidence: t.tracker_confidence ?? 1.0,
          },
        } as Parameters<typeof g.query>[1]
      );
    }

    // 4. Credits: Person nodes + CREDITED_IN edges (one per credit role)
    for (const credit of t.credits ?? []) {
      if (!credit.name) continue;
      await g.query(
        `MATCH (tune:Tune {file_md5: $file_md5, subtune_index: $subtune_index})
         MERGE (p:Person {name: $person_key})
           ON CREATE SET p.display_name = $person_name,
                         p.is_arranger = ($role = 'arranger')
         SET p.is_arranger = (p.is_arranger OR $role = 'arranger')
         MERGE (p)-[r:CREDITED_IN {role: $role}]->(tune)`,
        {
          params: {
            file_md5: t.file_md5,
            subtune_index: t.subtune_index,
            person_key: normalizeName(credit.name),
            person_name: credit.name,
            role: credit.role,
          },
        } as Parameters<typeof g.query>[1]
      );
    }
  }

  /**
   * Upsert SSF-granular Patch nodes (MERGE on patch_hash for global cross-tune
   * dedup) plus Tune-USES_PATCH edges (one per occurrence/voice).
   */
  async upsertPatches(
    fileMd5: string,
    subtuneIndex: number,
    patches: Array<Record<string, unknown>>,
  ): Promise<void> {
    const g = this.graph();
    for (const p of patches) {
      // SET runs unconditionally on every MERGE (no ON CREATE guard): all callers
      // for a given patch_hash produce identical property values by construction
      // (the hash is derived from them), so re-ingest is idempotent — it just
      // re-writes the same values.
      await g.query(
        `MATCH (tune:Tune {file_md5: $file_md5, subtune_index: $subtune_index})
         MERGE (pa:Patch {patch_hash: $patch_hash})
         SET pa.waveform = $waveform,
             pa.adsr = $adsr,
             pa.filter_routed = $filter_routed,
             pa.hard_restart = $hard_restart,
             pa.ring_mod = $ring_mod,
             pa.hard_sync = $hard_sync,
             pa.duration_frames = $duration_frames
         MERGE (tune)-[r:USES_PATCH {voice: $voice, sid_chip: $sid_chip}]->(pa)
         SET r.occurrences = coalesce(r.occurrences, 0) + $occurrences`,
        {
          params: {
            file_md5: fileMd5,
            subtune_index: subtuneIndex,
            patch_hash: p.patch_hash,
            waveform: (p.waveform as string) ?? "saw",
            adsr: JSON.stringify(p.adsr ?? []),
            filter_routed: (p.filter_routed as boolean) ?? false,
            hard_restart: (p.hard_restart as string) ?? "",
            ring_mod: (p.ring_mod as boolean) ?? false,
            hard_sync: (p.hard_sync as boolean) ?? false,
            duration_frames: (p.duration_frames as number) ?? 0,
            voice: (p.voice as number) ?? 0,
            sid_chip: (p.sid_chip as number) ?? 1,
            occurrences: (p.occurrences as number) ?? 1,
          },
        } as Parameters<typeof g.query>[1],
      );
    }
  }

  /**
   * Persist song-form structure (layer 2) for one subtune.
   *
   * Writes the tune-level summary (repeat_shape, intro_frames) onto the Tune
   * node, then materialises the section sequence as Section nodes keyed by the
   * tune-local (file_md5, subtune_index, order) — sections are intrinsically
   * tune-local (frame offsets), unlike globally-deduped Patches.
   *
   * Edges: Tune-HAS_SECTION->Section, Section-NEXT->Section (the play order).
   *
   * Re-ingest uses delete-then-create: a tune's existing sections are dropped
   * first so a changed section count never leaves stale higher-order nodes
   * behind. Deleting tune-local Section nodes is safe (nothing else points at
   * them), which is why this differs from the MERGE-only Patch path.
   */
  async upsertSections(
    fileMd5: string,
    subtuneIndex: number,
    structure: {
      sections?: Array<{
        label: string;
        start_frame: number;
        end_frame: number;
        repeat_of?: string | null;
      }>;
      repeat_shape?: string | null;
      intro_frames?: number;
    },
  ): Promise<void> {
    const g = this.graph();
    const sections = structure.sections ?? [];

    // 1. Tune-level structure summary.
    await g.query(
      `MATCH (t:Tune {file_md5: $file_md5, subtune_index: $subtune_index})
       SET t.repeat_shape = $repeat_shape, t.intro_frames = $intro_frames`,
      {
        params: {
          file_md5: fileMd5,
          subtune_index: subtuneIndex,
          repeat_shape: structure.repeat_shape ?? null,
          intro_frames: structure.intro_frames ?? 0,
        },
      } as Parameters<typeof g.query>[1],
    );

    // 2. Drop any existing sections for this tune (delete-then-create).
    await g.query(
      `MATCH (:Tune {file_md5: $file_md5, subtune_index: $subtune_index})-[:HAS_SECTION]->(s:Section)
       DETACH DELETE s`,
      {
        params: { file_md5: fileMd5, subtune_index: subtuneIndex },
      } as Parameters<typeof g.query>[1],
    );

    // 3. Create Section nodes + HAS_SECTION edges (one per section, in order).
    for (let order = 0; order < sections.length; order++) {
      const sec = sections[order];
      await g.query(
        `MATCH (t:Tune {file_md5: $file_md5, subtune_index: $subtune_index})
         CREATE (s:Section {
           file_md5: $file_md5, subtune_index: $subtune_index, order: $order,
           label: $label, start_frame: $start_frame, end_frame: $end_frame,
           repeat_of: $repeat_of, length_frames: $length_frames
         })
         MERGE (t)-[:HAS_SECTION]->(s)`,
        {
          params: {
            file_md5: fileMd5,
            subtune_index: subtuneIndex,
            order,
            label: sec.label,
            start_frame: sec.start_frame,
            end_frame: sec.end_frame,
            repeat_of: sec.repeat_of ?? null,
            length_frames: sec.end_frame - sec.start_frame,
          },
        } as Parameters<typeof g.query>[1],
      );
    }

    // 4. Chain NEXT edges in play order (order i -> i+1).
    if (sections.length > 1) {
      await g.query(
        `MATCH (a:Section {file_md5: $file_md5, subtune_index: $subtune_index}),
               (b:Section {file_md5: $file_md5, subtune_index: $subtune_index})
         WHERE b.order = a.order + 1
         MERGE (a)-[:NEXT]->(b)`,
        {
          params: { file_md5: fileMd5, subtune_index: subtuneIndex },
        } as Parameters<typeof g.query>[1],
      );
    }
  }

  /**
   * Upsert Motif nodes (layer 4) — pitch-interval n-grams mined per voice.
   * Motifs dedup globally by motif_hash (derived from the interval sequence;
   * transposition-invariant since intervals, not absolute pitches). Each
   * Tune-USES_MOTIF edge carries the voice + occurrence count within that
   * subtune. Mirrors upsertPatches; re-ingest is idempotent (SET, not +=).
   */
  async upsertMotifs(
    fileMd5: string,
    subtuneIndex: number,
    motifs: Array<{ intervals: number[]; voice: number; occurrences: number }>,
  ): Promise<void> {
    const g = this.graph();
    for (const m of motifs) {
      const intervalsStr = m.intervals.join(",");
      const motifHash = createHash("sha256").update(intervalsStr).digest("hex").slice(0, 16);
      await g.query(
        `MATCH (tune:Tune {file_md5: $file_md5, subtune_index: $subtune_index})
         MERGE (mo:Motif {motif_hash: $motif_hash})
         SET mo.intervals = $intervals, mo.n_notes = $n_notes
         MERGE (tune)-[r:USES_MOTIF {voice: $voice}]->(mo)
         SET r.occurrences = $occurrences`,
        {
          params: {
            file_md5: fileMd5,
            subtune_index: subtuneIndex,
            motif_hash: motifHash,
            intervals: JSON.stringify(m.intervals),
            n_notes: m.intervals.length + 1,
            voice: m.voice,
            occurrences: m.occurrences,
          },
        } as Parameters<typeof g.query>[1],
      );
    }
  }

  /**
   * Upsert RhythmCell nodes (layer 4r) — per-voice quantized note-timing
   * n-grams. Cells dedup globally by rhythm_hash (sha256 of the [ioi,gate] slot
   * sequence). Each Tune-USES_RHYTHM edge carries voice + occurrence count.
   * Mirrors upsertMotifs; re-ingest is idempotent (SET, not +=).
   */
  async upsertRhythm(
    fileMd5: string,
    subtuneIndex: number,
    cells: Array<{ slots: number[][]; voice: number; occurrences: number }>,
  ): Promise<void> {
    const g = this.graph();
    for (const c of cells) {
      const slotsStr = JSON.stringify(c.slots);
      const rhythmHash = createHash("sha256").update(slotsStr).digest("hex").slice(0, 16);
      await g.query(
        `MATCH (tune:Tune {file_md5: $file_md5, subtune_index: $subtune_index})
         MERGE (rc:RhythmCell {rhythm_hash: $rhythm_hash})
         SET rc.slots = $slots, rc.n_notes = $n_notes
         MERGE (tune)-[r:USES_RHYTHM {voice: $voice}]->(rc)
         SET r.occurrences = $occurrences`,
        {
          params: {
            file_md5: fileMd5,
            subtune_index: subtuneIndex,
            rhythm_hash: rhythmHash,
            slots: slotsStr,
            n_notes: c.slots.length,
            voice: c.voice,
            occurrences: c.occurrences,
          },
        } as Parameters<typeof g.query>[1],
      );
    }
  }

  /**
   * Persist voice roles (layer 3) for one subtune. VoicePart is tune-local
   * (keyed file_md5, subtune_index, voice, sid_chip) — like Section, re-ingest
   * is delete-then-create. Edges: Tune-HAS_VOICE->VoicePart;
   * VoicePart-PLAYS->Motif linked by matching USES_MOTIF.voice (single-SID
   * tunes link cleanly; multi-SID may over-link since USES_MOTIF carries no
   * sid_chip — acceptable for v1); VoicePart-PLAYS_PATCH->Patch linked by
   * matching USES_PATCH.voice + sid_chip (per-voice timbre — exact, since
   * USES_PATCH carries sid_chip); and VoicePart-PLAYS_RHYTHM->RhythmCell
   * linked by matching USES_RHYTHM.voice (voice-only, like PLAYS→Motif).
   * Must run AFTER upsertPatches and upsertRhythm.
   */
  async upsertVoiceParts(
    fileMd5: string,
    subtuneIndex: number,
    parts: Array<{
      voice: number;
      sid_chip: number;
      role: string;
      avgPitchHz: number;
      pitchRange: number;
      noteCount: number;
      noisePercent: number;
      avgGateLengthFrames: number;
      rhythmRegularity: number;
      multiplex?: boolean;
      roleSet?: string[];
      gapFillRate?: number;
    }>,
  ): Promise<void> {
    const g = this.graph();

    await g.query(
      `MATCH (:Tune {file_md5: $file_md5, subtune_index: $subtune_index})-[:HAS_VOICE]->(v:VoicePart)
       DETACH DELETE v`,
      { params: { file_md5: fileMd5, subtune_index: subtuneIndex } } as Parameters<typeof g.query>[1],
    );

    for (const p of parts) {
      await g.query(
        `MATCH (t:Tune {file_md5: $file_md5, subtune_index: $subtune_index})
         CREATE (v:VoicePart {
           file_md5: $file_md5, subtune_index: $subtune_index, voice: $voice, sid_chip: $sid_chip,
           role: $role, avg_pitch_hz: $avg_pitch_hz, pitch_range: $pitch_range, note_count: $note_count,
           noise_percent: $noise_percent, avg_gate_length_frames: $avg_gate_length_frames,
           rhythm_regularity: $rhythm_regularity,
           multiplex: $multiplex, role_set: $role_set, gap_fill_rate: $gap_fill_rate
         })
         MERGE (t)-[:HAS_VOICE]->(v)`,
        {
          params: {
            file_md5: fileMd5,
            subtune_index: subtuneIndex,
            voice: p.voice,
            sid_chip: p.sid_chip,
            role: p.role,
            avg_pitch_hz: p.avgPitchHz,
            pitch_range: p.pitchRange,
            note_count: p.noteCount,
            noise_percent: p.noisePercent,
            avg_gate_length_frames: p.avgGateLengthFrames,
            rhythm_regularity: p.rhythmRegularity,
            multiplex: p.multiplex ?? false,
            role_set: (p.roleSet ?? []).join(","),
            gap_fill_rate: p.gapFillRate ?? 0,
          },
        } as Parameters<typeof g.query>[1],
      );

      // Link VoicePart-PLAYS->Motif by the USES_MOTIF voice.
      await g.query(
        `MATCH (t:Tune {file_md5: $file_md5, subtune_index: $subtune_index})-[u:USES_MOTIF]->(m:Motif)
         WHERE u.voice = $voice
         MATCH (v:VoicePart {file_md5: $file_md5, subtune_index: $subtune_index, voice: $voice, sid_chip: $sid_chip})
         MERGE (v)-[:PLAYS]->(m)`,
        {
          params: { file_md5: fileMd5, subtune_index: subtuneIndex, voice: p.voice, sid_chip: p.sid_chip },
        } as Parameters<typeof g.query>[1],
      );

      // Link VoicePart-PLAYS_PATCH->Patch by matching the Tune-USES_PATCH
      // provenance (voice + sid_chip). Distinct edge type from the tune-level
      // USES_PATCH (mirrors the PLAYS / USES_MOTIF split), so tune-set queries
      // and per-voice timbre queries never cross-contaminate. USES_PATCH carries
      // sid_chip (unlike USES_MOTIF), so we can match both voice AND chip cleanly.
      await g.query(
        `MATCH (t:Tune {file_md5: $file_md5, subtune_index: $subtune_index})-[u:USES_PATCH]->(pa:Patch)
         WHERE u.voice = $voice AND u.sid_chip = $sid_chip
         MATCH (v:VoicePart {file_md5: $file_md5, subtune_index: $subtune_index, voice: $voice, sid_chip: $sid_chip})
         MERGE (v)-[:PLAYS_PATCH]->(pa)`,
        {
          params: { file_md5: fileMd5, subtune_index: subtuneIndex, voice: p.voice, sid_chip: p.sid_chip },
        } as Parameters<typeof g.query>[1],
      );

      // Link VoicePart-PLAYS_RHYTHM->RhythmCell by the USES_RHYTHM voice
      // (voice-only, like PLAYS->Motif).
      await g.query(
        `MATCH (t:Tune {file_md5: $file_md5, subtune_index: $subtune_index})-[u:USES_RHYTHM]->(rc:RhythmCell)
         WHERE u.voice = $voice
         MATCH (v:VoicePart {file_md5: $file_md5, subtune_index: $subtune_index, voice: $voice, sid_chip: $sid_chip})
         MERGE (v)-[:PLAYS_RHYTHM]->(rc)`,
        {
          params: { file_md5: fileMd5, subtune_index: subtuneIndex, voice: p.voice, sid_chip: p.sid_chip },
        } as Parameters<typeof g.query>[1],
      );
    }
  }

  /** SET multiplex fields on an existing VoicePart (re-cluster pass; no re-ingest). */
  async setVoicePartMultiplex(
    fileMd5: string, subtuneIndex: number, voice: number, sidChip: number,
    m: { multiplex: boolean; role_set: string[]; gap_fill_rate: number },
  ): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (v:VoicePart {file_md5: $file_md5, subtune_index: $subtune_index, voice: $voice, sid_chip: $sid_chip})
       SET v.multiplex = $multiplex, v.role_set = $role_set, v.gap_fill_rate = $gap_fill_rate`,
      { params: {
          file_md5: fileMd5, subtune_index: subtuneIndex, voice, sid_chip: sidChip,
          multiplex: m.multiplex, role_set: m.role_set.join(","), gap_fill_rate: m.gap_fill_rate,
        } } as Parameters<typeof g.query>[1],
    );
  }

  /**
   * Persist vibrato Gestures (layer 6) for one subtune's voices. A Gesture is
   * globally deduped by gesture_hash = sha256("vibrato|<rate>|<depth->10c>") —
   * coarse quantization (rate to the frame, depth to the nearest 10 cents) is
   * the dedup, so there is NO GestureFamily layer (unlike Motif/Patch).
   * USES_GESTURE is a VoicePart edge, so this MUST run AFTER upsertVoiceParts
   * (which DETACH DELETEs and recreates the tune's VoiceParts).
   */
  async upsertGestures(
    fileMd5: string,
    subtuneIndex: number,
    gestures: Array<{
      voice: number; sid_chip: number;
      rate_frames: number; depth_cents: number;
      onset_delay_frames: number; fraction: number;
    }>,
  ): Promise<void> {
    const g = this.graph();
    for (const ge of gestures) {
      const qDepth = Math.round(ge.depth_cents / 10) * 10;
      const key = `vibrato|${ge.rate_frames}|${qDepth}`;
      const gestureHash = createHash("sha256").update(key).digest("hex").slice(0, 16);
      await g.query(
        `MATCH (v:VoicePart {file_md5: $file_md5, subtune_index: $subtune_index, voice: $voice, sid_chip: $sid_chip})
         MERGE (ge:Gesture {gesture_hash: $gesture_hash})
         SET ge.kind = 'vibrato', ge.rate_frames = $rate_frames, ge.depth_cents = $depth_cents
         MERGE (v)-[r:USES_GESTURE]->(ge)
         SET r.onset_delay_frames = $onset_delay_frames, r.fraction = $fraction`,
        {
          params: {
            file_md5: fileMd5,
            subtune_index: subtuneIndex,
            voice: ge.voice,
            sid_chip: ge.sid_chip,
            gesture_hash: gestureHash,
            rate_frames: ge.rate_frames,
            depth_cents: qDepth,
            onset_delay_frames: ge.onset_delay_frames,
            fraction: ge.fraction,
          },
        } as Parameters<typeof g.query>[1],
      );
    }
  }

  /**
   * Persist per-voice timbre Gestures (PWM and filter trajectories) as Gesture
   * nodes with kind ∈ {pwm, filter}. Gesture nodes are GLOBALLY deduped by
   * gesture_hash (computed by T1 from the 16-point normalized curve + kind +
   * archetype). VoicePart-[:USES_TIMBRE_GESTURE]->Gesture links them.
   *
   * Distinct from vibrato gestures (upsertGestures / USES_GESTURE): the hash
   * namespaces never collide because T1 prefixes the key differently.
   * MUST run AFTER upsertVoiceParts.
   */
  async upsertTimbreGestures(
    fileMd5: string,
    subtuneIndex: number,
    gestures: Array<{
      voice: number; sid_chip: number;
      kind: "pwm" | "filter";
      archetype: string; depth_band: string; rate_band: string;
      resonance_band?: string; mode?: string;
      gesture_hash: string;
      template: number[];
      count: number; fraction: number;
    }>,
  ): Promise<void> {
    const g = this.graph();
    for (const ge of gestures) {
      await g.query(
        `MATCH (v:VoicePart {file_md5: $file_md5, subtune_index: $subtune_index, voice: $voice, sid_chip: $sid_chip})
         MERGE (ge:Gesture {gesture_hash: $gesture_hash})
         SET ge.kind = $kind, ge.archetype = $archetype, ge.depth_band = $depth_band,
             ge.rate_band = $rate_band, ge.resonance_band = $resonance_band,
             ge.mode = $mode, ge.template = $template
         MERGE (v)-[r:USES_TIMBRE_GESTURE]->(ge)
         SET r.count = $count, r.fraction = $fraction`,
        {
          params: {
            file_md5: fileMd5,
            subtune_index: subtuneIndex,
            voice: ge.voice,
            sid_chip: ge.sid_chip,
            gesture_hash: ge.gesture_hash,
            kind: ge.kind,
            archetype: ge.archetype,
            depth_band: ge.depth_band,
            rate_band: ge.rate_band,
            resonance_band: ge.resonance_band ?? null,
            mode: ge.mode ?? null,
            template: ge.template.join(","),
            count: ge.count,
            fraction: ge.fraction,
          },
        } as Parameters<typeof g.query>[1],
      );
    }
  }

  /**
   * Persist fused pitch+rhythm phrases (SP-phrase). Phrase nodes are GLOBAL +
   * deduped by id = sha256(key); VoicePart-USES_PHRASE {occurrences}->Phrase
   * links them. MUST run AFTER upsertVoiceParts.
   */
  async upsertPhrases(
    fileMd5: string,
    subtuneIndex: number,
    phrases: Array<{
      key: string; intervals: number[]; iois: number[]; gates: number[];
      voice: number; sid_chip: number; occurrences: number;
    }>,
  ): Promise<void> {
    const g = this.graph();
    for (const ph of phrases) {
      const id = createHash("sha256").update(ph.key).digest("hex").slice(0, 16);
      await g.query(
        `MATCH (v:VoicePart {file_md5: $file_md5, subtune_index: $subtune_index, voice: $voice, sid_chip: $sid_chip})
         MERGE (p:Phrase {id: $id})
         SET p.key = $key, p.n_notes = $n_notes, p.intervals = $intervals, p.iois = $iois, p.gates = $gates
         MERGE (v)-[r:USES_PHRASE]->(p) SET r.occurrences = $occurrences`,
        {
          params: {
            file_md5: fileMd5,
            subtune_index: subtuneIndex,
            voice: ph.voice,
            sid_chip: ph.sid_chip,
            id,
            key: ph.key,
            n_notes: ph.gates.length,
            intervals: ph.intervals.join(","),
            iois: ph.iois.join(","),
            gates: ph.gates.join(","),
            occurrences: ph.occurrences,
          },
        } as Parameters<typeof g.query>[1],
      );
    }
  }

  async upsertArps(fileMd5: string, subtuneIndex: number,
    arps: Array<{ key: string; chord_intervals: number[]; cycle: number[]; n_steps: number; rate_frames: number; voice: number; sid_chip: number; occurrences: number }>): Promise<void> {
    const g = this.graph();
    for (const ar of arps) {
      const id = createHash("sha256").update(ar.key).digest("hex").slice(0, 16);
      await g.query(
        `MATCH (v:VoicePart {file_md5: $file_md5, subtune_index: $subtune_index, voice: $voice, sid_chip: $sid_chip})
         MERGE (a:Arp {id: $id})
         SET a.key = $key, a.chord_intervals = $chord_intervals, a.cycle = $cycle, a.n_steps = $n_steps, a.rate_frames = $rate_frames
         MERGE (v)-[r:USES_ARP]->(a) SET r.occurrences = $occurrences`,
        {
          params: {
            file_md5: fileMd5,
            subtune_index: subtuneIndex,
            voice: ar.voice,
            sid_chip: ar.sid_chip,
            id,
            key: ar.key,
            chord_intervals: ar.chord_intervals.join(","),
            cycle: ar.cycle.join(","),
            n_steps: ar.n_steps,
            rate_frames: ar.rate_frames,
            occurrences: ar.occurrences,
          },
        } as Parameters<typeof g.query>[1],
      );
    }
  }

  /**
   * Persist per-section chord progressions (SP-harmony). Progression nodes are
   * GLOBAL + deduped by id = sha256(degrees); Section-HAS_PROGRESSION links the
   * tune-local Section (matched by order) to it. MUST run AFTER upsertSections
   * (which DETACH DELETEs the tune's Sections, dropping stale HAS_PROGRESSION).
   */
  async upsertProgressions(
    fileMd5: string,
    subtuneIndex: number,
    perSection: Array<{ order: number; degrees: string; length: number }>,
  ): Promise<void> {
    const g = this.graph();
    for (const sp of perSection) {
      const id = createHash("sha256").update(sp.degrees).digest("hex").slice(0, 16);
      await g.query(
        `MATCH (s:Section {file_md5: $file_md5, subtune_index: $subtune_index, order: $order})
         MERGE (p:Progression {id: $id})
         SET p.degrees = $degrees, p.length = $length
         MERGE (s)-[:HAS_PROGRESSION]->(p)`,
        {
          params: {
            file_md5: fileMd5, subtune_index: subtuneIndex, order: sp.order,
            id, degrees: sp.degrees, length: sp.length,
          },
        } as Parameters<typeof g.query>[1],
      );
    }
  }

  /**
   * Persist a tune's lead-voice grammar (SP-grammar, layer 4) as scalar props on
   * the Tune node. Unlike motifs/phrases, grammar is composer-level *statistics*
   * (hook + development-op distribution + phrasing profile), so it aggregates at
   * query time over Tune props (mirrors timbre/multiplex) — no new node type, no
   * clustering pass. Idempotent: SET overwrites. hook_intervals is "" when the
   * lead voice has no recurring hook.
   */
  async setTuneGrammar(
    fileMd5: string,
    subtuneIndex: number,
    grammar: {
      hook_intervals: string; hook_strength: number; hook_length: number; hook_occurrences: number;
      contour: string; leap_ratio: number; step_ratio: number; repetition_rate: number;
      mean_abs_interval: number; note_count: number;
      dev_repeat: number; dev_sequence: number; dev_invert: number; dev_augment: number; dev_vary: number;
    },
  ): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (t:Tune {file_md5: $file_md5, subtune_index: $subtune_index})
       SET t.grammar_hook_intervals = $hook_intervals,
           t.grammar_hook_strength = $hook_strength,
           t.grammar_hook_length = $hook_length,
           t.grammar_hook_occurrences = $hook_occurrences,
           t.grammar_contour = $contour,
           t.grammar_leap_ratio = $leap_ratio,
           t.grammar_step_ratio = $step_ratio,
           t.grammar_repetition_rate = $repetition_rate,
           t.grammar_mean_abs_interval = $mean_abs_interval,
           t.grammar_note_count = $note_count,
           t.grammar_dev_repeat = $dev_repeat,
           t.grammar_dev_sequence = $dev_sequence,
           t.grammar_dev_invert = $dev_invert,
           t.grammar_dev_augment = $dev_augment,
           t.grammar_dev_vary = $dev_vary`,
      { params: { file_md5: fileMd5, subtune_index: subtuneIndex, ...grammar } } as Parameters<typeof g.query>[1],
    );
  }

  /**
   * Upsert the tune's signature Hook (SP-grammar, layer 4) as a first-class graph
   * node — mirrors upsertMotifs so grammar is a real ontology citizen (clusterable
   * into HookFamily, FAVORS_HOOK-aggregatable, usable in graph-overlap similarity),
   * not just Tune props. One Hook per tune (the dominant recurring melodic figure).
   * Hook nodes dedup globally by hook_hash (sha256 of the interval sequence).
   */
  async upsertHook(
    fileMd5: string,
    subtuneIndex: number,
    hook: { intervals: number[]; strength: number; occurrences: number; n_notes: number },
  ): Promise<void> {
    const g = this.graph();
    const intervalsStr = hook.intervals.join(",");
    const hookHash = createHash("sha256").update(intervalsStr).digest("hex").slice(0, 16);
    await g.query(
      `MATCH (tune:Tune {file_md5: $file_md5, subtune_index: $subtune_index})
       MERGE (h:Hook {hook_hash: $hook_hash})
       SET h.intervals = $intervals, h.n_notes = $n_notes
       MERGE (tune)-[r:USES_HOOK]->(h)
       SET r.strength = $strength, r.occurrences = $occurrences`,
      {
        params: {
          file_md5: fileMd5,
          subtune_index: subtuneIndex,
          hook_hash: hookHash,
          intervals: JSON.stringify(hook.intervals),
          n_notes: hook.n_notes,
          strength: hook.strength,
          occurrences: hook.occurrences,
        },
      } as Parameters<typeof g.query>[1],
    );
  }

  /**
   * Persist a tune's form-as-dynamics (SP-form, layer 5): per-Section energy props +
   * a first-class `ArcShape` node (the arc archetype) linked Tune-HAS_ARC. `ArcShape`
   * is both the entity and its own "family" (the archetype is the cluster), so unlike
   * Hook there's no intermediate family node. Composer-FAVORS_ARC is built by
   * clusterFormInGraph. Sections matched by tune-local `order` (must run after upsertSections).
   */
  async upsertForm(
    fileMd5: string,
    subtuneIndex: number,
    form: {
      arc: string; peak_section: number; energy_range: number;
      sections: Array<{ order: number; energy: number; density: number; register: number; voice_activity: number }>;
    },
  ): Promise<void> {
    const g = this.graph();
    for (const s of form.sections) {
      await g.query(
        `MATCH (sec:Section {file_md5: $file_md5, subtune_index: $subtune_index, order: $order})
         SET sec.energy = $energy, sec.density = $density, sec.register = $register, sec.voice_activity = $voice_activity`,
        { params: { file_md5: fileMd5, subtune_index: subtuneIndex, order: s.order,
          energy: s.energy, density: s.density, register: s.register, voice_activity: s.voice_activity } } as Parameters<typeof g.query>[1],
      );
    }
    await g.query(
      `MATCH (t:Tune {file_md5: $file_md5, subtune_index: $subtune_index})
       MERGE (a:ArcShape {arc: $arc})
       MERGE (t)-[r:HAS_ARC]->(a)
       SET r.peak_section = $peak_section, r.energy_range = $energy_range`,
      { params: { file_md5: fileMd5, subtune_index: subtuneIndex, arc: form.arc,
        peak_section: form.peak_section, energy_range: form.energy_range } } as Parameters<typeof g.query>[1],
    );
  }

  /**
   * Persist a tune's melodic direction (SP-direction, layer 4b): direction stats as Tune
   * props + first-class `Cadence` nodes (key-relative landing degree) linked Tune-ENDS_PHRASE_ON
   * (count). Composer-FAVORS_CADENCE is built by clusterDirectionInGraph. Cadence dedups
   * globally by `degree` (closed is a derived prop). Mirrors upsertForm.
   */
  async upsertDirection(
    fileMd5: string,
    subtuneIndex: number,
    dir: {
      resolution_rate: number; qa_rate: number; mean_phrase_len: number; n_phrases: number;
      cadences: Array<{ degree: number; closed: boolean }>;
    },
  ): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (t:Tune {file_md5: $file_md5, subtune_index: $subtune_index})
       SET t.direction_resolution_rate = $resolution_rate, t.direction_qa_rate = $qa_rate,
           t.direction_mean_phrase_len = $mean_phrase_len, t.direction_n_phrases = $n_phrases`,
      { params: { file_md5: fileMd5, subtune_index: subtuneIndex, resolution_rate: dir.resolution_rate,
        qa_rate: dir.qa_rate, mean_phrase_len: dir.mean_phrase_len, n_phrases: dir.n_phrases } } as Parameters<typeof g.query>[1],
    );
    // distinct cadence -> count
    const counts = new Map<number, { closed: boolean; count: number }>();
    for (const c of dir.cadences) {
      const e = counts.get(c.degree) ?? { closed: c.closed, count: 0 };
      e.count++; counts.set(c.degree, e);
    }
    for (const [degree, { closed, count }] of counts) {
      await g.query(
        `MATCH (t:Tune {file_md5: $file_md5, subtune_index: $subtune_index})
         MERGE (cad:Cadence {degree: $degree})
         SET cad.closed = $closed
         MERGE (t)-[r:ENDS_PHRASE_ON]->(cad)
         SET r.count = $count`,
        { params: { file_md5: fileMd5, subtune_index: subtuneIndex, degree, closed, count } } as Parameters<typeof g.query>[1],
      );
    }
  }

  /**
   * Create COVERS edges between a source Tune (file_md5, subtune_index) and a
   * set of target Tunes identified by their canonical HVSC path.  The target
   * Tune may have multiple subtunes; we link the source to every subtune of the
   * target (covers the common case where STIL points at the .sid file as a whole
   * without a subtune disambiguator).
   *
   * If the target path doesn't exist in the graph yet, the MATCH simply yields
   * zero rows and no edge is created — this is intentional so the live ingest
   * path can call this method best-effort; the backfill script resolves what's
   * missing once the full corpus is loaded.
   *
   * Edge shape: (source:Tune)-[:COVERS {kind}]->(target:Tune)
   *   where kind ∈ REMIX / EDIT / COVER / VERSION / CONVERSION / HACK /
   *               ARRANGEMENT / BASED_ON / SAME_AS.
   * SAME_AS is included (the most common kind) but is semantically a peer
   * relationship; consumers may want to treat it differently from the others.
   *
   * Returns the count of edges actually created (resolved target paths × subtunes).
   */
  async upsertCoverRelations(
    fileMd5: string,
    subtuneIndex: number,
    relations: Array<{ kind: string; target_path: string }>,
  ): Promise<number> {
    if (relations.length === 0) return 0;
    const g = this.graph();
    let edges = 0;
    for (const rel of relations) {
      const result = await g.query(
        `MATCH (src:Tune {file_md5: $file_md5, subtune_index: $subtune_index})
         MATCH (dst:Tune {hvsc_path: $target_path})
         WHERE src <> dst
         MERGE (src)-[r:COVERS {kind: $kind}]->(dst)
         RETURN count(r) AS n`,
        {
          params: {
            file_md5: fileMd5,
            subtune_index: subtuneIndex,
            target_path: rel.target_path,
            kind: rel.kind,
          },
        } as Parameters<typeof g.query>[1],
      );
      const n = Number((result.data?.[0] as { n?: number } | undefined)?.n ?? 0);
      edges += n;
    }
    return edges;
  }

  async tuneCount(): Promise<number> {
    const g = this.graph();
    const result = await g.roQuery("MATCH (t:Tune) RETURN count(t) as n");
    return Number((result.data?.[0] as { n?: number } | undefined)?.n ?? 0);
  }

  /**
   * Run an arbitrary read-only Cypher query and return the data rows.
   * Use this for all HVSC MCP tool queries — roQuery is safe for reads
   * and doesn't require a write transaction.
   *
   * Returns [] if the graph doesn't exist yet (FalkorDB throws
   * "Invalid graph operation on empty key" before any nodes are written).
   */
  async rawQuery<T = Record<string, unknown>>(
    cypher: string,
    params: Record<string, unknown> = {}
  ): Promise<T[]> {
    const g = this.graph();
    try {
      const result = await g.roQuery(cypher, { params } as Parameters<typeof g.roQuery>[1]);
      return (result.data ?? []) as T[];
    } catch (err: unknown) {
      // FalkorDB raises this when the graph key hasn't been created yet
      // (i.e. no upsertTune has ever been called on this graph name).
      // Treat it as an empty result so tools return valid shapes before ingest.
      if (
        err instanceof Error &&
        err.message.includes("Invalid graph operation on empty key")
      ) {
        return [];
      }
      throw err;
    }
  }

  /** Run a read-WRITE Cypher statement. Mirrors rawQuery but uses g.query. */
  async rawWrite(cypher: string, params: Record<string, unknown> = {}): Promise<void> {
    const g = this.graph();
    try {
      await g.query(cypher, { params } as Parameters<typeof g.query>[1]);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("Invalid graph operation on empty key")) {
        return;
      }
      throw err;
    }
  }
}
