// glyphs.asm: the road's slanted-edge glyphs and row templates, computed at
// assembly, imported by engine.asm (its zOf, W0, ZN, ROAD_LINES).
//
// A road row is drawn around a content centre on a 4-pixel boundary: phase 0
// puts the road's centre on a character boundary, phase 1 in the middle of a
// character. Each line's XSCROLL adds its own centre's offset from that. So a
// row's characters depend only on the road's half-width on its eight lines,
// and that depends only on the line and the horizon offset (wLine). The horizon moves
// in steps of two lines (12 of the 24 offsets), so every glyph a row can need
// is known here: no glyph is drawn while the game runs.
//
// Both phases are symmetric about the road's centre, so only the left half is
// kept: the right half of a row is the mirror image, and glyph id + $80 is the
// mirror of glyph id (glyph_init makes them). Ids 0 and $80 are grass, 1 and
// $81 road, 2-4 the hills, road glyphs from 5. Rows share up to four
// character sets, assigned here so no set holds more than 123 left glyphs.
//
// Pixel pairs: %00 grass ($D021), %01 road ($D022), %10 kerb ($D023),
// %11 centre line (colour RAM). A pair whose centre is dd pixels from the
// road's centre, on a line of half-width w: centre line if dd < w / 34, road
// if dd < w, kerb if dd < w + max(2, w / 7), grass beyond.
//
// A template, from the centre outward (phase 0: k = 1 is the column left of
// the centre; phase 1: k = 0 is the centre's own column): n1 codes, then a
// run of L road codes, then n2 codes, then grass to k = 23.
//   .byte n1, codes..., L, n2, codes...

.const HSTEP   = 2              // the horizon moves two lines at a time
.const HN      = HOFF_N / HSTEP // 12 horizon offsets with glyphs
.const GCAP    = 123            // left glyphs a set holds (5-127)
.const KMAX    = 24             // template columns, k = 0-23

// The road's half-width on road line i (0-95) under horizon offset h, from
// the projection itself: W0 * d / D, d = line - H, D = 202 - H. Not from ztab:
// its z is in units of 8, and near the camera whole rows share one z (row 9
// at offset 8 has z = 4 on all eight lines), which drew every edge upright.
.function wLine(h, i) {
    .var H = H_MIN + h
    .var d = ROAD_TOP + i - H
    .if (d <= 0) .return 0
    .return W0 * d / (L_NEAR - H)
}

.function gPair(dd, w) {
    .if (w == 0) .return 0
    .if (dd < w / 34) .return 3
    .if (dd < w) .return 1
    .if (dd < w + max(2, w / 7)) .return 2
    .return 0
}

// The eight bytes of left column k (phase p) on a row whose lines have
// half-widths ws, as a string key "b0,b1,...,b7"; keyBytes keeps the bytes.
.var keyBytes = Hashtable()
.function gKey(ws, k, p) {
    .var s = ""
    .var bytes = List()
    .for (var l = 0; l < 8; l++) {
        .var b = 0
        .for (var q = 0; q < 4; q++) {
            .var xc = -8 * k + 2 * q + 1 - 4 * p
            .eval b = b * 4 + gPair(abs(xc), ws.get(l))
        }
        .if (l > 0) .eval s = s + ","
        .eval s = s + b
        .eval bytes.add(b)
    }
    .if (!keyBytes.containsKey(s)) .eval keyBytes.put(s, bytes)
    .return s
}

.var G_GRASS = "0,0,0,0,0,0,0,0"
.var G_ROAD  = "85,85,85,85,85,85,85,85"

// tplKeys[(hh * 12 + r) * 2 + p]: the row's left column keys, k0 to 23.
.var tplKeys = List()
.var rowKeys = List()           // per row: Hashtable of its glyph keys
.for (var r = 0; r < 12; r++) .eval rowKeys.add(Hashtable())
.for (var hh = 0; hh < HN; hh++) {
    .for (var r = 0; r < 12; r++) {
        .var ws = List()
        .for (var l = 0; l < 8; l++) .eval ws.add(wLine(hh * HSTEP, r * 8 + l))
        .for (var p = 0; p < 2; p++) {
            .var keys = List()
            .for (var k = 1 - p; k < KMAX; k++) {
                .var key = gKey(ws, k, p)
                .eval keys.add(key)
                .if (key != G_GRASS && key != G_ROAD) .eval rowKeys.get(r).put(key, 1)
            }
            .eval tplKeys.add(keys)
        }
    }
}

// Rows to sets, in order, each set under GCAP; then an id per key per set.
.var rowSet = List()
.var setIds = List()            // per set: Hashtable key -> id
.var setKeys = List()           // per set: List of keys in id order
.eval setIds.add(Hashtable())
.eval setKeys.add(List())
.for (var r = 0; r < 12; r++) {
    .var ks = rowKeys.get(r).keys()
    .var fresh = 0
    .for (var i = 0; i < ks.size(); i++) {
        .if (!setIds.get(setIds.size() - 1).containsKey(ks.get(i))) .eval fresh++
    }
    .if (setKeys.get(setKeys.size() - 1).size() + fresh > GCAP) {
        .eval setIds.add(Hashtable())
        .eval setKeys.add(List())
    }
    .var s = setIds.size() - 1
    .for (var i = 0; i < ks.size(); i++) {
        .if (!setIds.get(s).containsKey(ks.get(i))) {
            .eval setIds.get(s).put(ks.get(i), GBASE + setKeys.get(s).size())
            .eval setKeys.get(s).add(ks.get(i))
        }
    }
    .eval rowSet.add(s)
}
.if (setKeys.size() > SET_ADDR.size()) .error "road glyphs need " + setKeys.size() + " sets; there are " + SET_ADDR.size()
.var GSETS = setKeys.size()
.var sizes = List()
.for (var i = 0; i < GSETS; i++) .eval sizes.add(setKeys.get(i).size())
.print "road glyphs: " + GSETS + " sets of " + sizes + "; rows to sets " + rowSet

// ---- data ---------------------------------------------------------------------------
.function tplCode(s, key) {
    .if (key == G_GRASS) .return 0
    .if (key == G_ROAD) .return 1
    .return setIds.get(s).get(key)
}
// Each template's bytes, and its offset from tpl_data (0: the blank one).
.var tplBytes = List()
.var tplOff = List()
.var tplLen = 3                 // tpl_data starts with the blank template: 0, 0, 0
.for (var t = 0; t < HN * 24; t++) {
    .var keys = tplKeys.get(t)
    .var s = rowSet.get(floor(t / 2) - floor(t / 24) * 12)
    .var n = keys.size()
    .while (n > 0 && keys.get(n - 1) == G_GRASS) .eval n--
    .var b = List()
    .if (n > 0) {
        .var n1 = 0
        .while (n1 < n && keys.get(n1) != G_ROAD) .eval n1++
        .var e = n1
        .while (e < n && keys.get(e) == G_ROAD) .eval e++
        .eval b.add(n1)
        .for (var k = 0; k < n1; k++) .eval b.add(tplCode(s, keys.get(k)))
        .eval b.add(e - n1)
        .eval b.add(n - e)
        .for (var k = e; k < n; k++) .eval b.add(tplCode(s, keys.get(k)))
        .eval tplOff.add(tplLen)
        .eval tplLen = tplLen + b.size()
    } else {
        .eval tplOff.add(0)
    }
    .eval tplBytes.add(b)
}
.var glyphOff = List()
.var gl = 0
.for (var i = 0; i < GSETS; i++) {
    .eval glyphOff.add(gl)
    .eval gl = gl + setKeys.get(i).size() * 8
}
.eval rowSet.lock()
.eval glyphOff.lock()
.eval tplOff.lock()
.eval tplBytes.lock()
.eval setKeys.lock()
.eval keyBytes.lock()
.print "road templates: " + tplLen + " bytes; glyph data " + gl + " bytes"

// Each set's glyphs, stored by line: eight tables per set, table l holding
// byte l of every id from 0 (0 grass, 1 road, 2-4 the hills, 5 up the set's
// left glyphs). The builder's sheared rows read a glyph's line with one
// indexed load (builder.asm dyn_glyph); glyph_init fills the sets from them.
// Then the templates, then the tables that point into both (after the data,
// so every label is known).
.function hillByte(g, r) {
    .var n = (r >> 1) + 1       // pairs filled on this row, 1-4
    .var rise = 0
    .var fall = 0
    .for (var p = 0; p < n; p++) {
        .eval rise = rise | (3 << (2 * p))
        .eval fall = fall | (3 << (6 - 2 * p))
    }
    .return g == 0 ? $ff : (g == 1 ? rise : fall)
}
.function idByte(s, id, l) {
    .if (id == 0) .return 0
    .if (id == 1) .return $55
    .if (id < GBASE) .return hillByte(id - 2, l)
    .return keyBytes.get(setKeys.get(s).get(id - GBASE)).get(l)
}
.var gtOff = List()             // gtOff[s * 8 + l]: table (s, l) from glyph_t
.var gto = 0
.for (var s = 0; s < GSETS; s++) {
    .for (var l = 0; l < 8; l++) {
        .eval gtOff.add(gto)
        .eval gto = gto + GBASE + setKeys.get(s).size()
    }
}
.eval gtOff.lock()
glyph_t:
.for (var s = 0; s < GSETS; s++) {
    .for (var l = 0; l < 8; l++) {
        .fill GBASE + setKeys.get(s).size(), idByte(s, i, l)
    }
}
tpl_data:   .byte 0, 0, 0
.for (var t = 0; t < HN * 24; t++) {
    .for (var i = 0; i < tplBytes.get(t).size(); i++) .byte tplBytes.get(t).get(i)
}
glyph_rowset: .fill 12, rowSet.get(i)
glyph_n:      .fill GSETS, GBASE + setKeys.get(i).size()   // ids per set
gt_lo:        .fill GSETS * 8, <(glyph_t + gtOff.get(i))     // table (set, line)
gt_hi:        .fill GSETS * 8, >(glyph_t + gtOff.get(i))
// Templates: tpl_lo/hi[(hh * 12 + r) * 2 + p].
tpl_lo:     .fill HN * 24, <(tpl_data + tplOff.get(i))
tpl_hi:     .fill HN * 24, >(tpl_data + tplOff.get(i))

// ---- glyph_init: the sets, once, with interrupts off ----------------------------------
// Each set: every id from glyph_t, and its mirror at id + $80; the ids past
// the set's own are grass. $D000-$DFFF is under I/O: written with $01 = $34
// (all RAM), and no interrupt may come while it is (c64-kb
// irq_during_charen_window). Leaves $01 = $35.
.function mirrorByte(b) {
    .return ((b & 3) << 6) | ((b & 12) << 2) | ((b & 48) >> 2) | ((b & 192) >> 6)
}
.align $100
mirror_tab: .fill 256, mirrorByte(i)

glyph_init:
        lda #$34
        sta $01
    .for (var s = 0; s < GSETS; s++) {
        .var base = SET_ADDR.get(s)
        lda #0
        tax
!:
      .for (var pg = 0; pg < 8; pg++) { sta base + pg * 256, x }
        inx
        bne !-
        lda #<base
        sta zp_scr
        lda #>base
        sta zp_scr + 1
        lda #<(base + $400)
        sta zp_code
        lda #>(base + $400)
        sta zp_code + 1
        ldx #0                  // the id
!id:
      .for (var l = 0; l < 8; l++) {
        ldy #l
        lda glyph_t + gtOff.get(s * 8 + l), x
        sta (zp_scr), y
        stx zp_t4
        tax
        lda mirror_tab, x
        ldx zp_t4
        sta (zp_code), y
      }
        lda zp_scr
        clc
        adc #8
        sta zp_scr
        bcc !+
        inc zp_scr + 1
!:      lda zp_code
        clc
        adc #8
        sta zp_code
        bcc !+
        inc zp_code + 1
!:      inx
        cpx glyph_n + s
        beq !+
        jmp !id-
!:
    }
        // the two dynamic sets: grass everywhere, road at 1 and $81 (set
        // B's id 255 lies under the vectors and is never used: not cleared)
    .for (var s = 0; s < 2; s++) {
        .var base = s == 0 ? DYN_A : DYN_B
        lda #0
        tax
!:
      .for (var pg = 0; pg < 7; pg++) { sta base + pg * 256, x }
      .if (s == 0) {
        sta base + 7 * 256, x
      } else {
        cpx #$f8                // set B's last page ends at the vectors: $FFF8 up is left
        bcs !+
        sta base + 7 * 256, x
!:
      }
        inx
        bne !-
        lda #$55
        ldx #7
!:      sta base + 8, x
        sta base + $408, x
        dex
        bpl !-
    }
        lda #$35
        sta $01
        rts
