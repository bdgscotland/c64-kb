// track.asm: the two stages, segments of 256 world units. Imported by
// engine.asm; C reads the same tables through asm.h.
//
// curv: the road's curvature in a segment, 0-3 either way; positive bends
// right. The builder reads it eased and halved (curvf, below): 3 draws as
// 1.5/64 pixel per line per line and moves the horizon's end of a long
// bend about 100 pixels (arithmetic: k L^2 / 128 for L = 96 lines).
// hill: the horizon offset the segment asks for, 0-23 (line 108 + hoff):
// 8 is level ground; more hides the road beyond a crest, less shows it
// climbing away.
//
// A stage is a point-to-point run: checkpoints at a quarter, a half and
// three quarters of it, the finish at its end (stage.c). Stage 1 opens
// with the 64 segments of the circuit this starter had before (the
// verdict's still looks into its segments 50-53); stage 2 is tighter and
// hillier. Past stage 2's end the tables run on straight and level for the
// road ahead of the camera (the builder reads 2,040 units on: 8 segments)
// and the field, which drives on.

.var circuit = List().add(
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
    0, 8,   0, 8,   0, 8,   0, 8        // 60-63
)
.if (circuit.size() != 128) .error "circuit: 64 segments of two values"

// runs: (count, curv, hill)
.function runs(list) {
    .var out = List()
    .for (var r = 0; r < list.size(); r += 3) {
        .for (var i = 0; i < list.get(r); i++) {
            .eval out.add(list.get(r + 1))
            .eval out.add(list.get(r + 2))
        }
    }
    .return out
}

// Stage 1, "Hill country": the circuit, then 32 segments of sweepers.
.var s1 = List()
.eval s1.addAll(circuit)
.eval s1.addAll(runs(List().add(
    4, 0, 8,    4, -2, 8,   2, 0, 6,   2, 0, 3,   4, 0, 12,   4, 3, 8,
    4, 0, 8,    4, -3, 10,  4, 0, 8)))

// Stage 2, "Canyon run": tighter, hillier.
.var s2 = runs(List().add(
    6, 0, 8,    4, 3, 8,    4, -3, 8,   2, 0, 14,  2, 0, 20,  2, 0, 12,
    4, 3, 8,    2, 0, 4,    2, 0, 2,    4, -3, 6,  4, 0, 8,   4, 2, 8,
    4, -2, 8,   4, 3, 10,   2, 0, 16,   2, 0, 22,  2, -3, 14, 4, -3, 8,
    4, 0, 8,    4, 3, 8,    2, -3, 8,   2, 3, 8,   2, -3, 8,  4, 0, 6,
    2, 0, 3,    2, 0, 10,   4, 3, 16,   4, -2, 8,  4, -3, 8,  4, 0, 8,
    4, 2, 8,    4, -3, 12,  2, 0, 18,   2, 0, 10,  4, 0, 8,   6, 0, 8))
.const PAD = 40
.var pad = List()
.for (var i = 0; i < PAD; i++) {
    .eval pad.add(0)
    .eval pad.add(8)
}
.const S1_LEN = s1.size() / 2
.const S2_LEN = s2.size() / 2
.var all = List()
.eval all.addAll(s1)
.eval all.addAll(s2)
.eval all.addAll(pad)
.if (all.size() / 2 > 256) .error "stages: more than 256 segments"

st_curv:    .fill all.size() / 2, all.get(i * 2) & $ff
st_hill:    .fill all.size() / 2, all.get(i * 2 + 1)
st_segs:    .byte all.size() / 2            // segments in the tables
st_base:    .byte 0, S1_LEN                 // each stage's first segment
st_len:     .byte S1_LEN, S2_LEN

// The curvature eased, four samples a segment, in quarter units of half the
// table's value: a straight line from a segment's value at its middle to
// the next's (stage.c track_fill). A bend then builds over a segment and
// fades over one instead of switching on at a boundary, which showed as a
// kink walking down the road (the maintainer, 2026-09-27: "bends like
// choppy, too sharp"). A ring of 256 samples (16,384 units): entry
// (position / 64) & 255, filled ahead of the camera as it moves, so the
// builder and the car's push read it as they read the circuit's table.
curvf:      .fill 256, 0
