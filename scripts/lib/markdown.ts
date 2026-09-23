/** Markdown helpers shared by the build scripts: fenced blocks, the docs tree, recipe pages. */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type Fence = { lang: string; code: string; index: number };

/** Capture group `n` of a match, or "" when the group did not take part. */
export function group(m: readonly (string | undefined)[], n: number): string {
  return m[n] ?? "";
}

/** Every fenced block in `md`, in order, with its language tag lower-cased. */
export function fences(md: string): Fence[] {
  return [...md.matchAll(/```(\w*)\n([\s\S]*?)```/g)].map((m, index) => ({
    lang: group(m, 1).toLowerCase(),
    code: group(m, 2),
    index,
  }));
}

/** Every .md file under `dir`, recursively. */
export function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** A recipe page has a `recipe:` key in its frontmatter (screenshots/README.md does not). */
export function isRecipePage(text: string): boolean {
  return /^---\n(?:[\s\S]*?\n)?recipe:/m.test(text);
}

export const RECIPE_TOOLCHAINS = ["kickassembler", "oscar64", "cc65"] as const;

/** The first `c` block with a main(): the listing of an Oscar64 or cc65 recipe. */
export function cListing(all: Fence[]): Fence | undefined {
  return all.find((x) => x.lang === "c" && /\bmain\s*\(/.test(x.code));
}

/** Only the compiler's error lines from a build log. */
export function errorLines(log: string): string {
  return log
    .split("\n")
    .filter((l) => /error/i.test(l))
    .join("\n");
}
