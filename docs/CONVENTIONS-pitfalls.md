# Pitfall Reference Conventions

Pitfall docs live in `docs/pitfalls/<category>.md`. Each doc covers ONE
category (raster, sprite, sid, region, kernal, banking, cpu, loader,
input, render, scroll, cia) and contains multiple Pitfall entries as H2
sections. The extractor parses each H2 as one Pitfall node. The
category is carried into the node as written; the extractor keeps no
whitelist, so this list is the set in use, not a constraint it
enforces (it read eight names until 2026-09-22 while twelve docs
existed).

The marker `<!-- doc-type: pitfall-reference -->` MUST appear in the
first 10 lines for the extractor to process the file.

## File-level frontmatter

```yaml
---
category: raster              # raster | sprite | sid | region | kernal | banking | cpu | loader | input | render | scroll | cia
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

All `Triggered by …` lines are optional and additive — the extractor emits one TRIGGERED_BY edge per item. At least ONE Triggered-by line must be present (otherwise the pitfall has no graph anchor and won't surface through `c64_pitfalls_for`).

After the `Triggered by …` lines, one optional additive line names the
technique(s) whose application is the Fix section's remedy:

```
**Mitigated by techniques:** double_irq
```

Comma-separated existing Technique names; the extractor emits one
MITIGATED_BY edge per item, Pitfall to Technique, and nothing else — a
register or KERNAL routine is never a remedy in this sense. The line
separates two relations one vocabulary used to carry: the technique in
whose code the pitfall arises (Triggered by) and the technique that cures
it (Mitigated by). A technique on the Mitigated-by line may also be on
the Triggered-by line when the pitfall arises inside a naive version of
the technique and a correct version cures it — `sprite_dma_overflow` and
`sprite_multiplex_8`, `raster_irq_first_line_jitter` and
`stable_raster_irq`, `jmp_indirect_page_boundary_bug` and
`jump_table_dispatch`, three of the six pitfalls that carry the line — and
Mechanism should say so; otherwise a technique is on one line or the
other. If the remedy is not a Technique node — the SID hard restart
lives in `hardware/sid-reference.md`, "take `$0318`" in
`restore_nmi_not_maskable` is a handler, not a technique — write nothing;
do not invent a technique to have something to point at. A name that
matches no Technique node is dropped at link time with a warning and
counted in the ingest summary beside triggered_by. `c64_pitfalls_for`
returns a pitfall for its remedy technique as well as for its triggers,
with the two lists kept apart; `c64_technique_lookup` lists the pitfalls a
technique mitigates.

## Section structure inside a Pitfall

After the H2 + metadata lines, free-form prose covering:

1. **Symptom** — what the developer sees when this bites
2. **Mechanism** — what's actually happening at the hardware level
3. **Fix** — concrete code/timing change
4. **Worked example** — short asm or C snippet showing both the bad pattern and the fix
5. **Cross-references** — related techniques, registers, recipes
