# Hardware Reference Conventions

Hardware reference docs in `docs/` follow these patterns so
the entity extractor in `src/graph/extract.ts` can parse them. A doc that
deviates breaks the graph build.

## File-level frontmatter (optional)

```yaml
---
chip: VIC-II   # for chip refs only
region: PAL    # for region-specific docs only
---
```

## Section structure

Top of file: `# Doc Title` (H1). One H1 per doc.

Then, in order: an "Overview" section (H2) saying what the doc covers; a
"Quick reference" section (H2) with tables; detail sections (H2 per topic,
H3 per item); a "Pitfalls" cross-reference section (H2) at the end.

## Register definitions

Every register gets an H3 in this exact format:

```
### $D011 — D011 — Screen Control Register 1 (RW)
```

Breakdown:
- `### ` (H3) at start of line
- ` $D011 ` — hex address, dollar-prefix, 4 hex digits, surrounded by spaces
- ` — ` — em-dash separator (Unicode U+2014)
- `D011` — canonical register name (no spaces; uppercase letters + digits)
- ` — ` — em-dash separator
- `Screen Control Register 1` — description (free-form)
- ` (` — opening paren
- `RW` — one of `R`, `W`, or `RW`
- `)` — closing paren

Following each register H3 block, an optional `**Chip:** VIC-II` line
identifies the owning chip. If absent, the extractor falls back to the
doc's frontmatter `chip` field.

Bit definitions use a sub-H4 or a table. Example:

```
### $D011 — D011 — Screen Control Register 1 (RW)

**Chip:** VIC-II

| Bit | Name | Description |
|-----|------|-------------|
| 7   | RST8 | Bit 8 of raster line |
| 6   | ECM  | Extended color mode |
| 5   | BMM  | Bitmap mode |
```

## KERNAL routine definitions

Every KERNAL routine gets an H3 in this exact format:

```
### $FFD2 — CHROUT — Output a character
```

Breakdown:
- `### ` (H3) at start of line
- ` $FFD2 ` — hex address (jump-table entry), 4 hex digits
- ` — ` — em-dash separator
- `CHROUT` — canonical routine name (uppercase letters)
- ` — ` — em-dash separator
- description

Following each routine H3, optional structured fields:

```
**Input:** A = byte to print
**Output:** None
**Affects:** A
**Pairs with:** CHROUT
**Description:** ...
```

The `**Pairs with:**` marker is what `PAIRS_WITH` graph edges are extracted from.
Multiple pair names are comma-separated.

After `**Affects:**`, one or more `**Clobbers zero page:**` lines (schema
26) state the zero-page bytes the routine writes. Each becomes a
`CLOBBERS_ZP` edge to the `zero_page` HardwareUnit:

```
**Clobbers zero page:** $B8-$BA (may; ROM walk from $FFBA, power-on vectors)
**Clobbers zero page:** $B8-$BA (must; VICE x64sc store trace, SETLFS 2,8,2)
```

- The value is `<bytes> (<bound>; <basis>)`. Bytes are `$XX` or
  `$XX-$YY`, comma-separated, anywhere in `$00-$FF`, or `none`.
- `may` lines are not hand-written. `node scripts/kernal-zp-walk.ts
  --write` sets one per routine from a static walk of the 901227-03 ROM;
  `npm test` runs its `--check` and fails on any difference.
- `must` lines come from `node scripts/kernal-zp-trace.ts --write`, which
  runs `scripts/kernal-zp-trace.asm` in VICE with a store trace. The basis
  names the traced call. Every must byte has to lie inside the may set.
- A line that does not parse is warned about at ingest and dropped.

## Memory region definitions

Every memory region gets an H3 in this exact format:

```
### $0400-$07FF — Default Screen RAM
```

Breakdown:
- `### ` (H3) at start of line
- ` $START-$END ` — start/end hex addresses, 4 hex digits each, separated by `-`
- ` — ` — em-dash separator
- description

Following each H3, optional structured fields:

```
**Default use:** Screen character codes (40x25 = 1000 bytes)
**Bank-switchable:** No
**Notes:** ...
```

## Opcode definitions (for 6510-cpu-reference.md and 6502-illegal-opcodes.md)

Every opcode gets an H3 in this exact format:

```
### $A9 — LDA #imm — Load Accumulator immediate
```

Breakdown:
- `### ` (H3) at start of line
- ` $A9 ` — opcode byte, 2 hex digits
- ` — ` — em-dash separator
- `LDA #imm` — mnemonic with addressing mode
- ` — ` — em-dash separator
- description

Following each opcode H3:

```
**Cycles:** 2
**Flags:** N Z
**Legal:** yes      (or "no" for illegal opcodes — defaults to yes if absent)
**Page-cross:** +1  (or absent if no page-cross penalty)
```

## Pitfalls cross-reference

End-of-doc H2 `## Pitfalls` with bullet list:

```
## Pitfalls

- **$D012 raster wrap**: comparing $D012 against >=256 requires combining
  with $D011 bit 7 — see `d012_wrap_around` in
  [pitfalls/raster-and-badline.md](pitfalls/raster-and-badline.md).
- ...
```

## Cross-references between docs

Use relative markdown links: `[VIC-II screen mode](vic-ii-reference.md#screen-modes)`.

## File-end checklist

Every hardware reference doc must end with this comment, which marks it
as a hardware-reference doc for the extractor:

```
<!-- doc-type: hardware-reference -->
```
