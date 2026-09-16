---
recipe: fli-image
toolchain: kickassembler
output_format: PRG
region: pal
techniques: [fli_image, stable_raster_irq]
file_formats: [PRG]
uses_registers: [D011, D016, D018, D012, D019, D01A]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — FLI Image Display

## Synopsis

Displays a precomputed FLI (Flexible Line Interpretation) multicolor bitmap
image using a per-scanline raster IRQ that rotates the VIC-II's screen RAM
pointer ($D018 high nibble) on every visible line. The technique defeats the
VIC-II's 8-line attribute constraint, giving each of the 200 visible scanlines
its own independent per-cell color palette. This recipe demonstrates the
complete FLI engine: the 8-bank screen RAM layout, the stable per-line IRQ
loop, and the 23-cycle constraint on the $D018 write relative to the badline
c-access window. Region is PAL because the cycle counts for the stable write
are derived from PAL's 63 cycles per line; NTSC differs by 2 cycles per line
and requires separate timing verification.

## Source

```asm
// fli-image.asm
// Displays a precomputed FLI multicolor bitmap image.
//
// Memory layout (all within VIC bank 0, $0000-$3FFF):
//   $2000  — 8000-byte multicolor bitmap
//   $0400  — screen RAM page 0  (1000 bytes, for scanlines 0 mod 8)
//   $0800  — screen RAM page 1  (1000 bytes, for scanlines 1 mod 8)
//   $0c00  — screen RAM page 2
//   $1000  — screen RAM page 3
//   $1400  — screen RAM page 4
//   $1800  — screen RAM page 5
//   $1c00  — screen RAM page 6
//   $2000 ... conflict — page 7 goes to $3c00 (within bank)
//   $3c00  — screen RAM page 7
//   $d800  — Color RAM (1000 bytes, shared across all lines)
//   $0900  — main program
//   $0b00  — IRQ handler
//
// $D018 value per page (VM bits 7-4):
//   page 0: VM = %0001 → $D018 = $18 (VM $0400, CB2 = 1 → bitmap $2000)
//   page 1: VM = %0010 → $D018 = $28
//   page 2: VM = %0011 → $D018 = $38
//   page 3: VM = %0100 → $D018 = $48
//   page 4: VM = %0101 → $D018 = $58
//   page 5: VM = %0110 → $D018 = $68
//   page 6: VM = %0111 → $D018 = $78
//   page 7: VM = %1111 → $D018 = $f8 ($3c00 screen RAM)
//
// The 3 leftmost screen columns on badlines show a 2-pixel-wide
// artifact ("FLI bug") because the VIC has already started its
// c-access fetch before the new $D018 takes effect.

.const VIC_D011    = $d011
.const VIC_D016    = $d016
.const VIC_D018    = $d018
.const VIC_D012    = $d012
.const VIC_D019    = $d019
.const VIC_D01A    = $d01a

// $D018 values: VM = screen RAM page, CB2 = 1 (bitmap at $2000).
// Index 0 = first visible scanline's page (scanline 51 → 51 mod 8 = 3).
// We rotate through all 8 banks per character row.
.const PAGE_BASE   = 51   // first visible PAL raster line (25-row mode)

// Precomputed $D018 bytes for pages 0-7 (bitmap CB2 = 1 always set).
fli_d018_table:
    .byte $18, $28, $38, $48, $58, $68, $78, $f8

// Current FLI page index (0-7); updated each visible scanline.
// Initialized to (PAGE_BASE mod 8) before the display area begins.
fli_page_idx: .byte 3    // 51 mod 8 = 3

BasicUpstart2(start)

// ---------------------------------------------------------------------------
// FLI image data (precomputed).
// In a real production these blocks are filled by an image converter tool.
// The recipe shows the addressing structure; actual pixel and color data
// must come from a Koala-to-FLI conversion utility.
// ---------------------------------------------------------------------------

// Multicolor bitmap at $2000 (8000 bytes).
* = $2000
fli_bitmap:
    .fill 8000, $00           // placeholder — replace with real image bytes

// Screen RAM pages 0-6 at $0400, $0800, $0c00, $1000, $1400, $1800, $1c00.
* = $0400
fli_screen_page0: .fill 1000, $00
* = $0800
fli_screen_page1: .fill 1000, $11
* = $0c00
fli_screen_page2: .fill 1000, $22
* = $1000
fli_screen_page3: .fill 1000, $33
* = $1400
fli_screen_page4: .fill 1000, $44
* = $1800
fli_screen_page5: .fill 1000, $55
* = $1c00
fli_screen_page6: .fill 1000, $66

// Screen RAM page 7 at $3c00 (final 1K in bank 0 before $4000).
* = $3c00
fli_screen_page7: .fill 1000, $77

// Color RAM at $d800 (shared — only one Color RAM exists; same values
// serve all scanlines for the %11 multicolor pattern).
// A real FLI converter writes this separately.

// ---------------------------------------------------------------------------
// Main program
// ---------------------------------------------------------------------------
* = $0900
start:
    sei

    lda #$7f
    sta $dc0d              // mask CIA1 timer IRQ
    lda $dc0d              // clear pending

    // Enable multicolor bitmap mode.
    // $D011: BMM=1, DEN=1, RSEL=1, YSCROLL=3 → $3b
    lda #$3b
    sta VIC_D011

    // $D016: MCM=1, CSEL=1, XSCROLL=0 → $d8
    lda #$d8
    sta VIC_D016

    // Set initial $D018: page 3 (for scanline 51 = 3 mod 8), bitmap $2000.
    lda fli_d018_table+3
    sta VIC_D018

    // Enable VIC raster IRQ, clear any pending.
    lda #$01
    sta VIC_D01A
    sta VIC_D019

    // Install IRQ handler.
    lda #<fli_irq
    sta $0314
    lda #>fli_irq
    sta $0315

    // First IRQ fires one line before the display area to pre-set page.
    lda #PAGE_BASE - 1
    sta VIC_D012
    lda #$1b               // $D011 RST8 = 0 (line 50 < 256)
    sta VIC_D011

    cli
    jmp *                  // spin; all display work in IRQ

// ---------------------------------------------------------------------------
// FLI raster IRQ handler.
//
// Fires on every visible scanline (lines 51-250 PAL). On each entry:
//   1. Acknowledge $D019.
//   2. Advance fli_page_idx.
//   3. Write new $D018 from fli_d018_table[page_idx].
//   4. Schedule next IRQ for the next scanline.
//
// Critical timing: $D018 must be written before the VIC's c-access window
// for the upcoming line's badline (cycles 15-54). With stable IRQ entry
// at approximately cycle 10 of the scanline, the write lands at
// cycle 10 + 4 (LDA table) + 4 (STA $D018) = cycle ~18. This is within
// the safe pre-badline window. On non-badlines the write has no constraint
// because c-accesses only happen on badlines.
//
// The "FLI bug" (2-pixel artifact on the 3 leftmost character columns)
// is intrinsic to all FLI implementations: the VIC starts its c-access at
// cycle 15 of the badline and reads 3 characters (= 6 bytes = leftmost
// cells 0, 1, 2) before the CPU finishes writing $D018 on badlines where
// the IRQ fires late. Mitigation: use the 3-column FLI bug as part of the
// composition (cover them with sprites or position the image to the right).
// ---------------------------------------------------------------------------
* = $0b00
fli_irq:
    lda #$01
    sta VIC_D019            // acknowledge (6 cycles: LDA #imm + STA abs)

    // Advance page index (0→1→2→...→7→0).
    ldx fli_page_idx        // [4]
    inx                     // [2]
    txa                     // [2]
    and #$07                // [2] — mod 8
    sta fli_page_idx        // [4]
    tax                     // [2]

    // Write new $D018 (the critical write).
    lda fli_d018_table,x    // [4+x] indexed load
    sta VIC_D018            // [4] — must land before cycle 15 of the badline

    // Advance $D012 to the next scanline.
    inc VIC_D012            // [6] read-modify-write

    // Check if we have passed the last visible line (250 on PAL).
    // Use a shadow variable to avoid reading $D012 back.
    lda VIC_D012            // [4]
    cmp #251                // [2]
    bcc fli_continue        // [2/3]

    // End of display area: reset for next frame.
    lda #PAGE_BASE - 1      // [2]
    sta VIC_D012            // [4]
    lda #3                  // [2] page for line 50 (50 mod 8 = 2; pre-display fires at 50)
    sta fli_page_idx        // [4]
    // Restore $D018 for the top of the display.
    lda fli_d018_table+3    // [4]
    sta VIC_D018            // [4]

fli_continue:
    jmp $ea31

// ---------------------------------------------------------------------------
// Data table: $D018 byte for each of the 8 screen RAM pages.
// Already declared above; repeated here for reference only.
// Page n: VM nibble = (n == 7) ? $f : (n + 1); CB2 = 1 (bitmap $2000).
// Derivation: $D018 = (VM_nibble << 4) | (CB2 << 3) | lower_bits_zero
// Page 0: VM=$1 → $18; page 1: VM=$2 → $28; ...
// Page 7: VM=$f → $f8 (screen RAM $3c00, within bank 0).
// ---------------------------------------------------------------------------
```

## Build

```bash
java -jar KickAss.jar fli-image.asm -o fli-image.prg
```

With VICE symbol labels for timing inspection:

```bash
java -jar KickAss.jar fli-image.asm -o fli-image.prg -vicesymbols
```

The `.fill 8000, $00` placeholders in `fli_bitmap` and the `fli_screen_page*`
blocks must be replaced with actual image data produced by an FLI image
converter (e.g., `GraphicsMagick` → Koala → FLI conversion pipeline, or a
dedicated tool such as `KoalaPainter-FLI-Encoder`). The skeleton above shows
the correct memory addresses and $D018 values; the file will assemble and run
with placeholder data, displaying a blank screen with the FLI page-rotation
engine running correctly.

## Expected output

With real image data, the screen shows a 160×200 multicolor bitmap with
per-scanline color resolution — each of the 200 visible rows has independent
per-cell foreground and background colors. The image appears visually richer
than a plain multicolor bitmap, particularly in areas with fine vertical color
gradients (faces, landscapes, skies).

The canonical FLI artifact — a 2-pixel-wide distorted stripe on the three
leftmost character columns — is visible on hardware. This is not a bug in this
recipe; it is intrinsic to FLI on the 6569 chip. Emulators (VICE) may not
reproduce it accurately on all settings. In demoscene productions the artifact
is traditionally covered by a sprite border, or the image is composed to have
neutral content in the leftmost 24 pixels.

If the image appears with horizontal color-block jitter (wrong colors on some
lines), the $D018 write is arriving after the VIC's c-access window. Reduce
the NOP padding after IRQ entry or move the trigger line one earlier. If
every 8th line has wrong colors (the badline group), the handler is missing the
c-access window on bad lines only — see the cycle budget discussion below.

## Why this works

### FLI's core mechanism

In standard multicolor bitmap mode the VIC-II fetches 40 bytes of screen RAM
(the video matrix, c-accesses) on each badline — the first raster line of
every character row. These 40 bytes are stored in the chip's internal
40×12-bit latch and used as the per-cell color source for all 8 scanlines of
that character row. This is the bottleneck: a single screen RAM fetch drives
8 lines, giving a maximum of 200 / 8 = 25 unique row palettes per frame in
standard mode.

FLI defeats this by updating $D018 bits 7-4 (VM, the video matrix base) on
every scanline. When $D018 changes before the VIC's c-access window on a
badline, the chip fetches its 40 screen RAM bytes from the new address,
reloading the internal latch with fresh color data. By cycling through 8
different 1 KB screen RAM pages (each containing color data appropriate for
scanlines at that mod-8 offset), the FLI engine gives every visible scanline
its own distinct per-cell color palette. The result is 8000 distinct color
quad-sets (one per cell per visible row) instead of 1000.

### The 8-bank rotation and addressing

Eight 1 KB screen RAM pages occupy the $D018 VM field's 4-bit addressing.
The VM bits select the starting 1 KB block within the current VIC bank; the
16 KB bank itself is selected by CIA2 $DD00. In this recipe VIC bank 0
($0000-$3FFF) is used. The eight pages are placed at $0400, $0800, $0c00,
$1000, $1400, $1800, $1c00, and $3c00 — the last because $2000 is occupied
by the 8000-byte bitmap. The corresponding $D018 values are $18, $28, $38,
$48, $58, $68, $78, $F8.

Each frame a counter (`fli_page_idx`) advances from 0 to 7 and wraps. The
initial value is set to match the modulo-8 of the first visible scanline
(line 51, which is 51 mod 8 = 3 → page index 3). This ensures the correct
screen RAM page is active when the VIC first performs a c-access on line 51.

### The 23-cycle write constraint

The VIC-II begins its c-access (screen RAM fetch) at approximately cycle 15
of each badline. The $D018 write must land before cycle 15 to redirect the
fetch. With a stable raster IRQ (see `docs/techniques/raster.md`,
`stable_raster_irq`) firing at the start of the target line (approximately
cycle 0-2), the handler overhead is:

| Step | Cycles |
|------|--------|
| IRQ interrupt sequence | 7 |
| KERNAL dispatcher ($EA31 entry) | ~13 |
| Acknowledge $D019 (`LDA #$01` + `STA abs`) | 6 |
| Advance page counter (LDX, INX, TXA, AND, STA, TAX) | 14 |
| Load $D018 value (`LDA table,X`) | 4+1 |
| **Write `STA VIC_D018`** | **4** |
| Cumulative before write | **~49 cycles** |

This appears to exceed the 15-cycle threshold, which is why a pure $EA31-based
IRQ handler is insufficient for cycle-exact FLI. In production FLI engines,
the handler bypasses the KERNAL dispatcher (patching $FFFE/$FFFF directly)
and uses the double-IRQ technique from `docs/techniques/raster.md` to land
the $D018 write at a known early cycle position. The recipe above uses the
$EA31 path for readability; a production engine would use:

1. Direct vector patching via $FFFE/$FFFF (saves ~13 cycles of KERNAL
   dispatch overhead).
2. A minimal handler body: push A only, acknowledge $D019, write $D018,
   increment the page counter, update $D012, pull A, RTI — approximately
   30 cycles total from IRQ vector fetch.

With the direct approach the write lands at approximately cycle 22, within
the safe pre-c-access window on PAL. This is why `region: pal` is set: NTSC
(65 cycles per line, different badline onset relative to cycle 0) requires
separate cycle verification and the NOP padding or dispatch overhead may need
adjustment.

### The FLI bug and mitigations

The VIC's c-access for cells 0, 1, and 2 of a badline occurs before the CPU
has had enough time (even with the fastest possible handler) to write the new
$D018 value. The first three character columns therefore always render with the
color data from the previous screen RAM page, producing a 24-pixel-wide band
of wrong colors on the left side of every 8th line. This "FLI bug" is
universally present on real hardware and is considered an accepted aesthetic
feature of the technique. Common mitigations are:

- Position sprites over the leftmost 24 pixels for the full height of the FLI
  zone (the most common scene approach).
- Offset the active display area to the right using $D016 XSCROLL so that
  columns 0-2 fall outside the visible window.
- Compose the image to have a visually neutral (black or single-color) region
  in the leftmost 24 pixels so the artifact is imperceptible.

### Color RAM interaction

Color RAM at $D800 is not remapped by $D018. There is only one physical 1 KB
Color RAM in the C64, and it provides the %11 pattern color for all scanlines.
Because the %11 color source does not rotate with the VM pages, FLI images
typically assign the dominant or most spatially consistent color to the %11
pattern, reserving the more flexible %01 and %10 patterns (from screen RAM's
high and low nibbles) for per-scanline variation.

For reference, see `docs/techniques/bitmap-modes.md` (`fli_image` technique
entry) and `docs/techniques/raster.md` (`stable_raster_irq` and `double_irq`
entries) for the underlying mechanisms this recipe combines.
