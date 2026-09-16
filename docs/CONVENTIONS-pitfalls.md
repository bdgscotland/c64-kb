# Pitfall Reference Conventions

Pitfall docs live in `docs/pitfalls/<category>.md`. Each doc covers ONE
category (raster, sprite, sid, region, kernal, banking, cpu, loader)
and contains multiple Pitfall entries as H2 sections. The extractor
parses each H2 as one Pitfall node.

The marker `<!-- doc-type: pitfall-reference -->` MUST appear in the
first 10 lines for the extractor to process the file.

## File-level frontmatter

```yaml
---
category: raster              # raster | sprite | sid | region | kernal | banking | cpu | loader
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

## Section structure inside a Pitfall

After the H2 + metadata lines, free-form prose covering:

1. **Symptom** — what the developer sees when this bites
2. **Mechanism** — what's actually happening at the hardware level
3. **Fix** — concrete code/timing change
4. **Worked example** — short asm or C snippet showing both the bad pattern and the fix
5. **Cross-references** — related techniques, registers, recipes
