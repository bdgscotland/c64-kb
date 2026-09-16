# Technique Reference Conventions

Technique docs live in `docs/techniques/<category>.md`. Each doc covers ONE category
(raster, sprite, scroll, bitmap, banking, etc.) and contains multiple Technique
entries as H2 sections. The extractor parses each H2 as one Technique node.

The marker `<!-- doc-type: technique-reference -->` MUST appear in the first 10
lines for the extractor to process the file.

## File-level frontmatter

```yaml
---
category: raster              # raster | sprite | scroll | bitmap | effect | music | cpu | banking | loader
chip: VIC-II                  # primary chip; optional
---
```

`category` is required. `chip` is optional but used to seed BELONGS_TO edges
from each Technique in the doc.

## Technique entries

Every Technique in the doc gets an H2 in this exact format:

```
## stable_raster_irq — Stable raster IRQ
```

Breakdown:
- `## ` (H2)
- `stable_raster_irq` — snake_case canonical name (matches ontology Technique.name)
- ` — ` — em-dash separator (Unicode U+2014)
- `Stable raster IRQ` — human-readable title (free-form)

Following each Technique H2 block, an optional `**Complexity:**` line declares
the complexity rating, one of `low | medium | high | scene-tier`:

```
**Complexity:** medium
```

An optional `**Region:**` line declares region requirements:

```
**Region:** PAL
```

If present and not `both`, the extractor emits a REQUIRES_REGION edge.

An optional `**Uses registers:**` line lists registers the technique reads or writes:

```
**Uses registers:** D011, D012, D019
```

Comma-separated. The extractor emits one `USES` edge per register.

An optional `**Uses kernal:**` line lists KERNAL routines:

```
**Uses kernal:** CHROUT, CHKOUT
```

Same comma rules; one `USES` edge per routine.

## Section structure inside a Technique

After the H2 + metadata lines, free-form prose covering:

1. **Why** — the problem this technique solves
2. **How** — algorithm at conceptual level (asm-language-agnostic)
3. **Why it works** — chip-level explanation (which register reads/writes drive the effect)
4. **Variations** — 1-3 common variants
5. **Cycle budget** — for raster-critical techniques, the per-line cycle accounting
6. **Recipes** — bullet list of `recipes/<toolchain>/<name>.md` files that implement this

H3 inside a Technique is OK for sub-sections; the extractor only consumes H2 + the
metadata lines and ignores deeper structure.
