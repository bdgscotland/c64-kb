# c64-kb Graph Ontology

## Overview

The FalkorDB knowledge graph models C64 hardware (chips, registers,
memory regions), demo and game techniques, toolchains, pitfalls, and
crash/failure patterns. Designed to support multi-hop queries like
"what techniques use the copper-equivalent stable raster IRQ?" or "what
registers does this effect touch?" or "is FLI compatible with sprite-
multiplex-24 in PAL?"

Phase 0 ships only the schema + seed nodes. Other node types and edges
populate as later phases hydrate the corresponding markdown sources.

Design principles (mirrored from amiga-kb DDR-002):
- 5–12 node types, 8–20 edge types (maintainable range for a domain KB)
- Node vs property test: "do you traverse through it?" If yes, node.
- Single general type with `category` property (one `Technique` with
  category, not separate `CopperTechnique`/`SpriteTechnique` labels).
- Edge names: verb-based SCREAMING_SNAKE reading as sentences.

## Node Types (11)

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

Source: `c64-pitfalls.md` (Phase 5).

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

## Edge Types (12)

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

### TRIGGERED_BY

Direction: `Pitfall → Register/KernalRoutine/Technique`

Meaning: "this pitfall is provoked when using this thing."

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

---

## Phase 0 Schema State

`ensureSchema()` creates range indexes for all 11 node types and seeds:
- 5 `Chip` nodes (VIC-II, SID, CIA1, CIA2, 6510)
- 2 `Region` nodes (PAL, NTSC)

Total: 7 nodes, 0 edges. All other nodes and edges populate as Phases
1–6 hydrate the corresponding markdown sources.
