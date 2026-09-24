# Technique Reference Conventions

Technique docs live in `docs/techniques/<category>.md`. Each doc covers ONE category
(raster, sprite, scroll, bitmap, banking, input, etc.) and holds several Technique
entries as H2 sections. The extractor parses each H2 as one Technique node.
The category must be one of the words listed below; a doc with any other
category is refused at extract with a warning and contributes no techniques,
so a typo cannot create a category the briefing tools do not know.

The marker `<!-- doc-type: technique-reference -->` MUST appear in the first 10
lines for the extractor to process the file.

## File-level frontmatter

```yaml
---
category: raster              # raster | sprite | scroll | bitmap | effect | music | cpu | banking | loader | render
                              # | input | logic | maths | text | io   (game and application foundations)
chip: VIC-II                  # primary chip; optional
---
```

`category` is required. `chip` is optional; when present it seeds BELONGS_TO
edges from each Technique in the doc.

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

An optional `**Demands:**` line names the machine-level resources the
technique needs while it is active, from a fixed vocabulary. The extractor
makes one `DEMANDS` edge per item to a `Resource` node, and
`c64_check_compatibility` derives hard conflicts from them (two techniques
that both need every CPU cycle cannot share a raster line; a technique that
needs a constant sprite set cannot coexist with a multiplexer on the same
lines). Unknown words are rejected at ingest with a warning. Only add a
demand the technique's own text supports.

```
**Demands:** cpu_every_line, constant_sprite_set
```

| Demand | Meaning |
|---|---|
| `cpu_every_line` | needs every CPU cycle on every raster line of its region (FLI, side border) |
| `constant_sprite_set` | the set of active sprites must not change inside its region |
| `badline_free_region` | no badline may occur inside its region |
| `midframe_raster_irqs` | takes raster interrupts inside the display area |
| `changes_sprite_set` | changes which hardware sprites are active during the frame (multiplexers) |
| `continuous_interrupts` | takes timer or NMI interrupts every few raster lines, all frame (digi playback) |
| `kernal_rom_out` | runs with the KERNAL ROM banked out |
| `serial_bus_exclusive` | owns the drive and its serial bus while resident: KERNAL disk I/O to that drive stalls until it is uninstalled (a drive-code fast loader such as Krill's). `c64_check_compatibility` reports `serial_bus_busy` against a technique that uses LOAD, SAVE, OPEN, CLOSE, CHKIN, CHKOUT, CLRCHN or the low-level serial calls. |

`cpu_exclusive` and `cpu_vs_irq` through `midframe_raster_irqs` do not
fire between a technique and one that runs inside its own code: when either
is on the other's `**Requires:**` chain, or when the interrupting side is
an entry method that `shares` `vic_raster_irq` (its `**Claims:**` line) and
the `cpu_every_line` side `owns` it. The entry's interrupt starts the
effect's lines; it does not land inside them. So `fli_image` with
`double_irq` and `dysp_side_border_sprites` with `sideborder_open` pass,
while `fli_image` with `sprite_multiplex_24` (which owns the compare and
interrupts inside the band) still fails. An earlier version fired on every
such pair, against the fli-image, sideborder-open, dysp and tech-tech
recipes that run them together (#29). Claims unknown on either side keep
the rule.

Four loader words were considered and left out, because no page in this
repo can state them truthfully yet. `dd00_plain_stores` is Bitfire's rule
(plain stores of `$00`-`$03`, no read-modify-write); the KB has no Bitfire
page, and Krill's rule is close to the reverse: a whole-byte store breaks
it, and a read-modify-write of bits 0-1 while it is idle is tolerated
(`pitfalls/loader.md`, `fastloader_dd00_write_corrupts_resident`).
`io_visible_in_irq`, `loads_in_background` and `no_concurrent_loading` are
Bitfire and Spindle rules; no page here describes a loader that loads in
the background (Sparkle's calls block, per its manual; an earlier version of
this sentence called Sparkle a background loader).

An optional `**Requires:**` line names the techniques this one presupposes:
the named technique is set up before, or runs underneath, this one. The
extractor makes one `REQUIRES` edge per item, Technique to Technique.

```
**Requires:** stable_raster_irq
```

Each word is the snake_case name of an existing Technique H2, same comma
rules as `**Uses kernal:**`. It is a statement about what must be in place,
never a "see also". A technique that cites another for background
does not list it, and a *variant* is not a prerequisite: `double_irq` is
a variant of `stable_raster_irq` (raster.md), so neither lists the other.
Only add a line the technique's own text supports ("the technique requires
a stable raster IRQ set to fire on every scanline" earns one; "IRQ jitter,
see stable_raster_irq" does not). A word that is not a snake_case name is
refused at extract time; one that names no Technique node is dropped at
link time with a warning and counted in the ingest summary, as is a line
that would make A require B and B require A. `c64_technique_lookup` shows
the edge in both directions; `c64_techniques_for` filters on it ("what
builds on stable_raster_irq"); `c64_check_compatibility` runs its hard
rules between one technique's prerequisites and the other technique and
reports a hit as `prerequisite_conflict`, without changing anyone's
`**Demands:**`.

An optional `**Raster band:**` line names the raster lines on which the
technique holds the CPU. It rides the Technique node as `raster_band`. For a technique
that works by raster IRQs, the band is every line on which its IRQs run,
from the first IRQ line to the line on which the last handler exits.

```
**Raster band:** 45-251 (the fli-image recipe's first IRQ is on line 45; its handler exits on line 251)
```

The value is one of:

- comma-separated raster line numbers and inclusive ranges, `N` or `N-M`,
  0 to 311. The numbers are `$D012` values with bit 8 from `$D011`, the
  same numbers on PAL and NTSC; lines past 262 do not occur on NTSC. A band
  that wraps through line 0 is written as two ranges: `251-311, 0-44`.
- `movable`: the program chooses the lines (a side-border loop goes where
  the sprites are). It is not a known band.

A trailing parenthetical says where the numbers came from (the recipe's
IRQ line constants, a measured screenshot) and is not part of the value.
Anything else is refused at extract with a warning, and the technique then
conflicts as if it had no line.

`c64_check_compatibility` uses the band for the rules about sharing raster
lines: `cpu_exclusive`, `cpu_vs_irq` through `midframe_raster_irqs` or
`changes_sprite_set`, and `sprite_set`. When both techniques state line
ranges and no line is in both, those rules do not fire and the pair is
listed under `band_separated`. When they overlap, or either side has no
line or says `movable`, the conflict stands and its rationale says which.
`continuous_interrupts` and `kernal_banked_out` are not about lines and
ignore bands. The band covers every line the technique owns, including a
stable-raster entry above its visible region, since an interrupt there
breaks it just as one inside does. Take it from the page's own text or its
recipe's constants; where neither says, write no line.

An optional `**Cost:**` line states what the technique costs, as
comma-separated `key=value` pairs, every value a non-negative integer and
every key from the vocabulary below. It must be paired with a
`**Cost basis:**` line whose value is one word saying how the figures
were obtained. The extractor warns about and skips a pair with an unknown
key or a non-integer value; a basis word outside the set, or a Cost line
with no basis line, drops the whole Cost line with a warning, because a
number with no stated basis is worse than no number.

```
**Cost:** cycles_per_frame=332, irq_slots=1
**Cost basis:** measured-vice
```

| Key | Meaning |
|---|---|
| `cycles_per_line` | CPU cycles the technique takes on each raster line it is active on. A technique that needs every cycle of the line (FLI, side border) states 63, the whole PAL line. |
| `cycles_per_frame_typical` | a measured typical frame beside a `cycles_per_frame` that is a worst frame (schema 27): the frame play spends most of its time on, or the worst frame of a real run when `cycles_per_frame` is a built worst case. Only a figure the page states as measured; never above `cycles_per_frame`, and never without it (either is refused with a warning). A budget sums these for its low end; because the figure may be a run's worst frame, and two members' such frames need not coincide, that low end is not a floor and a budget never calls a plan over on it. |
| `cycles_per_frame` | CPU cycles the technique takes per frame, a PAL frame of 19,656 cycles unless the technique's own page states otherwise. It is the worst frame, not an average: a soft scroller whose column carry runs once in eight frames states the carry frame, because that is the frame a plan has to fit. For a routine that is called on demand (a multiply, a random step), the cost of one call, on the assumption of one call per frame; the page's per-call figure is the number to state. A routine the page places outside the frame loop (a level-start map expand, a one-off table build) states no `cycles_per_frame` when the line already carries a per-frame figure; its cost stays in the prose. A technique that only ever runs outside play (a disk save, a file read) may state its one-call cost, so that a plan listing it in a transition phase names the figure: above one frame, a budget reports it as `multi_frame` and never sums it. An earlier version of this rule forbade that figure, which left every plan that saves a file with an unknown. The figure is the technique's own work, never a demonstration's stand-in payload. |
| `lines_active` | raster lines per frame on which the technique runs code (the region of a side-border loop, the two lines of a double IRQ). |
| `bytes_code` | bytes of code in the built recipe's segments, as `-showmem` or the Oscar64 map reports them. When the page states only a PRG size, that size less the two-byte load address, and the measured-on line says `whole PRG` so a budget does not sum a runtime once per technique. |
| `bytes_data` | bytes of tables, buffers and other data in the built recipe's segments (a sine table, an image, a fade table). |
| `zp_bytes` | zero-page bytes the technique claims. |
| `irq_slots` | the raster or timer interrupts the technique needs per frame (a stable raster IRQ is one, a double IRQ two, a ten-bar raster-bar ring ten). |
| `sprites_per_line` | the most hardware sprites displayed on one raster line of the technique's lines, 0 to 8; a value above 8 is refused. `c64_timing_budget` subtracts their DMA from the line: 3 + 2 per sprite for sprites numbered without gaps, 19 for eight (measured in VICE x64sc, `hardware/vic-ii-reference.md`, "Sprite DMA"). State it where the page or its recipe puts sprites on the technique's lines. |

| Basis | Meaning |
|---|---|
| `measured-vice` | the figure was measured in a VICE run, by a CIA timer harness or the exit screenshot, and the page states it as measured. |
| `derived-listing` | the figure was read off a built listing, `-showmem` output or a linker map. |
| `arithmetic` | the figure was worked from settled constants (63 cycles a line, the instruction table, a stated table size). |
| `estimated` | the figure is a judgement, not a measurement; a briefing will name it as the weakest basis in a sum. |

One basis word covers the whole line, so it is the weakest that applies to
any figure on it: a line with a measured cycle count and an estimated byte
count says `estimated`. Never write `measured-vice` for a number that was
not measured or that the page does not state as measured. The values ride
the Technique node as `cost_<key>` and `cost_basis`; `c64_technique_lookup`
returns them as `cost` and the briefing tools add them up over a proposed
set, naming the techniques with no line.

Two optional lines follow the basis (schema 27). A figure belongs to the
implementation it was measured on, and one figure can already hold another
technique's work.

```
**Cost:** cycles_per_frame=3188, cycles_per_frame_typical=1170
**Cost basis:** measured-vice
**Cost measured on:** oscar64-wave-director (worst frame, screen blanked)
**Cost includes:** object_pool
```

- `**Cost measured on:**` names the recipe the figures were measured on
  or counted from, as its canonical name (`<toolchain>-<recipe>`), with
  an optional parenthetical of conditions. Write the conditions a plan
  needs: `screen on` when the figure was measured with the display on,
  so its badline stalls are inside it; `screen blanked` or `in the
  vertical blank` when they are not (a budget with the screen on charges
  the badlines outside any band charge, 43 cycles each, when a summed
  figure does not say `screen on`); `whole PRG` (the byte figures are the whole program), and what was
  timed (`one call`, `per press`, `constructed upper bound`). No line
  when the page does not say where its figure came from. It lands as
  `cost_recipe` and `cost_conditions`; ingest warns about a name that is
  no Recipe.
- `**Cost includes:**` names techniques whose per-frame work is inside
  this figure, comma-separated. Authored, never inferred: write it only
  when the page says the figure covers that technique's work in the
  recipe. A plan that lists both counts the included one once. It lands
  as `cost_includes`; ingest warns about a name that is no Technique.

Both are dropped with the Cost line when that is refused, and a line
without a Cost line is ignored with a warning. `c64_plan_budget` uses all
of them: a member with no cycles figure is unknown, never zero; a figure
above one frame is a multi-frame operation and is not summed; a technique
with `cycles_per_line=63` and a line band is charged band lines × line
length, and its REQUIRES closure is not added again. It calls a plan
over only when work that runs every frame (band and per-line charges)
plus the badline loss no figure can already hold passes the frame.

An optional `**Claims:**` line names the pieces of hardware the technique
holds while it runs, and how. It must be paired with a `**Claims basis:**`
line. Each item is a seeded HardwareUnit (`docs/ONTOLOGY.md`) and becomes
a CLAIMS edge; `c64_check_compatibility` sets two claims on one unit
against each other.

```
**Claims:** sprite_0-7 (owns), vic_raster_irq (owns)
**Claims basis:** derived-listing
```

Grammar:

- items are comma-separated; commas inside parentheses do not split.
- an item is `<unit>` or `<unit> (<mode>)`. The mode is one of `owns`
  (the default: writes or holds the unit every frame, nobody else may),
  `shares` (writes it under the owner's protocol: after the owner's write
  in the frame, or as a handler in the owner's interrupt chain), `reads`
  (reads only; the owner's writes change what it sees), `init` (uses it
  once before the frame loop, then leaves it).
- a numbered run of units is one item: `sprite_0-7`, `sid_voice_1-3`.
- zero page names its bytes: `zero_page $02-$0D+$24-$2F (owns)`. Add
  `relocatable` when a build option moves them:
  `zero_page $E0-$EF (owns, relocatable)`. `$00-$01` is the 6510 port,
  not zero-page RAM, and is refused.
- `none` alone means the technique claims no unit. That is a claim too:
  write it only after reading the page and its recipes. No line at all
  means unknown, and the compatibility check says a unit conflict with
  that technique cannot be ruled out.
- the basis is one word: `measured-vice` (a VICE store trace saw the
  writes), `derived-listing` (read off the built listing or the Oscar64
  header source), `estimated` (page prose, not checked).

An unknown unit word, a bad range, an unknown mode, or a Claims line
without a basis is refused at extract with a warning, and the whole line
with it: a partial set would read as complete. The technique then reads
as unknown.

A technique that is a way into a handler rather than an effect claims
the unit as `shares`: `stable_raster_irq` and `double_irq` say
`vic_raster_irq (shares)`, because the effect run from the handler owns
the one raster compare. Where the page says an effect is built on such a
technique, state it on the **Requires:** line too: the check does not set
a technique against its own prerequisite as a rival owner.

The VIC display fields (`vic_yscroll`, `vic_xscroll`, `vic_matrix_base`,
`vic_char_base`) follow the same rule. The technique that sets a field for
the frame owns it (`soft_scroll_v`, `fld_flexible_line_distance`,
`fli_image`). One that rewrites it only on its own lines and restores it
shares it (`scroll_panel_split`, `sideborder_open`). The other mode bits
of `$D011`, `$D016` and `$D018` (DEN, RSEL, CSEL, BMM, ECM, MCM) are not
units yet.

A technique claims what every implementation needs. What one recipe
chooses (which vector, which zero-page bytes) is the recipe's claim, not
the technique's. A measurement harness is not a claim: the CIA timers a
recipe chains to time its routine, and the counters it keeps for the
screenshot, are left off the line even though they appear in the
listing.

An optional `**Uses kernal:**` line lists KERNAL routines:

```
**Uses kernal:** CHROUT, CHKOUT
```

Same comma rules; one `USES` edge per routine.

## Section structure inside a Technique

After the H2 + metadata lines, free-form prose covering:

1. **Why**: the problem this technique solves
2. **How**: the algorithm, conceptually (asm-language-agnostic)
3. **Why it works**: chip-level explanation (which register reads/writes drive the effect)
4. **Variations**: 1-3 common variants
5. **Cycle budget**: for raster-critical techniques, the per-line cycle accounting in prose; the `**Cost:**` line above carries the summable figures
6. **Recipes**: bullet list of `recipes/<toolchain>/<name>.md` files that implement this

H3 inside a Technique is OK for sub-sections; the extractor only consumes H2 + the
metadata lines and ignores deeper structure.
