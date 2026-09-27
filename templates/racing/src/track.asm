// track.asm: the circuit, 64 segments of 256 world units (16,384 a lap).
// Imported by engine.asm; C reads the same tables through asm.h.
//
// curv: the road's curvature in a segment, 0-3 either way; positive bends
// right. The builder reads it eased and halved (curvf, below): 3 draws as
// 1.5/64 pixel per line per line and moves the horizon's end of a long
// bend about 100 pixels (arithmetic: k L^2 / 128 for L = 96 lines).
// hill: the horizon offset the segment asks for, 0-23 (line 108 + hoff):
// 8 is level ground; more hides the road beyond a crest, less shows it
// climbing away.

.var track = List().add(
    // seg  curv hill
    0, 8,   0, 8,   0, 8,   0, 8,       // 0-3   the start straight
    0, 8,   0, 8,   2, 8,   2, 8,       // 4-7   into a right-hander
    3, 8,   3, 8,   2, 8,   0, 8,       // 8-11
    0, 4,   0, 2,   0, 2,   0, 6,       // 12-15 a dip
    0, 12,  0, 18,  0, 22,  0, 16,      // 16-19 over a crest
    -2, 10, -3, 8,  -3, 8,  -3, 8,      // 20-23 a long left-hander
    -2, 8,  0, 8,   0, 8,   0, 8,       // 24-27
    0, 8,   2, 8,   3, 8,   3, 8,       // 28-31 right
    0, 8,   -3, 8,  -3, 8,  0, 8,       // 32-35 and left: an S
    0, 6,   0, 3,   0, 3,   0, 8,       // 36-39 a dip
    0, 14,  0, 20,  0, 14,  0, 8,       // 40-43 a crest
    2, 8,   3, 8,   3, 8,   3, 8,       // 44-47 a long right-hander
    2, 8,   0, 8,   -3, 16, -3, 20,     // 48-51 a left kink over a crest
    -2, 16, 0, 10,  0, 8,   0, 8,       // 52-55 (the verdict's photo looks into it)
    0, 8,   0, 10,  0, 12,  0, 10,      // 56-59 a rise
    0, 8,   0, 8,   0, 8,   0, 8        // 60-63 to the line
)
.if (track.size() != 128) .error "track: 64 segments of two values"

curv_lo:    .fill 64, <track.get(i * 2)
curv_hi:    .fill 64, (track.get(i * 2) < 0) ? $ff : 0

// The curvature eased: four samples a segment (one per 64 units, 256 a
// lap), in quarter units of half the table's value (curv 3 draws as 1.5:
// at 3 the road left the screen's side within 40 lines, a hairpin), a
// straight line from a segment's value at its middle to the next's. A bend then builds over a
// segment and fades over one instead of switching on at a boundary, which
// showed as a kink walking down the road (the maintainer, 2026-09-27:
// "bends like choppy, too sharp"). The builder and the car's push read this.
.function curvF(e) {
    .var i = floor((e - 2) / 4)                 // the segment whose middle is at or before e
    .if (e < 2) .eval i = -1
    .var a = track.get(((i + 64) & 63) * 2)
    .var b = track.get(((i + 65) & 63) * 2)
    .var t = (e - (4 * i + 2)) / 4
    .return round(2 * (a + (b - a) * t))    // half the table's values: 3 was a hairpin
}
curvf:      .fill 256, curvF(i)
hill:       .fill 64, track.get(i * 2 + 1)
