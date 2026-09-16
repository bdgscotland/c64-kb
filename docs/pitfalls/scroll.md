---
category: scroll
---

<!-- doc-type: pitfall-reference -->

# Scroll Pitfalls

Two register-level traps that bite every first-time C64 soft-scroller. The
$D016 XSCROLL field is global — there is no per-row scroll register on the
VIC-II — and the same register carries the CSEL and MCM bits that govern
column width and graphics mode. Both pitfalls below stem from agents (and
junior demo coders) assuming $D016 behaves like a dedicated scroll register
when it does not.

---

## xscroll_applies_to_all_rows — Writing $D016 globally shifts every text row, not just the scroller

**Severity:** medium
**Region:** both
**Triggered by registers:** D016, SCROLX
**Triggered by techniques:** soft_scroll_h, infinite_scroll_h, char_scroll_buffer_h

### Symptom

A horizontal soft-scroller works on the dedicated scroller row, but every
other text row on the screen (titles, score panels, status bars) jitters
horizontally in lockstep with the scroller. Most visibly: every 8 frames,
when XSCROLL wraps from 0 back to 7, the static text rows appear to "snap
back" by 8 pixels. The scroller itself looks correct because its screen
RAM is being shifted in sync; the static rows have no compensating shift.

### Mechanism

$D016 bits 2-0 (XSCROLL) shift the entire 40-column display area
horizontally. The VIC-II does not have a per-row scroll register. Whatever
value lives in XSCROLL when the beam draws a given character row is the
horizontal offset that row gets. If the main loop writes XSCROLL once per
frame, ALL 25 rows render with that offset. The scroller's screen-RAM
column shift compensates for XSCROLL=0→7 wraparound on the scroller row;
but a static title or HUD row has no such compensation and the wraparound
becomes a visible snap.

### Fix

Gate XSCROLL with a raster IRQ: set it to the desired value before the
scroller row's first raster line, then reset it to 0 before the next row
starts. Two more IRQ slots, no per-frame CPU cost beyond the slot dispatch.

```c
// Row 22 spans raster lines 227..234. scroll_set fires at 226 → applies
// at line 227 (top of row 22). scroll_reset fires at 234 → applies at
// line 235 (top of row 23).
rirq_build(&scroll_set_slot, 1);
rirq_write(&scroll_set_slot, 0, &vic.ctrl2, D016_BASE | xscroll_value);
rirq_set(slot_n, 226, &scroll_set_slot);

rirq_build(&scroll_reset_slot, 1);
rirq_write(&scroll_reset_slot, 0, &vic.ctrl2, D016_BASE);  // XSCROLL=0
rirq_set(slot_n + 1, 234, &scroll_reset_slot);
```

In the main loop, update only the data byte of the scroll_set slot — don't
write $D016 directly anywhere outside the raster IRQ:

```c
rirq_data(&scroll_set_slot, 0, D016_BASE | xscroll_value);
```

### Worked example

```c
// BAD: globally-applied XSCROLL causes title and HUD jitter
for (;;) {
    rirq_wait();
    if (xscroll == 0) { shift_screen_row(); xscroll = 7; } else xscroll--;
    vic.ctrl2 = (vic.ctrl2 & 0xF8) | xscroll;  // affects ALL rows
}

// GOOD: XSCROLL only nonzero between rows 22 and 23
for (;;) {
    rirq_wait();
    if (xscroll == 0) { shift_screen_row(); xscroll = 7; } else xscroll--;
    rirq_data(&scroll_set_slot, 0, D016_BASE | xscroll);  // gated by IRQ
}
```

### Cross-references

- Register: `D016` (SCROLX — XSCROLL + CSEL + MCM)
- Technique: `soft_scroll_h` — base soft-scroll technique
- Technique: `infinite_scroll_h` — soft + buffer combined
- Technique: `char_scroll_buffer_h` — character-mode horizontal scroll
- Related pitfall: `d016_unmasked_rmw_clobbers_csel_mcm` (this doc)

---

## d016_unmasked_rmw_clobbers_csel_mcm — Writing $D016 without masking destroys CSEL and MCM

**Severity:** high
**Region:** both
**Triggered by registers:** D016, SCROLX
**Triggered by techniques:** soft_scroll_h, infinite_scroll_h, char_scroll_buffer_h

### Symptom

Writing the XSCROLL value directly to $D016 each frame causes the display
to switch into a different graphics mode or column width. Symptoms vary
by which bits are clobbered: clobbering CSEL (bit 3) toggles between 38
and 40 column mode, producing 2-pixel border breathing on each frame.
Clobbering MCM (bit 4) flips between high-resolution and multicolor mode
mid-frame; bitmap and sprite-multicolor displays go to garbage.

### Mechanism

$D016 packs three independent fields into one register:

| Bits | Field | Purpose |
|------|-------|---------|
| 2-0  | XSCROLL | Fine horizontal scroll (0-7 pixels) |
| 3    | CSEL  | 0 = 38-column mode, 1 = 40-column mode |
| 4    | MCM   | 0 = hires, 1 = multicolor |

The naive `STA $D016` or `vic.ctrl2 = xscroll` zeroes CSEL and MCM along
with bits 5-7. The KERNAL boot leaves CSEL=1 and MCM=0 (40-col hires);
writing 0..7 directly resets to 38-col hires and flickers the borders by
1 character column.

### Fix

Read-modify-write with a 0xF8 mask to clear only the XSCROLL field:

```c
vic.ctrl2 = (vic.ctrl2 & 0xF8) | xscroll;       // C, Oscar64
```

```kick
lda $d016                                       // assembly
and #$f8
ora xscroll
sta $d016
```

For multicolor or 38-col mode, hard-code the appropriate base byte
instead of reading $D016 every time (saves 4 cycles):

```c
#define D016_BASE  0xC8     // CSEL=1, MCM=0, bits 5-7 ignored on write
vic.ctrl2 = D016_BASE | xscroll;
```

Bits 5-7 of $D016 are read as 1 but ignored on write, so any base byte
in `[0x00, 0xFF]` with the right CSEL/MCM bits is fine.

### Worked example

```c
// BAD: clobbers CSEL on every write — display flickers between
// 38 and 40 column modes every frame.
vic.ctrl2 = xscroll;

// GOOD: mask preserves CSEL, MCM.
vic.ctrl2 = (vic.ctrl2 & 0xF8) | xscroll;

// BEST: const base byte avoids the read entirely.
vic.ctrl2 = 0xC8 | xscroll;
```

### Cross-references

- Register: `D016` (SCROLX — XSCROLL + CSEL + MCM)
- Technique: `soft_scroll_h` — see worked example in
  `recipes/oscar64/soft-scroll-h.md`
- Related pitfall: `xscroll_applies_to_all_rows` (this doc) — covers the
  per-row gating problem that the same register write creates.
