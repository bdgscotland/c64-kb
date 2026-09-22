# c64-kb Graph Ontology

## Overview

The FalkorDB knowledge graph models C64 hardware (chips, registers,
memory regions), demo and game techniques, toolchains, pitfalls, and
crash/failure patterns. Designed to support multi-hop queries like
"what techniques use the copper-equivalent stable raster IRQ?" or "what
registers does this effect touch?" or "is FLI compatible with sprite-
multiplex-24 in PAL?"

`ensureSchema()` creates the indexes, constraints and the `Chip`/`Region`
seed nodes; every other node and edge comes from ingesting `docs/`.

Design principles:
- 5–12 node types, 8–20 edge types (maintainable range for a domain KB)
- Node vs property test: "do you traverse through it?" If yes, node.
- Single general type with `category` property (one `Technique` with
  category, not separate `CopperTechnique`/`SpriteTechnique` labels).
- Edge names: verb-based SCREAMING_SNAKE reading as sentences.

## Node Types (12)

### KernalRoutine

A KERNAL ROM jump-table entry ($FFC0+).

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
| category | string | One of: raster, sprite, scroll, bitmap, effect, music, cpu, banking, loader |
| complexity | string | "low", "medium", "high", "scene-tier" |

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
| category | string | One of: assembler, compiler, emulator, art, music, debug, test, packer |

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
banked out. Seven nodes, one per word of the fixed `**Demands:**` vocabulary
in `CONVENTIONS-techniques.md`; created on first reference.

| Property | Type | Description |
|----------|------|-------------|
| name | string | Vocabulary word (e.g. "cpu_every_line") |
| description | string | One-line meaning |

Source: `techniques/*.md` `**Demands:**` lines.

## Edge Types (17)

### BELONGS_TO

Direction: `Register → Chip`

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
KernalRoutine.

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

---

## Schema state

`ensureSchema()` creates a range index and a unique constraint on the
primary key of every node label (12) and seeds:
- 5 `Chip` nodes (VIC-II, SID, CIA1, CIA2, 6510)
- 2 `Region` nodes (PAL, NTSC)

Everything else is produced by `npm run ingest` from `docs/`. At the
commit that last touched this file a clean ingest under schema 19 gave
574 nodes and 1,294 edges, with 15 of the 17 edge types populated —
`BUILDS_ON` and `REQUIRES_TOOL` are defined here and emitted by nothing.
`npx c64-kb health` prints the live figures.
