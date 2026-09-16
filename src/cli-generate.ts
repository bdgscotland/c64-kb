/** Generate from a seed tune: dump its vocabulary, run the Python assembler.
 *   npm run generate -- --seed <md5> --subtune 0 --out gen
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { FalkorHvscClient } from "./services/falkor-hvsc.js";
import { dumpSeed } from "./hvsc/dump-seed.js";

function arg(name: string, def?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (def !== undefined) return def;
  console.error(`Missing --${name}`); process.exit(1);
}

async function main(): Promise<void> {
  const md5 = arg("seed");
  const subtune = parseInt(arg("subtune", "0"), 10);
  const out = arg("out", "gen");

  const client = new FalkorHvscClient();
  await client.connect();
  const seed = await dumpSeed(client, md5, subtune);
  await client.disconnect();

  const seedPath = join(tmpdir(), `seed-${md5}-${subtune}.json`);
  writeFileSync(seedPath, JSON.stringify(seed));
  console.log(`[generate] dumped seed: ${seed.voices.length} voices, ${seed.sections.length} sections`);

  const py = join(process.cwd(), "analyzer", ".venv", "bin", "python");
  const res = spawnSync(py, ["-m", "src.generate", "--seed-json", seedPath, "--out", out],
    { cwd: join(process.cwd(), "analyzer"), stdio: "inherit" });
  process.exit(res.status ?? 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
