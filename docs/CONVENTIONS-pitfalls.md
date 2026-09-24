# Pitfall Reference Conventions

Pitfall docs live in `docs/pitfalls/<category>.md`. Each doc covers ONE
category (raster, sprite, sid, region, kernal, banking, cpu, loader,
input, render, scroll, cia, maths, logic) and holds several Pitfall
entries as H2 sections. The extractor parses each H2 as one Pitfall
node. The category is copied into the node as written. The extractor
keeps no whitelist, so this list is the set in use, not a constraint it
enforces (it read eight names until 2026-09-22 while twelve docs
existed; maths and logic were added on 2026-09-23 when their pages
were created). Add a new category only when no existing page's
intro covers the fault: copy the marker and front matter from the
newest page and add the name here.

The marker `<!-- doc-type: pitfall-reference -->` MUST appear in the
first 10 lines for the extractor to process the file.

## File-level frontmatter

```yaml
---
category: raster              # raster | sprite | sid | region | kernal | banking | cpu | loader | input | render | scroll | cia | maths | logic
---
```

## Pitfall entries

Every Pitfall in the doc gets an H2 in this exact format:

```
## badline_cycle_loss — Badline DMA steals 40-43 cycles from the CPU
```

Breakdown:
- `## ` (H2)
- `badline_cycle_loss` — snake_case canonical name (matches ontology Pitfall.title surrogate; the extractor uses the snake_case form as the node primary key and the prose form as the human-readable title)
- ` — ` — em-dash separator (Unicode U+2014)
- Free-form one-line title

Following each Pitfall H2 block:

```
**Severity:** critical            # critical | high | medium | low
**Region:** both                  # PAL | NTSC | both (use 'both' if the pitfall manifests in either region)
**Triggered by registers:** D011, D012
**Triggered by kernal:** CHKIN
**Triggered by techniques:** stable_raster_irq, sprite_multiplex_8
```

Each `Triggered by …` line is optional and additive: the extractor emits one TRIGGERED_BY edge per item. At least ONE Triggered-by line must be present, or the pitfall has no graph anchor and `c64_pitfalls_for` cannot return it. In the other direction, a technique no pitfall names cannot reach any pitfall through the graph, and `c64_pitfalls_for` falls back to a semantic guess for it. `npm run check:pitfall-anchors` lists those techniques and fails on a name that matches no Technique H2. When adding a technique, add it to the Triggered-by line of every pitfall whose mechanism its code meets. `node scripts/check-pitfall-coverage.ts` does the same for registers and KERNAL routines: it lists each documented one that no `Triggered by registers:` or `Triggered by kernal:` line names, with its access, the side-effect words in its reference section and how many techniques use it, for a writer to triage. It fails on a trigger that names nothing documented.

After the `Triggered by …` lines, one optional additive line names the
technique(s) whose application is the Fix section's remedy:

```
**Mitigated by techniques:** double_irq
```

Comma-separated existing Technique names. The extractor emits one
MITIGATED_BY edge per item, Pitfall to Technique, and nothing else; a
register or KERNAL routine is never a remedy in this sense. The line
separates two relations that one vocabulary used to carry: the technique in
whose code the pitfall arises (Triggered by) and the technique that cures
it (Mitigated by). A technique may be on both lines when the pitfall
arises inside a naive version of the technique and a correct version
cures it. Three of the six pitfalls that carry the line do this
(`sprite_dma_overflow` and
`sprite_multiplex_8`, `raster_irq_first_line_jitter` and
`stable_raster_irq`, `jmp_indirect_page_boundary_bug` and
`jump_table_dispatch`), and
Mechanism should say so. Otherwise a technique is on one line or the
other. If the remedy is not a Technique node, write nothing (the SID hard
restart lives in `hardware/sid-reference.md`; "take `$0318`" in
`restore_nmi_not_maskable` is a handler, not a technique). Do not invent
a technique to have something to point at. A name that
matches no Technique node is dropped at link time with a warning and
counted in the ingest summary beside triggered_by. `c64_pitfalls_for`
returns a pitfall for its remedy technique as well as for its triggers,
with the two lists kept apart; `c64_technique_lookup` lists the pitfalls a
technique mitigates.

## Section structure inside a Pitfall

After the H2 + metadata lines, free-form prose covering:

1. **Symptom**: what the developer sees
2. **Mechanism**: what happens at the hardware level
3. **Fix**: the code or timing change
4. **Worked example**: short asm or C snippet showing both the bad pattern and the fix
5. **Cross-references**: related techniques, registers, recipes

A pitfall whose bad pattern can be recognised in source text may also have a lint rule, named after the pitfall and pointing at its page; the rules live in `src/tools/lint.ts` and are served as `c64_lint_source` (CLI `lint <file>`). Nothing on the page declares the rule, and a pitfall without one is the common case.
