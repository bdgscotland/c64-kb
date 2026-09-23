/**
 * VERIFIED_ON (schema 29): after every ingest, rebuild the Recipe →
 * MachineVariant edges from docs/recipes/runs.json, the only file besides
 * markdown the ingest reads. See src/graph/machine-variants.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { verifiedOnEdges } from "../graph/machine-variants.ts";
import type { FalkorService } from "../services/falkor.ts";
import { log } from "./files.ts";

export async function linkVerifiedOn(
  falkor: FalkorService,
  docsDir: string,
  print: (line: string) => void,
): Promise<{ landed: number; problems: string[] }> {
  const manifestPath = path.join(docsDir, "recipes", "runs.json");
  if (!fs.existsSync(manifestPath)) {
    print("VERIFIED_ON: no docs/recipes/runs.json, no edges");
    return { landed: 0, problems: [] };
  }
  const rows = z
    .array(z.object({ s: z.string().nullable() }))
    .parse((await falkor.roQuery(`MATCH (r:Recipe) RETURN r.source_doc AS s`)).data);
  const pages = rows.flatMap((r) => {
    const m = /^recipes\/([^/]+\/[^/]+)\.md$/.exec(r.s ?? "");
    return m?.[1] ? [m[1]] : [];
  });
  const { edges, unknownModels, missingShots } = verifiedOnEdges({
    manifestJson: fs.readFileSync(manifestPath, "utf-8"),
    pages: pages.sort(),
    shotExists: (toolchain, shot) => fs.existsSync(path.join(docsDir, "recipes", toolchain, shot)),
  });
  const { landed, dropped } = await falkor.replaceVerifiedOn(edges);
  const problems = [
    ...unknownModels.map((u) => `model with no variant: ${u}`),
    ...missingShots.map((m) => `no committed screenshot: ${m}`),
    ...dropped.map((d) => `dropped: ${d}`),
  ];
  if (problems.length > 0) {
    console.warn(`[ingest] VERIFIED_ON: ${problems.length} problem(s): ${problems.join("; ")}`);
    log(`VERIFIED_ON_PROBLEMS ${problems.join("; ")}`);
  }
  const unpinned = edges.filter((e) => !e.pinned).length;
  print(
    `VERIFIED_ON: ${landed} edges from runs.json (${unpinned} from verify:recipes defaults, no runs.json entry), ${problems.length} problems`,
  );
  return { landed, problems };
}
