---
recipe: sprite-cache-flip
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sprite_cache_flip]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D011, D015, D017, D01C, D01D, D020, D025, D026, D027, D028, D029, D02A, D02B, D02C, D02D, D02E, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# KickAssembler — Sprite Cache with Frames Mirrored at Run Time

## Synopsis

Stores five sprite frames facing right only, packed as a row mask plus
the non-empty rows, and depacks them on demand into an 8-slot sprite
cache in the VIC bank, mirrored when a request asks for the left-facing
version. Both mirror tables, bit-reversed for hires and pair-reversed
for multicolour, are built on the machine at start. The program checks
the tables against tables the assembler computed, checks every mirrored
frame against a frame the assembler mirrored by reversing its pixel
strings, checks that mirroring twice gives the frame back, counts cache
misses, hits and evictions, and times each step with the CIA2 timers.
Eight sprites show two hires and two multicolour frames, each beside its
mirror. This is the `sprite_cache_flip` technique; use it when a game's
frames facing both ways do not fit the VIC bank.

Verified in VICE x64sc 3.10: the text on screen is identical on PAL and
NTSC, and on both pictures every left-facing sprite is the exact pixel
mirror of its neighbour and matches the frame definitions in the
listing, pixel for pixel.

## Source

```asm
// sprite-cache-flip.asm
// Sprite frames are stored facing right only and packed: a 21-bit mask of
// the rows that are not empty, then 3 bytes per non-empty row. A cache of
// 8 sprite blocks at $2000 (pointers $80-$87) is filled on demand by
// depacking a frame, mirrored or not, into the next slot round-robin.
// Mirroring uses a 256-byte table built at start: bit order reversed for
// a hires frame (HFLIP), bit PAIRS reversed for a multicolour frame
// (MFLIP), and bytes 0 and 2 of each row swapped.
// Checks, all printed on screen:
//   TABLES BAD  entries of HFLIP and MFLIP that differ from tables the
//               assembler computed another way (bit arithmetic on i)
//   MIRROR BAD  bytes of each depacked left-facing frame that differ from
//               the frame the assembler mirrored by reversing its strings
//   ROUND BAD   bytes where flip(flip(frame)) differs from the frame
//   MISS/HIT/EVICT  counters of the cache over a fixed request sequence
// Cycles (CIA2 timers, screen blanked, IRQs off) for table generation, a
// flip of one 63-byte sprite, a cache fill and a cache hit.
// Verdict: $02FF = $01, green border and PASS when every check holds;
// $02FF = $02, red border and FAIL otherwise.
// The eight sprites show keys 0-7 of the cache: frame 0 right, frame 0
// left, frame 1 right, ... frame 3 left. Frames 0-1 hires, 2-3 multicolour.

BasicUpstart2(start)

.const CHROUT    = $ffd2
.const RESULT    = $02ff
.const BORDER    = $d020
.const SCREEN    = $0400

.const CACHE     = $2000          // 8 slots of 64 bytes, VIC bank 0
.const CACHE_PTR = CACHE / 64     // sprite pointer of slot 0 ($80)
.const SLOTS     = 8
.const HFLIP     = $3000          // built at start, page-aligned
.const MFLIP     = $3100
.const HREF      = $3200          // computed by the assembler
.const MREF      = $3300
.const BUF_A     = $3600          // depacked right-facing frame
.const BUF_B     = $3640          // depacked left-facing frame
.const BUF_C     = $3680          // BUF_B flipped again
.const FRAMES    = 5
.const KEYS      = FRAMES * 2     // key = frame * 2 + facing (1 = left)

.const sp   = $fb                 // flip63 source pointer
.const dp   = $fd                 // destination pointer (flip63, depack)
.const pk   = $02                 // packed frame pointer
.const ptr  = $04                 // puts pointer
.const cp   = $06                 // compare pointer
.const m0   = $08                 // row mask, 3 bytes
.const tmp  = $0b
.const res  = $0c
.const so   = $0d                 // offset into the packed rows
.const yr   = $0e
.const b0   = $0f                 // one packed row, 3 bytes
.const face = $12
.const key  = $13

// ---------------------------------------------------------------------------
// Frame definitions, assembled into packed data and a mirrored reference.
// Hires rows are 24 characters, '#' set; multicolour rows 12 characters,
// '.' or a colour 1-3 per double-wide pixel.
// ---------------------------------------------------------------------------
.function rowval(s) {
    .var v = 0
    .if (s.size() == 24) {
        .for (var i = 0; i < 24; i++) {
            .eval v = v * 2
            .if (s.charAt(i) == '#') .eval v = v + 1
        }
    } else {
        .for (var i = 0; i < 12; i++) {
            .eval v = v * 4
            .if (s.charAt(i) != '.') .eval v = v + (s.charAt(i) - '0')
        }
    }
    .return v
}
.function mirror(s) {             // reverse the characters: a mirrored row
    .var r = ""
    .for (var i = s.size() - 1; i >= 0; i--) .eval r = r + s.charAt(i)
    .return r
}
.macro Packed(rows) {             // 3 mask bytes, then the non-empty rows
    .var mask = 0
    .for (var r = 0; r < 21; r++) {
        .if (rowval(rows.get(r)) != 0) .eval mask = mask | (1 << r)
    }
    .byte mask & $ff, (mask >> 8) & $ff, mask >> 16
    .for (var r = 0; r < 21; r++) {
        .var v = rowval(rows.get(r))
        .if (v != 0) .byte v >> 16, (v >> 8) & $ff, v & $ff
    }
}
.macro Mirrored(rows) {           // 63 bytes, the frame facing left
    .for (var r = 0; r < 21; r++) {
        .var v = rowval(mirror(rows.get(r)))
        .byte v >> 16, (v >> 8) & $ff, v & $ff
    }
}
.function rev8(x) {               // bit i goes to bit 7 - i
    .var v = 0
    .for (var i = 0; i < 8; i++) .eval v = v * 2 + ((x >> i) & 1)
    .return v
}
.function revpairs(x) {           // pair i goes to pair 3 - i
    .var v = 0
    .for (var i = 0; i < 4; i++) .eval v = v * 4 + ((x >> (2 * i)) & 3)
    .return v
}

.var E  = "........................"
.var e  = "............"
.var f0 = List().add(E, E, E, E,      // hires arrow pointing right
    "..............#.........",
    "..............##........",
    "..............###.......",
    "..............####......",
    "###############.###.....",
    "###############.####....",
    "####################....",
    "#####################...",
    "######################..",
    "#####################...",
    "####################....",
    ".............######.....",
    ".............#####......",
    ".............####.......",
    ".............###........",
    E, E)
.var f1 = List()                      // hires staircase with a dotted edge
.for (var r = 0; r < 21; r++) {
    .var s = ""
    .for (var c = 0; c < 24; c++) {
        .if (c <= r || (c == 23 && (r & 1) == 0)) .eval s = s + "#"
        else .eval s = s + "."
    }
    .eval f1.add(s)
}
.var f2 = List().add(e, e, e,         // multicolour fish facing right
    "......111...",
    "....1111111.",
    "3..111111211",
    "33111111111.",
    "331122222111",
    "33112222221.",
    "3311111111..",
    "3..1111111..",
    "....11111...",
    "......1.....",
    e, e, e, e, e, e, e, e)
.var f3 = List()                      // multicolour ramp: colour by column
.for (var r = 0; r < 21; r++) {
    .var s = ""
    .for (var c = 0; c < 12; c++) {
        .if (c * 2 <= r) .eval s = s + toIntString(1 + mod(c, 3))
        else .eval s = s + "."
    }
    .eval f3.add(s)
}
.var f4 = List()                      // hires flag, used only to be evicted
.for (var r = 0; r < 21; r++) {
    .if (r < 8) .eval f4.add("##########..............")
    else .eval f4.add("#.......................")
}

start:
    sei
    lda #0
    sta $dd0e                     // stop both CIA2 timers, latches $FFFF
    sta $dd0f
    lda #$ff
    sta $dd04
    sta $dd05
    sta $dd06
    sta $dd07
    lda $d011                     // blank the screen: no badlines while timing
    and #$ef
    sta $d011
!:  lda $d011                     // DEN is sampled on line $30: wait a frame
    bpl !-
!:  lda $d011
    bmi !-

    ldx #KEYS - 1                 // empty cache
    lda #$ff
!:  sta slot_of,x
    dex
    bpl !-
    ldx #SLOTS - 1
!:  sta key_of,x
    dex
    bpl !-

    Time(nothing, t_empty)
    Time(gen_h, t_genh)
    Time(gen_m, t_genm)

    // one 63-byte flip each way, from the depacked frame 0 into BUF_C
    lda #0
    sta face
    lda #0
    jsr setframe
    Set16(dp, BUF_A)
    jsr depack
    Set16(sp, BUF_A)
    Set16(dp, BUF_C)
    lda #>HFLIP
    jsr settbl
    Time(flip63, t_fliph)
    lda #>MFLIP
    jsr settbl
    Time(flip63, t_flipm)

    // the request sequence: 9 misses (the last evicts frame 4), 8 hits
    Req(8, t_scratch)             // frame 4 right, into slot 0
    Req(0, t_fill0r)
    Req(2, t_fill1r)
    Req(4, t_scratch)
    Req(6, t_scratch)
    Req(1, t_fill0l)
    Req(3, t_fill1l)
    Req(5, t_scratch)
    Req(7, t_scratch)             // slot 0 again: frame 4 is evicted
    Req(0, t_scratch)
    Req(1, t_hit)
    Req(2, t_scratch)
    Req(3, t_scratch)
    Req(4, t_scratch)
    Req(5, t_scratch)
    Req(6, t_scratch)
    Req(7, t_scratch)

    Net(t_genh)
    Net(t_genm)
    Net(t_fliph)
    Net(t_flipm)
    Net(t_fill0r)
    Net(t_fill0l)
    Net(t_fill1l)
    Net(t_fill1r)
    Net(t_hit)

    // the flip tables against the assembler's tables
    ldx #0
!:  lda HFLIP,x
    cmp HREF,x
    beq ok_h
    inc bad_tab
ok_h:
    lda MFLIP,x
    cmp MREF,x
    beq ok_m
    inc bad_tab
ok_m:
    inx
    bne !-

    // every frame: left against the assembler's mirror, flip(flip) = frame
    lda #0
    sta frame
chk:
    lda frame
    jsr setframe
    lda #0
    sta face
    Set16(dp, BUF_A)
    jsr depack
    lda #1
    sta face
    Set16(dp, BUF_B)
    jsr depack
    ldx frame
    lda mir_lo,x
    sta cp
    lda mir_hi,x
    sta cp+1
    Set16(sp, BUF_B)
    jsr compare                   // BUF_B against the mirrored reference
    clc
    adc bad_mir
    sta bad_mir
    Set16(dp, BUF_C)
    jsr flip63                    // BUF_C = flip(BUF_B)
    Set16(cp, BUF_A)
    Set16(sp, BUF_C)
    jsr compare
    clc
    adc bad_round
    sta bad_round
    inc frame
    lda frame
    cmp #FRAMES
    bne chk

    lda $d011                     // screen back on
    ora #$10
    sta $d011
    cli

    lda bad_tab                   // verdict
    ora bad_mir
    ora bad_round
    bne fail
    lda misses
    cmp #9
    bne fail
    lda hits
    cmp #8
    bne fail
    lda evicts
    cmp #1
    bne fail
    lda slot_of + 8               // frame 4 must no longer be cached
    bpl fail
    lda #$01
    ldy #5                        // green
    bne verdict
fail:
    lda #$02
    ldy #2                        // red
verdict:
    sta RESULT
    sty BORDER

    lda #$93
    jsr CHROUT
    Line2(t_genh_txt, t_genh, t_genm_txt, t_genm)
    Line2(t_flip_txt, t_fliph, t_flipm_txt, t_flipm)
    Line2(t_fill_txt, t_fill0r, t_fill0l_txt, t_fill0l)
    Line2(t_fill1_txt, t_fill1r, t_fill1l_txt, t_fill1l)
    Line2(t_hit_txt, t_hit, t_miss_txt, misses)
    Line2(t_hits_txt, hits, t_evict_txt, evicts)
    Line2(t_tab_txt, bad_tab, t_mir_txt, bad_mir)
    Line1(t_round_txt, bad_round)
    ldx #<t_res_txt
    ldy #>t_res_txt
    jsr puts
    lda RESULT
    jsr hexbyte
    ldx #<t_pass_txt
    ldy #>t_pass_txt
    lda RESULT
    cmp #$01
    beq !+
    ldx #<t_fail_txt
    ldy #>t_fail_txt
!:  jsr puts

    // sprite n shows cache key n
    ldx #7
spr:
    lda slot_of,x
    clc
    adc #CACHE_PTR
    sta SCREEN + $3f8,x
    lda xpos,x
    ldy pairs,x
    sta $d000,y
    lda #170
    sta $d001,y
    lda #1                        // white; the multicolour ones use it too
    sta $d027,x
    dex
    bpl spr
    lda #0
    sta $d010
    sta $d017
    sta $d01d
    lda #%11110000                // sprites 4-7 are frames 2 and 3
    sta $d01c
    lda #10                       // %01 light red
    sta $d025
    lda #7                        // %11 yellow; %10 is the sprite colour
    sta $d026
    lda #$ff
    sta $d015
    jmp *

nothing:
    rts

// ---------------------------------------------------------------------------
// gen_h: HFLIP[x] = x with its 8 bits in reverse order
// ---------------------------------------------------------------------------
gen_h:
    ldx #0
gh:
    stx tmp
    ldy #8
!:  lsr tmp                       // bit 0 out first ...
    rol                           // ... ends at bit 7 after 8 rotates
    dey
    bne !-
    sta HFLIP,x
    inx
    bne gh
    rts

// ---------------------------------------------------------------------------
// gen_m: MFLIP[x] = x with its 4 bit pairs in reverse order; each pair
// keeps its own bit order, so a pixel keeps its colour
// ---------------------------------------------------------------------------
gen_m:
    ldx #0
gm:
    stx tmp
    lda #0
    ldy #4
!:  asl
    asl
    sta res
    lda tmp
    and #%00000011                // lowest pair of what is left
    ora res
    lsr tmp
    lsr tmp
    dey
    bne !-
    sta MFLIP,x
    inx
    bne gm
    rts

// ---------------------------------------------------------------------------
// settbl: A = high byte of the flip table used by flip63 and depack
// ---------------------------------------------------------------------------
settbl:
    sta fa + 2
    sta fb + 2
    sta fc + 2
    sta da + 2
    sta db + 2
    sta dc + 2
    rts

// ---------------------------------------------------------------------------
// flip63: (dp) = mirror of the 63 bytes at (sp). Row r: dst[r] = T[src[r+2]],
// dst[r+1] = T[src[r+1]], dst[r+2] = T[src[r]]. Source and destination
// must not overlap: dst[r] is written before src[r] is read.
// ---------------------------------------------------------------------------
    .align $100                   // flip63 and depack in one page: no
                                  // branch crosses a page, so the cycle
                                  // counts do not move when code grows
flip63:
    ldy #0
frow:
    sty yr
    iny
    iny
    lda (sp),y
    tax
fa: lda HFLIP,x
    ldy yr
    sta (dp),y
    iny
    lda (sp),y
    tax
fb: lda HFLIP,x
    sta (dp),y
    dey
    lda (sp),y
    tax
fc: lda HFLIP,x
    iny
    iny
    sta (dp),y
    iny
    cpy #63
    bne frow
    rts

// ---------------------------------------------------------------------------
// setframe: A = frame; points pk at its packed data, selects its table
// ---------------------------------------------------------------------------
setframe:
    tax
    lda pk_lo,x
    sta pk
    lda pk_hi,x
    sta pk+1
    lda is_mc,x
    beq !+
    lda #>MFLIP
    jmp settbl
!:  lda #>HFLIP
    jmp settbl

// ---------------------------------------------------------------------------
// depack: 63 bytes at (dp) from the packed frame at (pk), mirrored when
// face = 1. An empty row costs 3 stores; a present row 3 reads, 3 stores,
// and 3 table lookups when mirrored.
// ---------------------------------------------------------------------------
depack:
    ldy #0
    lda (pk),y
    sta m0
    iny
    lda (pk),y
    sta m0+1
    iny
    lda (pk),y
    sta m0+2
    iny
    sty so                        // rows start after the mask
    ldy #0
drow:
    lsr m0+2                      // next row's bit into carry
    ror m0+1
    ror m0
    bcc dempty
    sty yr
    ldy so
    lda (pk),y
    sta b0
    iny
    lda (pk),y
    sta b0+1
    iny
    lda (pk),y
    sta b0+2
    iny
    sty so
    ldy yr
    lda face
    beq dcopy
    ldx b0+2
da: lda HFLIP,x
    sta (dp),y
    iny
    ldx b0+1
db: lda HFLIP,x
    sta (dp),y
    iny
    ldx b0
dc: lda HFLIP,x
    sta (dp),y
    iny
    bne dnext                     // always: y <= 63
dcopy:
    lda b0
    sta (dp),y
    iny
    lda b0+1
    sta (dp),y
    iny
    lda b0+2
    sta (dp),y
    iny
    bne dnext
dempty:
    lda #0
    sta (dp),y
    iny
    sta (dp),y
    iny
    sta (dp),y
    iny
dnext:
    cpy #63
    bne drow
    rts

// ---------------------------------------------------------------------------
// request: A = key (frame * 2 + facing). Returns the slot in A. On a miss
// the next slot round-robin is taken; its old key is forgotten and the
// frame is depacked into it.
// ---------------------------------------------------------------------------
req_cur:
    lda key
request:
    sta key
    tax
    lda slot_of,x
    bmi miss
    inc hits
    rts
miss:
    inc misses
    ldx next_slot
    lda key_of,x
    bmi free
    tay
    lda #$ff                      // evict: the old key has no slot now
    sta slot_of,y
    inc evicts
free:
    lda key
    sta key_of,x
    tay
    txa
    sta slot_of,y
    lsr                           // dp = CACHE + slot * 64
    lsr
    clc
    adc #>CACHE
    sta dp+1
    txa
    and #3
    lsr
    ror
    ror
    sta dp
    inx
    txa
    and #SLOTS - 1
    sta next_slot
    lda key
    and #1
    sta face
    lda key
    lsr
    jsr setframe
    jsr depack
    ldx key
    lda slot_of,x
    rts

// ---------------------------------------------------------------------------
// compare: A = number of the 63 bytes at (sp) that differ from (cp)
// ---------------------------------------------------------------------------
compare:
    ldx #0
    ldy #62
!:  lda (sp),y
    cmp (cp),y
    beq !+
    inx
!:  dey
    bpl !--
    txa
    rts

puts:                             // print the zero-terminated string at Y:X
    stx ptr
    sty ptr+1
    ldy #0
!:  lda (ptr),y
    beq !+
    jsr CHROUT
    iny
    bne !-
!:  rts

putdec:                           // print the 24-bit value in num, decimal
    ldx #0
    stx lead
digit:
    lda #'0' - 1
    sta dig
!:  inc dig
    sec
    lda num
    sbc pow10,x
    sta num
    lda num+1
    sbc pow10+1,x
    sta num+1
    lda num+2
    sbc pow10+2,x
    sta num+2
    bcs !-
    lda num                       // undo the last subtraction
    adc pow10,x
    sta num
    lda num+1
    adc pow10+1,x
    sta num+1
    lda num+2
    adc pow10+2,x
    sta num+2
    lda dig
    cmp #'0'
    bne show
    cpx #6 * 3                    // the last digit always prints
    beq show
    lda lead
    beq skip                      // suppress a leading zero
    lda #'0'
show:
    jsr CHROUT
    inc lead
skip:
    inx
    inx
    inx
    cpx #7 * 3
    bne digit
    rts

hexbyte:                          // print A as two hex digits
    pha
    lsr
    lsr
    lsr
    lsr
    jsr hexdigit
    pla
    and #$0f
hexdigit:
    cmp #10
    bcc !+
    adc #6                        // carry set: +7 lands on 'A'
!:  adc #'0'
    jmp CHROUT

// ---------------------------------------------------------------------------
.macro Set16(zp, value) {
    lda #<value
    sta zp
    lda #>value
    sta zp+1
}

// Time(routine, slot): CIA2 timer A counts phi2, timer B its underflows;
// the 24-bit count lands in slot
.macro Time(routine, slot) {
    lda #$51
    sta $dd0f
    lda #$11
    sta $dd0e
    jsr routine
    lda #0
    sta $dd0e
    sta $dd0f
    sec
    lda #$ff
    sbc $dd04
    sta slot
    lda #$ff
    sbc $dd05
    sta slot+1
    lda #$ff
    sbc $dd06
    sta slot+2
}

.macro Net(slot) {                // slot -= the cost of an empty timed call
    sec
    lda slot
    sbc t_empty
    sta slot
    lda slot+1
    sbc t_empty+1
    sta slot+1
    lda slot+2
    sbc t_empty+2
    sta slot+2
}

.macro Req(k, slot) {             // a timed cache request for key k
    lda #k
    sta key
    Time(req_cur, slot)
}

.macro Line2(label1, v1, label2, v2) {   // "LABEL1 n LABEL2 n"
    ldx #<label1
    ldy #>label1
    jsr puts
    lda v1
    sta num
    lda v1+1
    sta num+1
    lda v1+2
    sta num+2
    jsr putdec
    ldx #<label2
    ldy #>label2
    jsr puts
    lda v2
    sta num
    lda v2+1
    sta num+1
    lda v2+2
    sta num+2
    jsr putdec
    lda #$0d
    jsr CHROUT
}

.macro Line1(label, v) {          // "LABEL n"
    ldx #<label
    ldy #>label
    jsr puts
    lda v
    sta num
    lda v+1
    sta num+1
    lda v+2
    sta num+2
    jsr putdec
    lda #$0d
    jsr CHROUT
}

pow10:  .byte <1000000, >1000000, 1000000 >> 16
        .byte <100000, >100000, 100000 >> 16
        .byte <10000, >10000, 0
        .byte <1000, >1000, 0
        .byte <100, >100, 0
        .byte <10, >10, 0
        .byte <1, >1, 0

t_empty:   .byte 0, 0, 0
t_genh:    .byte 0, 0, 0
t_genm:    .byte 0, 0, 0
t_fliph:   .byte 0, 0, 0
t_flipm:   .byte 0, 0, 0
t_fill0r:  .byte 0, 0, 0
t_fill0l:  .byte 0, 0, 0
t_fill1l:  .byte 0, 0, 0
t_fill1r:  .byte 0, 0, 0
t_hit:     .byte 0, 0, 0
t_scratch: .byte 0, 0, 0
misses:    .byte 0, 0, 0          // counters are 24-bit for Line2
hits:      .byte 0, 0, 0
evicts:    .byte 0, 0, 0
bad_tab:   .byte 0, 0, 0
bad_mir:   .byte 0, 0, 0
bad_round: .byte 0, 0, 0
num:       .byte 0, 0, 0
dig:       .byte 0
lead:      .byte 0
frame:     .byte 0
next_slot: .byte 0
slot_of:   .fill KEYS, $ff        // key -> slot, $FF = not cached
key_of:    .fill SLOTS, $ff       // slot -> key, $FF = free

pairs:  .byte 0, 2, 4, 6, 8, 10, 12, 14
xpos:   .byte 32, 60, 96, 124, 160, 188, 224, 252   // all < 256: $D010 stays 0

pk_lo:  .byte <p0, <p1, <p2, <p3, <p4
pk_hi:  .byte >p0, >p1, >p2, >p3, >p4
is_mc:  .byte 0, 0, 1, 1, 0
mir_lo: .byte <r0, <r1, <r2, <r3, <r4
mir_hi: .byte >r0, >r1, >r2, >r3, >r4

p0: Packed(f0)
p1: Packed(f1)
p2: Packed(f2)
p3: Packed(f3)
p4: Packed(f4)

.encoding "petscii_upper"
t_genh_txt:  .text "GEN H "
             .byte 0
t_genm_txt:  .text " M "
             .byte 0
t_flip_txt:  .text "FLIP63 H "
             .byte 0
t_flipm_txt: .text " M "
             .byte 0
t_fill_txt:  .text "FILL 0R "
             .byte 0
t_fill0l_txt: .text " 0L "
             .byte 0
t_fill1_txt: .text "FILL 1R "
             .byte 0
t_fill1l_txt: .text " 1L "
             .byte 0
t_hit_txt:   .text "HIT "
             .byte 0
t_miss_txt:  .text " MISS "
             .byte 0
t_hits_txt:  .text "HITS "
             .byte 0
t_evict_txt: .text " EVICT "
             .byte 0
t_tab_txt:   .text "TABLES BAD "
             .byte 0
t_mir_txt:   .text " MIRROR BAD "
             .byte 0
t_round_txt: .text "ROUND BAD "
             .byte 0
t_res_txt:   .text "RESULT "
             .byte 0
t_pass_txt:  .text " PASS"
             .byte 0
t_fail_txt:  .text " FAIL"
             .byte 0

*= HREF "reference tables"
    .fill 256, rev8(i)
    .fill 256, revpairs(i)

*= $3400 "mirrored frames"
r0: Mirrored(f0)
r1: Mirrored(f1)
r2: Mirrored(f2)
r3: Mirrored(f3)
r4: Mirrored(f4)
```

## Build

```bash
java -jar KickAss.jar sprite-cache-flip.asm -o sprite-cache-flip.prg
```

Run headless (PAL shown; add `-model ntsc` for NTSC):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -minimized -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 \
  -exitscreenshot sprite-cache-flip.png -autostart sprite-cache-flip.prg
```

## Expected output

Blue screen, green border. Nine lines of light-blue text at the top,
decoded from the exit screenshot against the character ROM, the same on
PAL and NTSC:

```text
GEN H 28161 M 34817
FLIP63 H 1597 M 1597
FILL 0R 2099 0L 2264
FILL 1R 2441 1L 2672
HIT 20 MISS 9
HITS 8 EVICT 1
TABLES BAD 0 MIRROR BAD 0
ROUND BAD 0
RESULT 01 PASS
```

Below the text, one row of eight sprites with their top row on raster
line 171 (Y register 170): a white arrow pointing right, the same arrow
pointing left, a white staircase, its mirror, a multicolour fish facing
right, the fish facing left, a multicolour ramp and its mirror.

Screenshots from the pinned run, 8,000,000 cycles, both models:
`screenshots/sprite-cache-flip.png` and
`screenshots/sprite-cache-flip-ntsc.png`. Two runs of each gave
byte-identical files.

| Line | Meaning |
|---|---|
| GEN H, M | cycles to build HFLIP and MFLIP, 256 entries each |
| FLIP63 H, M | cycles to mirror one 63-byte sprite into another buffer with each table |
| FILL 0R, 0L | a cache miss for frame 0 (15 of 21 rows present), right and left |
| FILL 1R, 1L | a cache miss for frame 1 (all 21 rows present), right and left |
| HIT | a cache hit |
| MISS, HITS, EVICT | counters over the 17 requests: 9 misses, 8 hits, 1 eviction |
| TABLES BAD | table entries that differ from the assembler's tables |
| MIRROR BAD | bytes of the five left-facing frames that differ from the assembler's mirrors |
| ROUND BAD | bytes where mirroring a left-facing frame again does not give the right-facing one |
| RESULT | `01` PASS and a green border, `02` FAIL and a red border; also stored at $02FF |

Every cycle figure is less the cost of an empty timed call, and the fill
and hit figures include the call through `request`. Mirroring during a
fill costs 11 cycles a row over a plain copy: 2,672 - 2,441 = 231 for 21
rows, 2,264 - 2,099 = 165 for 15 (arithmetic from the screen). The
verdict also requires the evicted frame's key to read as not cached.

### Reading the sprites off the picture

The sprites sit at X 32, 60, 96, 124, 160, 188, 224 and 252, so their
boxes start at screenshot column X + 8; the top row is screenshot row 155
on PAL and 143 on NTSC (line 171 less 16 or 28). A PIL script mapped
every pixel of each 24 by 21 box to a palette index with the model's
table in `runtime/vice-reference.md`, rebuilt the five frame definitions
from the listing independently in Python, and compared:

| Check | PAL | NTSC |
|---|---|---|
| Pixels differing from the expected frame, all 8 sprites | 0 | 0 |
| Pixels where a left sprite differs from the mirror of its right neighbour, 4 pairs | 0 | 0 |
| Set pixels in the rows just above and below the boxes | 0 | 0 |

A hires pixel is white (index 1); a multicolour pixel is two screen
pixels wide, %01 light red ($D025 = 10), %10 white (the sprite colour),
%11 yellow ($D026 = 7).

**Negative run.** The same listing with `is_mc` set to 0 for every
frame, so the multicolour frames are mirrored with the hires table,
prints `MIRROR BAD 62`, `ROUND BAD 0` and `RESULT 02 FAIL` on a red
border. On the picture the fish and the ramp facing left keep their
shape but 136 and 176 of their screen pixels change colour, %01 and %10
swapped. The round trip still passes because HFLIP is its own inverse
too: only a comparison with an independently mirrored frame catches the
wrong table.

## Why this works

**The tables.** `gen_h` shifts each index out to the right eight times
and rotates the bits into the accumulator from the right, so bit 0 ends
in bit 7. `gen_m` shifts the result left two places and ORs in the
lowest pair of what is left of the index, four times, so pair 0 ends in
pair 3 with its two bits in their original order. The references are
`.fill 256, rev8(i)` and `.fill 256, revpairs(i)`, computed by the
assembler from the bit arithmetic, a different path to the same table.

**The mirror.** `flip63` and the mirrored branch of `depack` write
`T[b2], T[b1], T[b0]` for each row. The source and destination must not
overlap: `flip63` writes byte `r` of a row before reading byte `r` of
the source. The table's page is patched into the six `lda table,x`
operands by `settbl`, so one routine serves both modes. The two
routines share one page (`.align $100`); an earlier build in which the
loop branch of `flip63` crossed a page measured `FLIP63 1617`, 20 cycles
more, one per taken branch.

**The packing.** The assembler turns each frame's pixel strings into
three mask bytes, one bit per row, and emits 3 bytes for each row whose
value is not zero. `depack` shifts the 24-bit mask right once per row;
the carry says whether to read a row or store three zeros. Byte 63 of a
slot is never written.

**The cache.** `request` takes a key, `frame * 2 + facing`. A hit
returns `slot_of[key]`. A miss takes `next_slot`, clears `slot_of` for
the key the slot held, depacks the frame into `$2000 + slot * 64`,
records both mappings and advances `next_slot` modulo 8. The sequence
requests frame 4 first (key 8), then keys 0, 2, 4, 6, 1, 3, 5 and 7, so
key 7 lands in slot 0 and evicts frame 4; the second pass over keys 0 to 7 is all hits. The
sprite pointer for key `n` is `$80 + slot_of[n]`, because the cache
starts at $2000 in VIC bank 0, 128 blocks in.

**The measurement.** CIA2 timer A counts phi2 and timer B counts its
underflows, the harness of `sine-table-runtime.md`. All timed work runs
under `SEI` with the screen blanked a frame early, since DEN is sampled
once, on line $30, so no badline steals cycles.

**The positions.** Every X is below 256, so $D010 stays 0. A first
draft placed the last pair at X 256 and 288 with $D010 clear; the
sprites appeared at X 0 and 32, one hidden in the border and one on top
of the first arrow (`sprite_x_high_bit_wrong_register`).

## What this recipe does not show

Protection of on-screen frames from eviction: the recipe never has more
distinct frames on screen than slots, so plain round-robin is enough
here and is not enough in a game (see the technique's Eviction
paragraph). A cache under the I/O area, which needs $01 banking with
IRQs off during the fill. Depacking inside a running game loop with a
multiplexer; every fill here runs before the display starts.
