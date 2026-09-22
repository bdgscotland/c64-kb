---
name: add-doc
description: Add or restructure a knowledge-base document so the extractor turns it into graph nodes and edges and the listing gate accepts it. Use when asked to add a technique, pitfall, recipe, hardware reference or failure pattern, or when an ingest reports zero entities or dropped references for a file.
---

# add-doc — a page the graph can read

Announce: "Using add-doc for <path>."

## 1. Pick the doc type and read its conventions file

| Type | Path | Conventions | Marker |
|---|---|---|---|
| technique | `docs/techniques/<family>.md` (H2 per technique) | `CONVENTIONS-techniques.md` | `<!-- doc-type: technique-reference -->` |
| pitfall | `docs/pitfalls/<category>.md` (H2 per pitfall) | `CONVENTIONS-pitfalls.md` | `<!-- doc-type: pitfall-reference -->` |
| recipe | `docs/recipes/<toolchain>/<name>.md` | `CONVENTIONS-recipes.md` | `<!-- doc-type: recipe -->` |
| hardware | `docs/hardware/*.md` (H3 per register/region/routine) | `CONVENTIONS-hardware-reference.md` | see file |
| failure pattern | `docs/c64-failure-patterns.md` | `CONVENTIONS-failures.md` | see file |
| toolchain | `docs/toolchains/*.md` | `CONVENTIONS-toolchain-reference.md` | see file |

The extractor (`src/graph/extract.ts`) is regex-driven: the H2 shape
`## snake_name — Title`, the `**Field:**` metadata lines, and the
frontmatter keys are load-bearing. A typo there is not a style problem; it
is a node that never exists.

## 2. Metadata that becomes edges

- `**Uses registers:**` — names or hex (`SCROLY` or `D011`); must exist in
  `docs/hardware/c64-registers-reference.md`.
- `**Uses kernal:**` — routine names from `kernal-routines-reference.md`.
- `**Region:**` PAL | NTSC | both.
- `**Demands:**` — only words from the vocabulary in
  `CONVENTIONS-techniques.md` (`cpu_every_line`, `constant_sprite_set`,
  `badline_free_region`, `midframe_raster_irqs`, `changes_sprite_set`,
  `continuous_interrupts`, `kernal_rom_out`). Only add one the text
  supports; these decide `c64_check_compatibility`'s hard conflicts.
- `**Requires:**` (techniques) — snake_case names of existing Technique
  H2s this one is set up on top of; one REQUIRES edge each, Technique to
  Technique. Only what the entry's own text supports: not a "see also",
  and a variant is not a prerequisite (`double_irq` and `stable_raster_irq`
  list neither). A line that would close a cycle is refused; a name with
  no Technique node is warned about and counted. These feed
  `c64_check_compatibility`'s prerequisite closure and the `requires`
  filter of `c64_techniques_for`.
- `**Mitigated by techniques:**` (pitfalls) — the existing Technique(s)
  whose application is the Fix; one MITIGATED_BY edge each, Pitfall to
  Technique. Never a register or KERNAL routine; may repeat a Triggered-by
  name when a naive form causes and a correct form cures, said so in
  Mechanism. Misses are warned about and counted.
- `**Triggered by registers/kernal/techniques:**` (pitfalls) and
  `**Caused by …:**` (failure patterns) — every name must be an existing
  node; ingest warns and counts each one that is not.
- Recipe frontmatter `techniques:` — existing technique names only.

Every cross-reference in prose (`recipes/oscar64/x.md`, `hardware/y.md`)
must point at a file that exists. "No recipe yet" is the honest form.

## 3. Listings

Any code fence tagged `asm`, `kick`, `kickassembler` or `c` is built by
`npm run check:listings` (and by the post-edit hook). KickAssembler
fragments get a `* = $1000` prelude and stubs for undefined labels, so a
fragment may be incomplete but not wrong for the assembler it claims.
Recipes must build clean and, if they draw, be run and measured
(`verify-listing`).

## 4. Ingest and check the counts

```bash
npm run ingest                # new file
npm run ingest:clean          # if you changed metadata on an existing file
```

Read the summary line: `stub Techniques: 0`, `… 0 dropped`. For a
technique or pitfall file, the number of graph entities should equal the
number of `## name — ` headings. Then look at what an agent gets:

```bash
npx tsx src/cli.ts technique-lookup <name>
npx tsx src/cli.ts pitfalls-for <name>
npx tsx src/cli.ts search "<a phrase from your page>"
```

## 5. Before committing

Bump `KB_DATA_VERSION` in `VERSION`; add a `CHANGELOG.md` line if the
change is more than a correction; run the gates in CLAUDE.md; stage named
paths.
