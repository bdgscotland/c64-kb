// config.asm: every constant the demo's layout and timeline hang on.
// tools/gen_expect.py reads the plain `.const NAME = number` lines of this
// file, recomputes the picture from them in Python and writes expect.json.
// Change a number here, then run `python3 tools/gen_expect.py`.

.const SCREEN       = $0400
.const COLOUR       = $d800
.const RESULT       = $02ff            // $01 pass, $02 fail, $00 not reached
.const SPRITE_BLOCK = 13               // $0340, the tape buffer

// ---- timeline -------------------------------------------------------------
.const TITLE_FRAMES = 60               // the title card's play frames
.const WIPE_COLS    = 2                // columns the wipe clears each frame
.const FREEZE_UPDATES = 156            // AUTOPILOT: the main part's updates before
                                       // it freezes; 156 = 8 x 19 + 4 leaves XSCROLL 3,
                                       // so a missing $D016 write shows in the picture
.const HOLD         = 232              // frames the meter records (all before the freeze)

// ---- raster layout: the same line numbers on PAL and NTSC ------------------
.const FRAME_LINE   = 236              // the frame slot, last row of every chain
.const SCROLL_LINE  = 224              // XSCROLL on for row 22 (lines 227-234)
.const BARS_SLOT_LINE = 148            // the stable entry: irq2 fires STABLE_LINES later
.const STABLE_LINES = 4
.const LATE_LINES   = 3                // a slot entered this many lines after its line is late
.const BARS_TOP     = 155              // first bar line (measured lead, see main part)
.const BARS_LINES   = 56               // bar lines 155-210; rows 13-19 must stay blank
.const BAR_H        = 12
.const SCROLL_ROW   = 22

// ---- sprite chain (lines 101-145: clear of the bars' lines) ---------------
.const CHAIN_X0     = 48               // sprite n's centre X: CHAIN_X0 + n * CHAIN_DX
.const CHAIN_DX     = 36
.const CHAIN_AX     = 16               // X swing, +-
.const CHAIN_Y0     = 112              // Y register centre
.const CHAIN_AY     = 12               // Y swing, +-: Y 100-124, lines 101-145
.const CHAIN_PX     = 16               // sine steps between sprites, X
.const CHAIN_PY     = 24               // and Y
.const CHAIN_SX     = 2                // sine steps a frame, X
.const CHAIN_SY     = 3                // and Y
.const CHAIN_COL_A  = 13               // even sprites: light green
.const CHAIN_COL_B  = 3                // odd sprites: cyan
// Each bar chunk is a fixed 63 or 65 cycles: sprite DMA on any line from the
// stable slot to the last bar delays that chunk and every later one until a
// badline resyncs them, and tears the bars. Keep the chain clear of 148-211.
.errorif (CHAIN_Y0 + CHAIN_AY + 21 >= BARS_SLOT_LINE && CHAIN_Y0 - CHAIN_AY + 1 <= BARS_TOP + BARS_LINES), "the sprite chain reaches the stable slot or the bar lines"

// ---- bars -------------------------------------------------------------------
.const BARS_CENTRE  = 22               // top of a bar at rest: (56 - 12) / 2
.const BARS_AMP     = 22               // +- lines
.const BAR_STEP     = 40               // sine steps between bars
.const BAR_SPEED    = 2                // sine steps a frame
// The four bars' colours, top line to bottom (tables.asm emits them).
.var bar_ramps = List().add(
    List().add(9, 2, 8, 10, 15, 1, 1, 15, 10, 8, 2, 9),       // red
    List().add(6, 6, 14, 14, 3, 1, 1, 3, 14, 14, 6, 6),       // blue
    List().add(11, 5, 5, 13, 13, 1, 1, 13, 13, 5, 5, 11),     // green
    List().add(11, 12, 12, 15, 15, 1, 1, 15, 15, 12, 12, 11)) // grey

// ---- the stable entry: cycles of padding before irq2's two $D012 reads ----
// Measured in VICE x64sc 3.10 with the PROBE build (README, "The stable
// entry and the bars"): with these the bar kernel's stores land in one
// column on every line of six shots a model; one more or one less splits
// them into two columns 8 pixels apart.
.const SYNC_PAD_PAL  = 2
.const SYNC_PAD_NTSC = 6

// ---- the running order (parts.asm holds the table) --------------------------
.const PART_COUNT   = 2
.const LOOP_PART    = 1                // after the last part: play this one again
.const MAIN_PART    = 1                // the part the AUTOPILOT build freezes and grades

#if FORCE_FAULT
.const CHAIN_FAULT  = 16               // the chain starts sixteen sine steps ahead
#else
.const CHAIN_FAULT  = 0
#endif
