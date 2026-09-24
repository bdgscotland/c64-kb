/**
 * Setup commands: the steps an npm install needs before any lookup works.
 * In a repository checkout the npm scripts do the same (`npm run services`,
 * `npm run ingest`); an installed package has no npm scripts, so without
 * these a user could not start the stores or fill them.
 *
 *   c64-kb services up|down|status   Qdrant + FalkorDB in Docker
 *   c64-kb ingest [--clean|--force]  build both stores from the shipped docs/
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Argument, type Command } from "commander";
import { config } from "../config.ts";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COMPOSE_FILE = path.join(PACKAGE_ROOT, "docker-compose.yml");

const COMPOSE_ARGS: Record<string, string[]> = {
  up: ["up", "-d", "--wait"],
  down: ["down"],
  status: ["ps"],
};

/**
 * Run `docker compose` on the shipped compose file. The stores' volumes go
 * under the data folder (C64_KB_STORAGE), not inside the package, which an
 * upgrade would replace. The project name is fixed so `down` finds what
 * `up` started from any working directory.
 */
function compose(action: string): number {
  const args = COMPOSE_ARGS[action] ?? [];
  const storage = process.env.C64_KB_STORAGE ?? path.join(config.dataDir, "storage");
  // Create the bind-mount folders as this user first. On Linux, Docker
  // creates a missing one as root, parents included, and the data folder
  // then refuses the ingest's writes (EACCES on ingest.log, CI 2026-09-24).
  for (const store of ["qdrant", "falkordb"]) fs.mkdirSync(path.join(storage, store), { recursive: true });
  const r = spawnSync("docker", ["compose", "-f", COMPOSE_FILE, "-p", "c64-kb", ...args], {
    stdio: "inherit",
    env: { ...process.env, C64_KB_STORAGE: storage },
  });
  if (r.error) {
    console.error(`c64-kb services: could not run docker (${r.error.message}). Install Docker, then retry.`);
    return 1;
  }
  return r.status ?? 1;
}

export function registerSetupCommands(program: Command): void {
  program
    .command("services")
    .description("Start, stop or list the Qdrant and FalkorDB containers (needs Docker)")
    .addArgument(new Argument("<action>", "what to do").choices(Object.keys(COMPOSE_ARGS)))
    .action((action: string) => {
      process.exitCode = compose(action);
    });

  program
    .command("ingest")
    .description("Build the vector store and the graph from the docs (needs services and Ollama)")
    .option("--clean", "Wipe the graph and the collection first")
    .option("--force", "Re-ingest every file (implies --clean)")
    .action(async (opts: { clean?: boolean; force?: boolean }) => {
      const { runIngest } = await import("../ingest.ts");
      const forceAll = opts.force === true;
      process.exitCode = await runIngest({ forceAll, cleanFirst: forceAll || opts.clean === true });
    });

  program
    .command("gaps-replay")
    .description("Replay every open logged gap through its tool and resolve the ones that now answer")
    .action(async () => {
      const { replayGaps, formatGapReplay } = await import("../tools/gap-replay.ts");
      const report = await replayGaps();
      if (program.opts().json === true) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else process.stdout.write(formatGapReplay(report, true));
    });
}
