# Toolchain Reference Conventions

Toolchain reference docs in `docs/toolchains/` and `docs/runtime/` follow these
patterns so `src/graph/extract.ts` can parse them. A doc that deviates breaks the graph build.

The marker `<!-- doc-type: toolchain-reference -->` MUST appear in the first 10
lines for the extractor to process the file.

## File-level frontmatter

```yaml
---
tool: oscar64                  # canonical tool name (lowercase, hyphen-separated)
tool_kind: c-compiler          # c-compiler | c-library | assembler | linker | emulator | debug-bridge | unit-test | reference-catalog | asset-converter
maintainer: drmortalwombat     # GitHub login or org
license: MIT                   # SPDX identifier
home_url: https://github.com/drmortalwombat/oscar64
---
```

`tool`, `tool_kind`, and `home_url` are required. `maintainer` and `license` are
optional but expected.

An optional `version_verified: "5.25"` key names the version of the tool
that this repo's gates (`check:listings`, `verify:recipes`) ran with, as
the tool itself reports it: the KickAssembler banner, `oscar64`'s
"Starting oscar64 …" line, `cl65 --version`. Quote it so YAML keeps it a
string. It becomes `Tool.version_verified`, and `c64_recipe_lookup`
names it beside the recipe's toolchain. It records what this machine
ran, not a minimum; another release may or may not build
the same listing. Change it in the same commit that moves the gates to a
new version.

## Tool entry

Every doc that introduces a Tool has exactly one H2 named `## Tool` (case-sensitive)
immediately after the frontmatter. The body is free-form prose describing the
tool's role. The extractor reads frontmatter for the entity properties; the H2
serves as the anchor for hybrid retrieval.

## FileFormat entries

Every file format produced or consumed gets an H3 in this exact format:

```
### .PRG — Program file (executable)
```

Breakdown:
- `### ` (H3)
- `.PRG` — extension, uppercase, dot-prefixed
- ` — ` — em-dash (Unicode U+2014)
- `Program file (executable)` — description (free-form)

Following each FileFormat H3 block, an optional `**Produced by:** oscar64, kickassembler, cc65`
line declares which tools produce it (comma-separated tool canonical names). An optional
`**Consumed by:** vice, c1541` line declares consumers. The extractor emits one
`PRODUCES` edge per producer and one `CONSUMES` edge per consumer.

## Tool-tool relationships

Inside any toolchain-reference doc, a paragraph beginning `**Targets:** chip-name(s)`
declares which chip(s) the tool's output targets. Comma-separated; canonical chip
names from `docs/ONTOLOGY.md` (`VIC-II`, `SID`, `CIA1`, `CIA2`, `6510`).

Example:

```
**Targets:** 6510
```

## Cross-doc references

Use the bracketed-link form `[oscar64](../toolchains/oscar64-reference.md)` so
the chunker preserves the link; the extractor does not currently follow these.

## Section structure

After `## Tool`, content sections are free-form H2s. Recommended order:

1. Quick reference (install one-liner, basic CLI invocation)
2. Build pipeline (input file types → output file types)
3. Core CLI flags / common arguments
4. Idioms: toolchain-specific patterns the LLM should prefer
5. Header reference (for c-compilers and assembler libraries; H3 per header file)
6. Common pitfalls
7. See also (links to recipes, related tools)

Format-only docs (`docs/formats/`) use `<!-- doc-type: format-reference -->` instead of the toolchain marker. The extractor parses FileFormat H3 blocks and `**Produced by:** / **Consumed by:**` edges from these docs but does NOT emit a Tool entity.
