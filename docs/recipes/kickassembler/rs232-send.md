---
recipe: rs232-send
toolchain: kickassembler
output_format: PRG
region: both
techniques: []
file_formats: [PRG]
uses_registers: [DD00, DD04, DD05, DD0D, DD0E, DC06, DC07, DC0F, D011]
uses_kernal: [SETLFS, SETNAM, OPEN, CHKOUT, CHROUT, CLRCHN, CLOSE, READST]
devices: [rs232_userport]
claims: [cia2_timer_a (owns), cia2_timer_b (init), cia2_tod (init), vic_raster_irq (init), cia2_vic_bank (shares), serial_bus (shares)]
harness: [cia1_timer_b, $02FF]
---

<!-- doc-type: recipe -->

# KickAssembler RS-232 Send: KERNAL Driver and Bit-Banged

## Synopsis

Send a line out of the user port's RS-232 transmit pin at 1200 baud,
8 data bits, no parity, 1 stop bit, twice: first through the KERNAL's
driver (OPEN on device 2 with the control and command registers as the
file name, CHKOUT, CHROUT, then wait for the transmit NMI to finish),
then with a routine of its own that holds each bit for one period of
CIA 2 timer A and writes it to PA2. VICE's user-port RS-232 device
decodes the pin at 1200 baud and writes what it receives to a file, so
both lines can be compared byte for byte on the host. The screen shows
each line's byte count and duration. Use the KERNAL half to talk to a
modem or a PC at up to 1200 baud without writing any timing code, and
the bit-banged half as the model for a transmit routine that runs with
interrupts off.

## Source

```asm
// rs232-send.asm
// Send one line through the KERNAL's RS-232 driver at 1200 baud, 8N1, and
// time it from the first CHROUT until the driver's transmit NMI is off.
// Then close the channel and send a second line with a bit-banged routine
// on the same pin (PA2 of CIA 2, user port pin M), paced by CIA 2 timer A.
BasicUpstart2(start)

.const SETLFS = $ffba
.const SETNAM = $ffbd
.const OPEN   = $ffc0
.const CLOSE  = $ffc3
.const CHKOUT = $ffc9
.const CLRCHN = $ffcc
.const CHROUT = $ffd2
.const READST = $ffb7

.const ENABL   = $02a1           // KERNAL RS-232 NMI flags; bit 0 set while transmitting
.const PALNTSC = $02a6           // KERNAL: 1 on PAL, 0 on NTSC
.const VERDICT = $02ff

start:
    lda #$93
    jsr CHROUT
    ldx #<title
    ldy #>title
    jsr print_z

    // --- 1. KERNAL: OPEN 2,2,0 with control $08 (1200 baud, 8 data bits,
    //        1 stop bit) and command $00 (3-line, full duplex, no parity)
    lda #2
    ldx #2
    ldy #0
    jsr SETLFS
    lda #2
    ldx #<params
    ldy #>params
    jsr SETNAM
    jsr OPEN
    ldx #2
    jsr CHKOUT
    jsr t_start
    ldy #0
k_send:
    lda line_k,y
    beq k_sent
    jsr CHROUT
    iny
    bne k_send
k_sent:
    sty k_len
    jsr CLRCHN
k_wait:
    jsr t_tick
    lda ENABL
    and #$01
    bne k_wait                   // the NMI clears bit 0 after the last stop bit
    jsr t_stop
    ldx #2
k_copy:
    lda t_cyc,x
    sta k_cyc,x
    dex
    bpl k_copy
    jsr READST
    sta k_st
    lda #2
    jsr CLOSE

    ldx #<lbl_kernal
    ldy #>lbl_kernal
    jsr print_z
    lda k_len
    ldx #<k_cyc
    jsr print_count
    lda #<lbl_st
    ldx #>lbl_st
    jsr print_zax
    lda k_st
    jsr print_hex
    lda #$0d
    jsr CHROUT

    // --- 2. bit-banged: 8N1 at 1200 baud on PA2, SEI, screen blanked -------
    ldx PALNTSC
    lda bit_lo,x                 // the latch is cycles per bit - 1: a continuous
    sta $dd04                    // timer underflows every latch + 1 cycles
    lda bit_hi,x
    sta $dd05
    sei
    lda #$7f
    sta $dd0d                    // no CIA 2 NMI: the underflow flag is polled
    lda $d011
    and #%11101111
    sta $d011
    lda #%00010001               // timer A: continuous, force load, start
    sta $dd0e
    lda $dd0d                    // clear any pending flag
    jsr t_start
    ldy #0
b_send:
    lda line_b,y
    beq b_sent
    jsr bb_byte
    iny
    bne b_send
b_sent:
    sty b_len
    jsr bb_wait                  // the stop bit of the last byte lasts one more period
    jsr t_stop
    lda #0
    sta $dd0e
    lda $d011
    ora #%00010000
    sta $d011
    cli

    ldx #<lbl_bitbang
    ldy #>lbl_bitbang
    jsr print_z
    lda b_len
    ldx #<t_cyc
    jsr print_count
    lda #$0d
    jsr CHROUT

    // verdict: both lines went out and the KERNAL reported status 0. What
    // arrived is checked on the host, in the file VICE's RS-232 device wrote.
    lda k_st
    bne finish
    lda k_len
    cmp #line_k_end-line_k
    bne finish
    lda b_len
    cmp #line_b_end-line_b
    bne finish
    lda #1
    sta VERDICT
    lda #5
    sta $d020
    ldx #<lbl_ok
    ldy #>lbl_ok
    jsr print_z
finish:
    rts

// --- one byte, 8N1, LSB first: start bit 0, eight data bits, stop bit 1.
// Each level is written right after a timer A underflow, so each bit lasts
// one timer period.
bb_byte:
    sta shift
    lda #0
    jsr bb_bit                   // start bit
    lda #8
    sta nbits
bb_data:
    lda #0
    lsr shift
    rol                          // A = the next data bit
    jsr bb_bit
    dec nbits
    bne bb_data
    lda #1                       // stop bit
bb_bit:
    sta level
    jsr bb_wait
    lda level
    beq bb_low
    lda $dd00
    ora #%00000100
    sta $dd00
    rts
bb_low:
    lda $dd00
    and #%11111011
    sta $dd00
    rts
bb_wait:
    jsr t_tick
    lda $dd0d
    and #$01
    beq bb_wait
    rts

// --- CIA 1 timer B counts cycles down from $FFFF; t_tick, called at least
// once per 65,536 cycles, counts its wraps in software. CIA 1 timer A is the
// KERNAL's jiffy clock and CIA 2's timers belong to the RS-232 driver.
t_start:
    lda #$ff
    sta $dc06
    sta $dc07
    sta t_last
    lda #0
    sta t_wraps
    lda #%00010001               // timer B: continuous, force load, start, count cycles
    sta $dc0f
    rts
t_tick:
    pha
    lda $dc07
    cmp t_last
    beq tk_same
    bcc tk_down
    inc t_wraps                  // the high byte went up: the counter wrapped
tk_down:
    sta t_last
tk_same:
    pla
    rts
t_stop:
    jsr t_tick
    lda #0
    sta $dc0f
    lda $dc06
    eor #$ff
    sta t_cyc
    lda $dc07
    eor #$ff
    sta t_cyc+1
    lda t_wraps
    sta t_cyc+2
    rts

// --- "nn BYTES IN $xxxxxx": A = count, X = low byte of a 3-byte counter
print_count:
    stx pc_ptr+1
    jsr print_hex
    lda #<lbl_in
    ldx #>lbl_in
    jsr print_zax
    ldx #2
pc_loop:
pc_ptr:
    lda t_cyc,x                  // self-modified: the counter's base
    jsr print_hex
    dex
    bpl pc_loop
    rts

print_hex:
    pha
    lsr
    lsr
    lsr
    lsr
    jsr ph_digit
    pla
    and #15
ph_digit:
    cmp #10
    bcc ph_num
    adc #6
ph_num:
    adc #'0'
    jmp CHROUT

print_zax:
    sta pz+1
    stx pz+2
    jmp pz
print_z:
    stx pz+1
    sty pz+2
pz: lda $ffff
    beq pz_done
    jsr CHROUT
    inc pz+1
    bne pz
    inc pz+2
    bne pz
pz_done:
    rts

// 1200 baud: PAL 985,248 / 1200 = 821 cycles a bit, NTSC 1,022,727 / 1200 = 852.
bit_lo: .byte <(852-1), <(821-1)
bit_hi: .byte >(852-1), >(821-1)
params: .byte $08, $00

.encoding "ascii"
line_k: .text "KERNAL 1200 8N1"
        .byte $0d
line_k_end:
        .byte 0
line_b: .text "BIT-BANGED 1200 8N1"
        .byte $0d
line_b_end:
        .byte 0

.encoding "petscii_upper"
title:       .text "RS-232 SEND"
             .byte $0d, 0
lbl_kernal:  .text "KERNAL  $"
             .byte 0
lbl_bitbang: .text "BITBANG $"
             .byte 0
lbl_in:      .text " BYTES IN $"
             .byte 0
lbl_st:      .text " ST="
             .byte 0
lbl_ok:      .text "OK"
             .byte $0d, 0

.align $100
t_cyc:   .byte 0, 0, 0
k_cyc:   .byte 0, 0, 0
shift:   .byte 0
level:   .byte 0
nbits:   .byte 0
k_len:   .byte 0
k_st:    .byte 0
b_len:   .byte 0
t_last:  .byte 0
t_wraps: .byte 0
```

## Build

```bash
java -jar $KICKASS_JAR rs232-send.asm -o rs232-send.prg
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 \
  -userportdevice 2 -rsuserdev 0 -rsdev1 rs.out -rsuserbaud 1200 \
  -exitscreenshot rs232-send.png -autostart rs232-send.prg
```

Add `-model ntsc` for the NTSC run. `-userportdevice 2` plugs VICE's
"Userport RS232/Modem" into the user port, `-rsuserdev 0` connects it to
RS-232 device 1, `-rsdev1 rs.out` makes that device a file (VICE opens it
with `O_CREAT | O_TRUNC`, `src/arch/shared/rs232-unix-dev.c`), and
`-rsuserbaud 1200` is the rate VICE samples the transmit pin at. The run
is pinned in `../runs.json` with these flags.

## Expected output

```
RS-232 SEND
KERNAL  $10 BYTES IN $020476 ST=00
BITBANG $14 BYTES IN $0284C4
OK
```

`rs.out` holds 36 bytes, the same on both models and on two runs of
each: `KERNAL 1200 8N1`, `$0D`, `BIT-BANGED 1200 8N1`, `$0D`, in ASCII
because the listing's `.encoding "ascii"` sent ASCII (VICE only reverses
the bit order it sampled; it translates nothing). `OK` and a green
border mean `$02FF` holds `01`; the file is the real check.

| | PAL | NTSC | 10 bits × bit time |
|---|---|---|---|
| KERNAL, 16 bytes, first CHROUT to transmit NMI off | 132,214 cycles (`$020476`) | 136,965 (`$021705`) | 131,360 / 136,320 |
| bit-banged, 20 bytes and one closing period | 165,060 (`$0284C4`) | 171,274 (`$029D0A`) | 165,021 / 171,252 |

Measured with VICE x64sc 3.10 and the pinned command (rung 1). Two runs
per model gave byte-identical screenshots and files; every character
cell was decoded against the character ROM. The screenshots are
`screenshots/rs232-send.png` and `screenshots/rs232-send-ntsc.png`.

## Why this works

The KERNAL treats device 2 as RS-232: the first two bytes of the file
name are the 6551-style control register (`$08`: 1200 baud, 8 data
bits, 1 stop bit) and command register (`$00`: 3-line handshake, full
duplex, no parity). CHROUT puts a byte in the driver's transmit buffer
and returns; the transmit NMI, paced by CIA 2 timer A, puts one bit on
PA2 per period. CLRCHN therefore returns long before the line is out,
and bit 0 of `$02A1` stays set until the NMI has sent the last stop
bit. The listing waits on that bit before CLOSE. Without the wait,
CLOSE came 3,240 cycles after the first CHROUT and none of the 16 bytes
arrived: VICE's file held one `$FF` and then the bit-banged line
(measured, PAL). The KERNAL's 16 bytes took 854 cycles more than 160 bit
times on PAL and 645 on NTSC: the wait for the first timer period and
the NMI's own entry, with the screen on and the KERNAL IRQ running.

The bit-banged half does the same job with no interrupts. It sets timer
A of CIA 2 to run continuously with a latch of one bit time less one
(820 on PAL, 851 on NTSC; a continuous timer underflows every latch + 1
cycles), masks CIA 2's NMI with `$7F` to `$DD0D` and polls the underflow
flag, writing each level to PA2 right after an underflow. Each bit is
therefore exactly one timer period long, whatever the loop costs between
underflows, as long as the loop is shorter than one period. The screen
is blanked and interrupts are off so that nothing delays a write by
more than a few cycles; VICE samples each bit in its middle (`rsuser.c`,
`bit_clk_ticks / 2`), so the margin is half a bit, 410 cycles on PAL.
The routine writes PA2 by read-modify-write of `$DD00`, which leaves the
VIC bank bits and the serial bus lines as they were; the claims list
them as `shares` for that reason (the claims watch saw no store change
either unit's bits).

The KERNAL's receive side was tried in the same VICE set-up and did
not deliver a byte: a pipe to `cat` echoing the transmitted line, a pipe
to `printf` sending one, 300 and 1200 baud, 3-line and x-line modes,
and the program raising RTS and DTR itself all left the receive buffer
empty after two seconds, with status `$08` or `$0A`. VICE only feeds its
receive line while it sees RTS active (`rsuser.c`, `int_rsuser`), and
the cause was not found here, so receiving is not measured on this
page. The user-port lines VICE's device uses are listed under
`../../hardware/cia-reference.md`, "RS-232 on the user port".
