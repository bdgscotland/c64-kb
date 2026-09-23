/**
 * kernal-zp-walk: the zero-page bytes each KERNAL jump-table routine may
 * write, from a static walk of the ROM (scripts/lib/kernal-walk.ts), and the
 * `**Clobbers zero page:**` line under each routine H3 of
 * docs/hardware/kernal-routines-reference.md that states them.
 *
 *   node scripts/kernal-zp-walk.ts            # print the walk, one routine per line
 *   node scripts/kernal-zp-walk.ts --json     # the same as JSON
 *   node scripts/kernal-zp-walk.ts --write    # rewrite the page lines from the walk
 *   node scripts/kernal-zp-walk.ts --check    # exit 1 if the page disagrees with the walk
 *
 * The ROM is found by findKernal (KERNAL_ROM, the repo's headless VICE, a
 * VICE install). Without one, --check exits 0 with a notice: the page is
 * the committed result, and the test says it skipped.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findKernal } from "./lib/kernal-walk.ts";
import {
  KERNAL_PAGE,
  applyWalkToPage,
  walkAll,
  pageDisagreements,
  walkReport,
} from "./lib/kernal-zp-page.ts";

const root = join(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));
const rom = findKernal(root);
if (!rom) {
  console.log("kernal-zp-walk: no KERNAL 901227-03 image found (set KERNAL_ROM); nothing checked");
  process.exit(0);
}
const pagePath = join(root, KERNAL_PAGE);
const page = readFileSync(pagePath, "utf8");
const walk = walkAll(rom.bytes, page);

if (args.has("--json")) {
  console.log(JSON.stringify(walk, null, 1));
} else if (args.has("--write")) {
  const next = applyWalkToPage(page, walk);
  if (next !== page) writeFileSync(pagePath, next);
  console.log(next === page ? "kernal-zp-walk: page already agrees" : `kernal-zp-walk: wrote ${KERNAL_PAGE}`);
} else if (args.has("--check")) {
  const bad = pageDisagreements(page, walk);
  for (const b of bad) console.error(b);
  if (bad.length > 0) {
    console.error(`kernal-zp-walk: ${bad.length} line(s) disagree with the ROM walk; run with --write`);
    process.exit(1);
  }
  console.log(`kernal-zp-walk: ${walk.routines.length} routines agree with the ROM walk (${rom.path})`);
} else {
  console.log(walkReport(walk));
}
