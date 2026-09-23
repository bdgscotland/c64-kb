# c64-kb Graph Ontology

## Overview

The FalkorDB knowledge graph models C64 hardware (chips, registers,
memory regions), demo and game techniques, toolchains, pitfalls, and
crash/failure patterns. Designed to support multi-hop queries like
"what techniques use the copper-equivalent stable raster IRQ?" or "what
registers does this effect touch?" or "is FLI compatible with sprite-
multiplex-24 in PAL?"

`ensureSchema()` creates the indexes, constraints and the `Chip`, `Region`
and `HardwareUnit` seed nodes; every other node and edge comes from ingesting `docs/`.

Design principles:
- 5–12 node types, 8–20 edge types (maintainable range for a domain KB)
- Node vs property test: "do you traverse through it?" If yes, node.
- Single general type with `category` property (one `Technique` with
  category, not separate `CopperTechnique`/`SpriteTechnique` labels).
- Edge names: verb-based SCREAMING_SNAKE reading as sentences.

## Node Types (14)

### KernalRoutine

A KERNAL ROM jump-table entry ($FF81-$FFF3). An earlier version of this
line said $FFC0+; the table starts at $FF81 (CINT).

| Property | Type | Description |
|----------|------|-------------|
| name | string | Routine name (e.g. "CHROUT") |
| address | string | Hex jump-table address (e.g. "$FFD2") |
| input_regs | string | Calling convention (e.g. "A=byte to print") |
| output_regs | string | Return values (e.g. "C=error flag") |
| description | string | One-line summary |

Source: `hardware/kernal-routines-reference.md` (Phase 1).

### Register

A C64 hardware register at $D000–$DFFF.

| Property | Type | Description |
|----------|------|-------------|
| name | string | Register name (e.g. "D011", "BORDER") |
| address | string | Hex address (e.g. "$D011") |
| chip | string | Owning chip ("VIC-II", "SID", "CIA1", "CIA2") |
| rw | string | Access type: "R", "W", or "RW" |
| bit_width | integer | 8 in nearly all cases |
| default_value | string | Power-on default |
| side_effects | string | Strobe / write-only / read-clears semantics |

Source: `hardware/c64-registers-reference.md` (Phase 1).

### MemoryRegion

An address-space zone (zero page, screen RAM, BASIC RAM, I/O, KERNAL ROM,
etc.).

| Property | Type | Description |
|----------|------|-------------|
| name | string | Zone name (e.g. "Zero page", "Screen RAM") |
| start | string | Start address (e.g. "$0400") |
| end | string | End address (e.g. "$07FF") |
| default_use | string | What lives here by default |
| can_be_bank_switched | boolean | Whether $01 affects it |

Source: `hardware/c64-memory-map.md` (Phase 1).

### Chip

A C64 silicon component. Static nodes seeded in `ensureSchema()`.

| Property | Type | Description |
|----------|------|-------------|
| name | string | One of: "VIC-II", "SID", "CIA1", "CIA2", "6510" |
| variants | string | Known revisions / models |
| role | string | Functional role |

**Hardcoded seed (5 nodes):**
- VIC-II (variants: 6569 PAL / 6567 NTSC)
- SID (variants: 6581 / 8580)
- CIA1 (6526) — keyboard, joystick port 2, timer-A IRQ
- CIA2 (6526) — VIC bank select, RS-232, timer-B NMI
- 6510 — CPU with I/O port at $00/$01

### Region

A C64 video region. Static nodes seeded in `ensureSchema()`.

| Property | Type | Description |
|----------|------|-------------|
| name | string | "PAL" or "NTSC" |
| refresh_hz | integer | 50 (PAL) or 60 (NTSC) |
| lines_per_frame | integer | 312 (PAL) or 263 (NTSC) |
| cycles_per_line | integer | 63 (PAL) or 65 (NTSC) |

**Hardcoded seed (2 nodes):** PAL, NTSC.

### Technique

A demo/game programming technique (raster IRQ, sprite multiplexer, FLI,
soft scroll, plasma, hard-restart, illegal-opcode trick, etc.).

| Property | Type | Description |
|----------|------|-------------|
| name | string | Snake_case name (e.g. "stable_raster_irq") |
| category | string | One of: raster, sprite, scroll, bitmap, effect, music, cpu, banking, loader, render, input, logic, maths, text, io. Enforced at extract (schema 20): a technique doc outside the set is refused with a warning. `render` had been in use since the text-mode page without being listed; input, logic, maths, text and io were added for game and application foundations (issue #17). |
| complexity | string | "low", "medium", "high", "scene-tier" |
| cost_cycles_per_line | integer, optional | CPU cycles the technique takes on each raster line it is active on. From the page's `**Cost:**` line (schema 22). |
| cost_cycles_per_frame | integer, optional | CPU cycles the technique takes per frame, a PAL frame of 19,656 unless the page says otherwise. The worst frame, not an average. For a routine called on demand, one call per frame; a routine the page places outside the frame loop has no value here. |
| cost_lines_active | integer, optional | Raster lines per frame on which the technique runs code. |
| cost_bytes_code | integer, optional | Bytes of code in the built recipe's segments. When the page states only a PRG size, that size less the two-byte load address. |
| cost_bytes_data | integer, optional | Bytes of tables, buffers and other data in the built recipe's segments. |
| cost_zp_bytes | integer, optional | Zero-page bytes the technique claims. |
| cost_irq_slots | integer, optional | Raster or timer interrupts the technique needs per frame. |
| cost_sprites_per_line | integer, optional | The most hardware sprites displayed on one raster line of the technique's lines, 0-8 (schema 24). `c64_timing_budget` subtracts their DMA (3 + 2 per sprite, measured) from the line's user cycles. |
| cost_cycles_per_frame_typical | integer, optional | A measured typical frame beside a worst-frame cost_cycles_per_frame, never above it (schema 27). `c64_plan_budget` sums it for the low end of its range. |
| cost_recipe | string, optional | The recipe the cost figures were measured on or counted from, from `**Cost measured on:**` (schema 27). A property, not an edge; ingest warns when it names no Recipe. |
| cost_conditions | string, optional | The parenthetical after the recipe on that line: "screen blanked", "whole PRG", "one call" and the like (schema 27). `c64_plan_budget` reads "blank" (no badline stalls inside the figure) and "whole PRG" (bytes not summed). |
| cost_includes | string[], optional | Techniques whose per-frame work is inside this technique's figure, from `**Cost includes:**` (schema 27). Authored, never inferred; ingest warns when a name is no Technique. A budget that lists both counts the included one once. |
| cost_basis | string, optional | How the cost figures were obtained, one of "measured-vice", "derived-listing", "arithmetic", "estimated"; present exactly when any cost_* property is. The word is the weakest that applies to any figure on the line. |
| raster_band | string, optional | The raster lines the technique holds the CPU on, from the page's `**Raster band:**` line (schema 24), in canonical form: sorted inclusive ranges such as "45-250" or "0-44,251-311", or "movable" when the program chooses the lines. Absent when the page states none; a re-ingest that drops the line clears it. `c64_check_compatibility` clears its line-sharing rules for two techniques whose line bands share no line. |
| claims_stated | string, optional | "stated" when the page's `**Claims:**` line names units, "none" when it says `none` (schema 25). Absent means unknown: the page states nothing, which is not the same as "none". The CLAIMS edges carry the units. |
| claims_basis | string, optional | How the claims were established: "measured-vice", "derived-listing" or "estimated"; present exactly when claims_stated is. |

A technique whose page has no `**Cost:**` line has none of the `cost_*`
properties, so `WHERE t.cost_cycles_per_frame IS NOT NULL` finds the
costed ones; a re-ingest that drops the line clears them. `c64_plan_budget`
and the briefing tools add a set up by the rules in `src/domain/budget.ts`
(schema 27): a member with no cycles figure is unknown, not zero; a
figure above one frame is not summed; included work and a band's
prerequisites are not counted twice. An earlier version summed every
`cost_cycles_per_frame` and called the result a floor.

Source: `techniques/*.md` (Phase 3+).

### Pitfall

A known gotcha or non-obvious behavior.

| Property | Type | Description |
|----------|------|-------------|
| title | string | Short description |
| severity | string | "critical", "high", "medium", "low" |
| region_specific | string | "pal", "ntsc", "both" |

Source: `pitfalls/*.md` (one Pitfall per H2; the file an earlier version of this line named, `c64-pitfalls.md`, does not exist).

### CrashPattern

A symptom-keyed failure record (no Guru codes on C64 — failures are
visual or behavioral).

| Property | Type | Description |
|----------|------|-------------|
| symptom | string | Visible/audible symptom (e.g. "black screen", "wrong music tempo") |
| likely_causes | string | JSON-encoded list of causes |
| diagnosis_steps | string | How to localize the issue |

Source: `c64-failure-patterns.md` (Phase 5).

### Tool

A development tool (assembler, compiler, emulator, art editor, music
editor, debugger, packer).

| Property | Type | Description |
|----------|------|-------------|
| name | string | Tool name (e.g. "oscar64", "kickassembler") |
| kind | string | The page's `tool_kind`: c-compiler, c-library, assembler, linker, emulator, debug-bridge, unit-test, reference-catalog, asset-converter |
| maintainer | string | Maintainer, or "" |
| license | string | Licence, or "" |
| home_url | string | Project home page |
| version_verified | string, optional | The version this repo's gates ran with, as the tool reports it (schema 24), e.g. "5.25" for KickAssembler. Absent when the page states none. `c64_recipe_lookup` returns it as `toolchain_version_verified`. |

An earlier version of this table listed a single `category` property with
art, music, debug, test and packer values; the extractor has always
written `kind` from `tool_kind`, with the values above.

Source: toolchain reference docs (Phase 2).

### Recipe

A buildable code recipe. The same demo concept can have multiple Recipe
nodes — one per toolchain.

| Property | Type | Description |
|----------|------|-------------|
| name | string | Recipe identifier |
| source_doc | string | Path of the markdown source |
| toolchain | string | One of: "oscar64", "kickassembler", "cc65" |
| output_format | string | One of: "prg", "crt", "d64", "bin" |
| region | string | "pal", "ntsc", or "both" |

Source: `recipes/<toolchain>/*.md` (Phase 2+).

### FileFormat

A C64 file format.

| Property | Type | Description |
|----------|------|-------------|
| name | string | "PRG", "D64", "T64", "CRT", "SID", "Koala", "IFFL", "CTM", "SPD", "SNG" |
| extension | string | Conventional file extension |
| description | string | One-line summary |

Source: `c64-file-formats.md` (Phase 2).

### Resource

A machine-level resource a technique needs while it is active: every CPU
cycle on its lines, a constant sprite set, a badline-free region, the KERNAL
banked out, the drive's serial bus. One node per word of the fixed
`**Demands:**` vocabulary in `CONVENTIONS-techniques.md`; created on first
reference.

| Property | Type | Description |
|----------|------|-------------|
| name | string | Vocabulary word (e.g. "cpu_every_line") |
| description | string | One-line meaning |

Source: `techniques/*.md` `**Demands:**` lines.

### HardwareUnit

A named piece of hardware that one technique can hold while another wants
it: a SID voice, a sprite, a CIA timer, the raster compare, an interrupt
vector, zero page (schema 25). Seeded by `ensureSchema()` from
`HARDWARE_UNITS` in `src/graph/extract.ts`, like Chip and Region, so a
`**Claims:**` line can only name a unit that exists. It answers a
different question from Resource: a Resource is a kind of machine time
("every CPU cycle on its lines"), a HardwareUnit is a register set.

| Property | Type | Description |
|----------|------|-------------|
| name | string | Seed name (e.g. "sid_voice_2", "vic_raster_irq") |
| kind | string | sid_voice, sid_shared, sprite, timer, tod, port, bus, irq_source, vector, io_page or zero_page |
| addresses | string | The registers or bytes (e.g. "$D407-$D40D") |
| chip | string | Owning chip, "" for the expansion I/O pages; also a BELONGS_TO edge |

The seed: `sid_voice_1`-`3` ($D400-$D406, $D407-$D40D, $D40E-$D414),
`sid_filter_volume` ($D415-$D418), `sid_voice_3_readback` ($D41B-$D41C),
`sid_pots` ($D419-$D41A), `sprite_0`-`7` (position, colour, enable and
other bits, pointer), `cia1_timer_a`/`b`, `cia2_timer_a`/`b`,
`cia1_tod`, `cia2_tod`, `cia1_port_a` ($DC00: keyboard column drive,
control port 2), `cia1_port_b` ($DC01: keyboard rows, control port 1),
`cia2_vic_bank` ($DD00 bits 0-1), `serial_bus` ($DD00 bits 3-7 and the
drive), `user_port` ($DD01), `vic_raster_irq` (the one raster compare:
$D012, $D011 bit 7, $D019/$D01A bit 0), `irq_vector_0314`,
`irq_vector_fffe`, `nmi_vector_0318`, `nmi_vector_fffa`,
`expansion_io1` ($DE00-$DEFF), `expansion_io2` ($DF00-$DFFF), and
`zero_page` ($02-$FF), one unit whose bytes ride the CLAIMS and
CLOBBERS_ZP edges.

### Archetype

A shape a game or demo takes: the vertical shooter, the single-screen
platformer, the text adventure. Traversed through, not read as a
property: `c64_game_briefing` walks Archetype to its techniques and
pitfalls, which is why it is a node and not a keyword table in the tool.

| Property | Type | Description |
|----------|------|-------------|
| name | string | snake_case canonical name, from the `**Archetype:**` line (e.g. "vertical_shmup") |
| title | string | The H2 text (e.g. "Vertical Shmup") |
| kind | string | "game" or "demo", from file frontmatter; defaults to game |
| source_doc | string | Path of the page that defines it |

Source: `game-design/c64-game-archetypes.md` and, for kind `demo`,
`demo-design/intro-cracktro-patterns.md` (one Archetype per H2 that
carries an `**Archetype:**` line; `CONVENTIONS-archetypes.md`). Before
schema 21 the briefing tool held four archetype keywords and two forced
techniques in code and the page's fingerprints were read by nobody.

## Edge Types (22)

### BELONGS_TO

Direction: `Register → Chip`, `Technique → Chip`, `HardwareUnit → Chip`

Meaning: "this register lives on this chip."

Example: `($D011)-[:BELONGS_TO]->(VIC-II)`

### USES

Direction: `Technique → Register/KernalRoutine`, `Recipe → Register/KernalRoutine`

Meaning: "this technique or recipe touches this register or routine."

### IMPLEMENTS

Direction: `Recipe → Technique`

Meaning: "this recipe demonstrates this technique."

### BUILDS_ON

Direction: `Recipe → Recipe`

Meaning: "this recipe depends on a prior recipe — learn that first."

Listed since the ontology was drafted, but no extractor emits it and no
tool reads it (checked 2026-09-22: `BUILDS_ON` occurs nowhere in `src/`
or `test/`). The prerequisite relation the docs actually state is between
techniques, and that is `REQUIRES` below.

### REQUIRES

Direction: `Technique → Technique`

Meaning: "this technique presupposes that one is already set up or running
underneath it" — `text_zoom` REQUIRES `stable_raster_irq` (an IRQ on every
scanline of its zone), `infinite_scroll_h` REQUIRES `soft_scroll_h` and
`char_scroll_buffer_h`, `sid_filter_routing` REQUIRES `sid_voice_setup`.
Authored per technique with a `**Requires:**` line
(`CONVENTIONS-techniques.md`). It is not "see also" and not "variant of":
`double_irq` is a variant of `stable_raster_irq`, not a prerequisite, and
neither carries the edge. Both ends are MATCHed at ingest, never MERGEd,
so a misspelt name drops the edge with a warning instead of creating a
stub; an edge that would close a cycle is refused. Read by
`c64_technique_lookup` (`requires`, `required_by`), `c64_techniques_for`
(`requires` filter, following the chain) and `c64_check_compatibility`,
which takes each input's REQUIRES closure and runs the hard DEMANDS rules
between one technique's prerequisites and the other technique, reporting a
hit as `prerequisite_conflict` — never against a prerequisite the technique
declared itself, and never by folding a prerequisite's demands into its
dependant's.

### TRIGGERED_BY

Direction: `Pitfall → Register/KernalRoutine/Technique`

Meaning: "this pitfall is provoked when using this thing." For a Technique
target this is the technique in whose code the pitfall arises; the
technique that cures it is `MITIGATED_BY`, which the single vocabulary used
to carry as well (`sprite_dma_overflow` was TRIGGERED_BY
`sprite_multiplex_8` while its Fix said the multiplexer is the fix).

### MITIGATED_BY

Direction: `Pitfall → Technique`

Meaning: "applying this technique is the Fix section's remedy for this
pitfall" — `raster_irq_first_line_jitter` MITIGATED_BY `double_irq`, the
three region-timing pitfalls MITIGATED_BY `pal_ntsc_detection`. Authored
with a `**Mitigated by techniques:**` line (`CONVENTIONS-pitfalls.md`);
Technique targets only, both ends MATCHed, misses warned about and counted
beside triggered_by. A technique may be on both lines only when the pitfall
arises in a naive version of it and a correct version cures it, and the
Mechanism says so. Where the remedy is not a Technique node (the SID hard
restart, a `$0318` handler) there is no edge and the Fix stays prose. Read
by `c64_pitfalls_for` (a Technique topic matches either relation;
`mitigated_by[]` is reported apart from `triggered_by[]`) and
`c64_technique_lookup` (`mitigates`).

### CAUSED_BY

Direction: `CrashPattern → Register/KernalRoutine/Technique`

Meaning: "this failure pattern is caused by misuse of this thing."

### REQUIRES_TOOL

Direction: `Recipe → Tool`

Meaning: "this recipe needs this tool to build."

Source: every recipe's frontmatter `toolchain` names a Tool node
(`oscar64`, `kickassembler`, `cc65`) and the ingester links the recipe to
it. Until data 713 that link was written as `USES`, so this edge type was
defined and populated by nothing while the same fact sat under the wrong
label; the ingester now writes `REQUIRES_TOOL` and a query for
`(:Recipe)-[:REQUIRES_TOOL]->(:Tool)` returns every recipe.

### REQUIRES_REGION

Direction: `Technique → Region`

Meaning: "this technique requires PAL or NTSC specifically."

### PRODUCES

Direction: `Tool → FileFormat`

Meaning: "this tool produces this file format."

### CONSUMES

Direction: `Tool → FileFormat`

Meaning: "this tool reads/converts this file format."

### TARGETS

Direction: `Tool → Chip`

Meaning: "this tool targets this chip (e.g. GoatTracker targets SID)."

### PAIRS_WITH

Direction: `KernalRoutine → KernalRoutine`

Meaning: "if you call A you also need B" (e.g. SETLFS + SETNAM + LOAD).

### DEMANDS

Direction: `Technique → Resource`

Meaning: "while this technique is active it needs this machine-level
resource" — every CPU cycle on its lines, a constant sprite set, a
badline-free region, the KERNAL banked out, and so on. Authored per
technique with a `**Demands:**` line from the fixed vocabulary in
`CONVENTIONS-techniques.md`. `c64_check_compatibility` derives its hard
conflicts from these: two `cpu_every_line` techniques cannot share a raster
line; `cpu_every_line` against `midframe_raster_irqs` or
`continuous_interrupts` cannot either; `constant_sprite_set` against
`changes_sprite_set`; `kernal_rom_out` against any technique that USES a
KernalRoutine; `serial_bus_exclusive` (schema 24, a resident drive-code
loader) against any technique that USES a KERNAL serial or file routine
(`serial_bus_busy`). The rules about sharing lines are cleared, and the pair is
listed as band-separated, when both techniques carry a `raster_band` of
line ranges and the ranges share no line. Before schema 24 there was no
band, and any two `cpu_every_line` techniques were reported as a conflict.

### CLAIMS

Direction: `Technique → HardwareUnit`

Meaning: "while this technique runs it holds this unit, in this mode"
(schema 25). Authored with the `**Claims:**` and `**Claims basis:**`
lines (`CONVENTIONS-techniques.md`). Both ends MATCHed, never MERGEd; a
miss is warned about and counted in the ingest summary as `claims …
dropped`. Re-ingesting a technique drops its old CLAIMS edges first, so a
claim the page stopped making does not outlive it.

| Property | Type | Description |
|----------|------|-------------|
| mode | string | owns (writes or holds it every frame; nobody else may), shares (writes it under the owner's protocol: after the owner in the frame, or in the owner's interrupt chain), reads (reads only), init (uses it once before the frame loop) |
| ranges | string or null | zero_page only: canonical bytes, e.g. "02-0D,24-2F" |
| relocatable | boolean | zero_page only: the bytes move with a build option |
| basis | string | measured-vice, derived-listing or estimated |

`c64_check_compatibility` reads them: two `owns` of one unit is
`unit_contention` (hard); two `owns` of zero page that share bytes is
`zero_page_overlap` (hard, soft when either side is relocatable);
`owns` against `shares`, or two `shares`, is `unit_shared` (soft);
`owns` against `reads` is `unit_read_while_driven` (soft); `init`
against `owns` or `shares` is `init_order` (info). Between a technique
and its own REQUIRES prerequisite the two ownership rules do not run, and
`unit_shared` runs only when the sharer is the one that requires the
owner (`sfx_engine_beside_music` requires the player it writes after;
`fli_image` runs the stable raster IRQ it requires inside its own
handler). Through the REQUIRES closure, a prerequisite's claims on units
its input technique holds are the input's, and the input's own pair
reports them; the hit that remains carries the rule in `underlying_kind`.
A technique with no Claims line is reported as unknown, never as
claiming nothing.
`c64_techniques_for` filters on a claimed unit.

### CLOBBERS_ZP

Direction: `KernalRoutine → HardwareUnit` (always `zero_page`)

Meaning: "calling this routine may write, or did write, these zero-page
bytes" (schema 26). One edge per `**Clobbers zero page:**` line under the
routine's H3 in `hardware/kernal-routines-reference.md`
(`CONVENTIONS-hardware-reference.md`). Both ends MATCHed; a miss is
counted in the ingest summary as `clobbers_zp … dropped`. Re-ingesting
the routine drops its old CLOBBERS_ZP edges first.

| Property | Type | Description |
|----------|------|-------------|
| ranges | string | canonical bytes $00-$FF, e.g. "90-9A,B7"; "" for none. $00-$01 (the 6510 port) can appear; no Claims line can name them |
| bound | string | may: a static walk of the ROM, an upper bound, written and checked by `scripts/kernal-zp-walk.ts`. must: what one call wrote in a VICE store trace (`scripts/kernal-zp-trace.ts`), a lower bound for that call |
| basis | string | where the set came from: "ROM walk from $FFD2, power-on vectors", or "VICE x64sc store trace, <the call>". A routine has one may edge and a must edge per traced call |

`c64_check_compatibility` reads the may edges: a technique that USES a
KernalRoutine beside a technique whose CLAIMS on `zero_page` share bytes
with that routine's may set is `kernal_clobbers_zp` (soft; "may", since
a given call need not reach every store the walk counts). Unlike the
unit rules it also runs inside one input's own chain, the technique
against itself and against its own prerequisites (`a` = `b` = the
input), since a KERNAL call clobbers the bytes whoever declared them.
`npm test`
fails when the page and the ROM walk disagree, or a must byte lies
outside the may set.

### IN_REGION

Direction: `Register → MemoryRegion`, `KernalRoutine → MemoryRegion`

Meaning: "this address lies inside this memory-map region." Derived from
the numeric addresses after ingest; before this edge existed the 220
MemoryRegion nodes were all orphans.

### OCCUPIES

Direction: `Recipe → MemoryRegion`

Meaning: "this recipe loads code or data into this region." Derived from
the listing's own load addresses (`* = $0900`, `#pragma region(...)`,
`.org`), not from prose.

### FEATURES

Direction: `Archetype → Technique`

Meaning: "a game of this shape is built on this technique" —
`vertical_shmup` FEATURES `sprite_multiplex_24`, `text_adventure` FEATURES
`ram_under_kernal`. Authored with the `**Technique fingerprint:**` line
(`CONVENTIONS-archetypes.md`); both ends MATCHed, a name that matches no
Technique is warned about and counted in the ingest summary as
`archetype_features … dropped`. Read by `c64_game_briefing`, which forces
every target into the proposal for that archetype, exempt from the
per-category cap.

### RISKS

Direction: `Archetype → Pitfall`

Meaning: "a game of this shape commonly meets this pitfall" —
`racing` RISKS `raster_line_count_difference`, `top_down_adventure` RISKS
`vic_bank_visibility_collision`. Authored with the `**Common pitfalls:**`
line; same MATCH-both discipline, misses counted as `archetype_risks …
dropped`. Read by `c64_game_briefing`, which adds each target to the
plan's pitfalls when no proposed technique already surfaced it. It is a
statement about the genre, not a trigger: TRIGGERED_BY still says which
technique's code the pitfall arises in.

### SCAFFOLDS

Direction: `Recipe → Archetype`

Meaning: "this recipe is a complete starting point for a game of this
shape; copy it and change it, do not start from a blank file" —
`oscar64-simple-shmup` SCAFFOLDS `vertical_shmup`. Authored with the
`scaffolds:` key in the recipe's frontmatter (`CONVENTIONS-recipes.md`),
an array of Archetype names. Both ends MATCHed, never MERGEd: a name that
matches no Archetype is warned about and counted in the ingest summary as
`scaffolds … dropped`. Read by `c64_game_briefing`, whose first build
step for a resolved archetype lists the recipes that SCAFFOLD it and
names their pages (schema 23; before it the tool matched the string
"shmup" against the archetype name and offered one recipe by name).

---

## Schema state

`ensureSchema()` creates a range index and a unique constraint on the
primary key of every node label (14) and seeds:
- 5 `Chip` nodes (VIC-II, SID, CIA1, CIA2, 6510)
- 2 `Region` nodes (PAL, NTSC)
- the `HardwareUnit` nodes listed under HardwareUnit, each BELONGS_TO its chip

Everything else is produced by `npm run ingest` from `docs/`. Of the
edge types defined here, one is populated by nothing: `BUILDS_ON`, which
no page asserts and no tool reads (its fate is issue #17). `REQUIRES_TOOL`
was in that state until data 713, when the recipe-to-tool link the
ingester had been writing as `USES` was given its ontology name.
`npx c64-kb health` prints the live node and edge figures; they are not
repeated here because they change with every docs commit.
