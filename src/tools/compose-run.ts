/** Compose-loop orchestrator: render + inspect (Python) then style-grade (TS),
 * merged into one report. Mirrors cli-generate.ts for the python spawn. */
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { styleProximity, type StyleVoice } from "./style.js";
import { FalkorHvscClient, normalizeName } from "../services/falkor-hvsc.js";
import { tonicPcFromKeyName } from "../hvsc/mine.js";
import { degreesToRoman } from "./palette-mcp.js";

export async function composeScore(
  score: Record<string, any>,
  opts: { graphName?: string } = {},
): Promise<{ report: Record<string, any>; sidPath: string }> {
  const stem = join(tmpdir(), `compose-${randomUUID()}`);
  const scorePath = `${stem}.score.json`;
  writeFileSync(scorePath, JSON.stringify(score));

  const py = join(process.cwd(), "analyzer", ".venv", "bin", "python");
  const res = spawnSync(py, ["-m", "src.compose", "--score-json", scorePath, "--out", stem],
    { cwd: join(process.cwd(), "analyzer"), encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`compose render failed: ${res.stderr || res.stdout}`);
  }

  const report: Record<string, any> = JSON.parse(readFileSync(`${stem}.report.json`, "utf8"));
  const events: Array<{ voice: number; sid_chip: number; midi: number; onset_frame: number; gate_frames: number }> =
    JSON.parse(readFileSync(`${stem}.events.json`, "utf8"));

  const target = score.meta?.target_composer;
  if (target) {
    const tempo = (score.meta?.tempo_bpm as number | undefined) ?? 125;
    const fpb = Math.max(1, Math.round(3000 / tempo));
    const styleVoices: StyleVoice[] = (score.voices ?? []).map((v: any) => {
      const ve = events
        .filter((e) => e.voice === v.voice && e.sid_chip === (v.sid_chip ?? 1))
        .sort((a, b) => a.onset_frame - b.onset_frame);
      const midis = ve.map((e) => e.midi);
      const onsets = ve.map((e) => e.onset_frame / fpb);
      const gates = ve.map((e) => e.gate_frames / fpb);
      return {
        patch: { waveform: v.patch?.waveform ?? "pulse", adsr: v.patch?.adsr ?? [0, 0, 0, 0],
                 hard_restart: v.patch?.hard_restart ?? "" },
        vibrato: v.vibrato ? { rate_frames: v.vibrato.rate_frames, depth_cents: v.vibrato.depth_cents } : null,
        midis,
        onsets,
        gates,
        arp: (v.arps && v.arps.length > 0)
          ? { chord_intervals: v.arps[0].chord_intervals, cycle: v.arps[0].cycle, rate_frames: v.arps[0].rate_frames }
          : undefined,
      };
    });
    const chords: string[] = (score.sections ?? []).flatMap((s: any) => s.chords ?? []);
    const scoreTimbre = {
      pwm: (score.voices ?? [])
        .filter((v: any) => v.pwm)
        .map((v: any) => ({ depth: Number(v.pwm.depth) || 0, center: Number(v.pwm.center ?? v.patch?.pulse_width ?? 2048) })),
      filter: score.filter ? { active: true } : null,
    };
    const drumHits = (score.voices ?? [])
      .flatMap((v: any) => (v.drums ?? []).map((d: any) => Number(d.beat)))
      .sort((a: number, b: number) => a - b);
    const drumIois: number[] = [];
    for (let i = 1; i < drumHits.length; i++) drumIois.push(Math.max(1, Math.round((drumHits[i] - drumHits[i - 1]) * 4)));
    report.style = await styleProximity({
      composer: target, voices: styleVoices, graphName: opts.graphName,
      chords: chords.length > 0 ? chords : undefined,
      key: score.meta?.key, mode: score.meta?.mode,
      timbre: scoreTimbre, drums: drumIois,
    });
  }

  return { report, sidPath: `${stem}.sid` };
}

// CLI: npm run compose:graded -- --score score.json
async function main(): Promise<void> {
  const argv = process.argv;
  const get = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const scorePath = get("score");
  if (!scorePath) { console.error("Missing --score"); process.exit(1); }
  const score = JSON.parse(readFileSync(scorePath, "utf8"));
  const { report, sidPath } = await composeScore(score);
  console.log(JSON.stringify(report, null, 2));
  console.log(`[compose] sid: ${sidPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

const _PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Transpose a key-relative degree string into absolute chord symbols for a key
 * (keyPc 0-11). "0min-10maj-8maj" @ keyPc 9 -> ["Am","G","F"]. Pure. */
export function degreesToChordSymbols(degrees: string, keyPc: number): string[] {
  const out: string[] = [];
  for (const tok of degrees.split("-")) {
    const m = tok.match(/^(\d+)(maj|min)$/);
    if (!m) continue;
    const rootPc = (Number(m[1]) + keyPc) % 12;
    out.push(_PC_NAMES[rootPc] + (m[2] === "min" ? "m" : ""));
  }
  return out;
}

/** Pick the composer's top FAVORS_PROGRESSION and transpose it into the target
 * key, returning chord symbols ready to drop into a Score's sections[].chords.
 * Returns [] if the composer has no mined progression. */
export async function harmonyFill(
  args: { composer: string; key: string; graphName?: string },
): Promise<{ chords: string[]; degrees: string | null; roman: string | null }> {
  const keyPc = tonicPcFromKeyName(args.key);
  if (keyPc === null) return { chords: [], degrees: null, roman: null };
  const client = new FalkorHvscClient(args.graphName ? { graphName: args.graphName } : {});
  await client.connect();
  try {
    const rows = await client.rawQuery<{ degrees: string }>(
      `MATCH (c:Composer {name: $name})-[r:FAVORS_PROGRESSION]->(p:Progression)
       RETURN p.degrees AS degrees ORDER BY r.weight DESC, p.id ASC LIMIT 1`,
      { name: normalizeName(args.composer) },
    );
    if (rows.length === 0) return { chords: [], degrees: null, roman: null };
    const degrees = rows[0].degrees;
    return { chords: degreesToChordSymbols(degrees, keyPc), degrees, roman: degreesToRoman(degrees) };
  } finally {
    await client.disconnect();
  }
}
