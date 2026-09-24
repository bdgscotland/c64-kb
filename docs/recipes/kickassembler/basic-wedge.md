---
recipe: basic-wedge
toolchain: kickassembler
output_format: PRG
region: both
techniques: [basic_extension_wedge]
file_formats: [PRG]
uses_registers: [D020, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — BASIC Wedge

## Synopsis

A BASIC extension that adds two commands behind a prefix character, `&B`
to set the border colour and `&C` to print and count a call, by pointing
the execute-statement vector at $0308 into its own code and handing every
other statement back to the ROM. The ROM's `IF ... THEN` path does not go
through that vector, so the error vector at $0300 is hooked as well and a
syntax error raised on the prefix is turned into the command. This is the
`basic_extension_wedge` technique. The page's BASIC test program is typed
through VICE's `-keybuf`: a plain statement, the command on its own, after
a colon, after `THEN`, an unknown letter behind the prefix (the ROM's own
error), and a 1,000-iteration `FOR` loop timed with the wedge off and on
from CIA 2's timers. The program's own checks gate its last `&C`, which
writes $01 to $02FF; $02 is what the installer put there.

Verified in VICE x64sc: the picture shows the four counts, `THEN OK`, the
two loop figures, `VERDICT 1`, `?SYNTAX  ERROR IN 90` and `READY.`, on
PAL and on NTSC, byte-identical on two runs per model.

## Source

```asm
// basic-wedge.asm
// A BASIC extension through the IGONE vector at $0308. Every statement
// BASIC executes arrives here first. Two commands are added behind a
// prefix character: &B <expr> sets the border colour, &C prints and
// counts a call. Anything else is handed back to the ROM's statement
// executor, so ordinary BASIC is untouched.
//
// The ROM's IF ... THEN path does not go through $0308 (it calls the
// executor at $A7ED directly), so a command after THEN reaches the ROM
// as a SYNTAX ERROR. The error vector at $0300 is hooked as well: a
// syntax error with the text pointer on the prefix is our command, the
// stack is restored to the level saved at the last statement dispatch
// and the command runs. Any other error, including the prefix with an
// unknown letter, goes to the ROM's own handler.
//
// SYS 49152 enables, SYS 49155 disables, SYS 49158 latches CIA 2's
// 32-bit timer into $02F0-$02F3 for timing from BASIC. $02FF holds a
// verdict: $02 at install, $01 once &C has been reached the number of
// times the test program expects.
//
// Region: both. Nothing here is cycle-exact.

.const CHRGET  = $0073            // advance TXTPTR, fetch the byte
.const CHRGOT  = $0079            // re-fetch the current byte
.const TXTPTR  = $7a
.const IERROR  = $0300            // BASIC error vector
.const IGONE   = $0308            // BASIC execute-statement vector
.const EXECUTE = $a7ed            // ROM: run one statement, A = first byte
.const NEWSTT  = $a7ae            // ROM: fetch and dispatch the next statement
.const SYNERR  = $af08            // ROM: LDX #$0B, JMP error
.const GETBYT  = $b79e            // ROM: evaluate an expression to a byte in X
.const LINPRT  = $bdcd            // ROM: print A (hi) / X (lo) in decimal
.const PRTCR   = $aad7            // ROM: print a carriage return
.const OLDGONE = $a7e4            // ROM default of $0308
.const PREFIX  = '&'
.const EXPECT  = 4                // &C calls the test program makes
.const LATCH   = $02f0
.const VERDICT = $02ff
.const CIA2TA  = $dd04

.pc = $0801 "basic"
:BasicUpstart(install)

.pc = $0810 "installer"
install:
    ldx #0                        // copy the resident part to $C000
copy:
    lda body,x
    sta $c000,x
    lda body+$100,x
    sta $c100,x
    inx
    bne copy
    lda #2                        // verdict: red until proven
    sta VERDICT
    lda #$ff                      // CIA 2 timer A counts cycles, timer B
    sta CIA2TA                    // counts A's underflows: one 32-bit
    sta CIA2TA+1                  // down-counter, no interrupt enabled
    sta CIA2TA+2
    sta CIA2TA+3
    lda #$51                      // B: force load, count A underflows, start
    sta $dd0f
    lda #$11                      // A: force load, count clock, start
    sta $dd0e
    jmp enable

body:
.pseudopc $c000 {
    jmp enable                    // SYS 49152
    jmp disable                   // SYS 49155
    jmp latch                     // SYS 49158

enable:
    lda IGONE                     // already ours? then nothing to save
    cmp #<wedge
    bne save
    lda IGONE+1
    cmp #>wedge
    beq installed
save:
    lda IGONE
    sta oldgone
    lda IGONE+1
    sta oldgone+1
    lda IERROR
    sta olderr
    lda IERROR+1
    sta olderr+1
    sei
    lda #<wedge
    sta IGONE
    lda #>wedge
    sta IGONE+1
    lda #<errhook
    sta IERROR
    lda #>errhook
    sta IERROR+1
    cli
installed:
    rts

disable:
    lda IGONE
    cmp #<wedge
    bne notours
    sei
    lda oldgone
    sta IGONE
    lda oldgone+1
    sta IGONE+1
    lda olderr
    sta IERROR
    lda olderr+1
    sta IERROR+1
    cli
notours:
    rts

// Every statement arrives here. The ROM's own $A7E4 is JSR CHRGET,
// JSR EXECUTE, JMP NEWSTT; the wedge adds the stack save and one
// compare on the fall-through path.
wedge:
    tsx
    stx savesp
    jsr CHRGET
    cmp #PREFIX
    beq command
    jsr EXECUTE
    jmp NEWSTT

// TXTPTR is on the prefix. Fetch the letter and dispatch.
command:
    jsr CHRGET
    cmp #'B'
    beq border
    cmp #'C'
    beq counter
    jmp SYNERR                    // unknown letter: the ROM's own error

border:
    jsr CHRGET                    // step onto the expression
    jsr GETBYT                    // X = value, TXTPTR past it
    stx $d020
    jmp NEWSTT

counter:
    jsr CHRGET                    // step past the letter
    jsr latch
    inc count
    jsr PRTCR
    lda #0
    ldx count
    jsr LINPRT
    jsr PRTCR
    lda #2
    ldx count
    cpx #EXPECT
    bne verdict
    lda #1
verdict:
    sta VERDICT
    jmp NEWSTT

// Error hook. X is the error number; $0B is SYNTAX ERROR. Ours only if
// the text pointer sits on the prefix and the letter is one we know.
errhook:
    cpx #$0b
    bne pass
    jsr CHRGOT
    cmp #PREFIX
    bne pass
    ldy #1
    lda (TXTPTR),y
    cmp #'B'
    beq ours
    cmp #'C'
    beq ours
pass:
    jmp (olderr)
ours:
    ldx savesp                    // back to the statement level
    txs
    jmp command

// Copy CIA 2's 32-bit count to LATCH, low byte first. Re-read until the
// high bytes agree, so a borrow between reads cannot split the value.
latch:
    lda CIA2TA+3
    sta LATCH+3
    lda CIA2TA+2
    sta LATCH+2
    lda CIA2TA+1
    sta LATCH+1
    lda CIA2TA
    sta LATCH
    lda CIA2TA+1
    cmp LATCH+1
    bne latch
    lda CIA2TA+2
    cmp LATCH+2
    bne latch
    rts

count:   .byte 0
savesp:  .byte 0
oldgone: .word OLDGONE
olderr:  .word $e38b
}
bodyend:
.errorif bodyend - body > $200, "resident part is larger than the copy loop"
```

## Build

```bash
java -jar KickAss.jar basic-wedge.asm -o basic-wedge.prg
```

The run types the test program into the KERNAL keyboard queue after the
PRG has installed the wedge and returned to `READY.`. Lines are separated
by `\x0d` (RETURN); the string ends in `run` and then `wait 198,1`, which
the editor reads after the program has stopped and which keeps the
screen still (a blinking cursor would otherwise make the pinned frame
depend on its phase). The program the string carries:

```text
new
10 print chr$(147);"wedge test"
20 &c
30 &b 2:&c
40 if (peek(53280)and15)=2 then &c:print "then ok"
50 sys 49155:gosub 200:t0=t:for i=1 to 1000:a=i:next:gosub 200:t1=t0-t
60 sys 49152:gosub 200:t0=t:for i=1 to 1000:a=i:next:gosub 200:t2=t0-t
70 print "loop off";t1:print "loop on";t2:print "diff";t2-t1
80 if (peek(53280)and15)=2 and t2>t1 then &c
85 print "verdict";peek(767)
90 &b 13:&z
100 print "not reached"
200 sys 49158:t=peek(752)+256*peek(753)+65536*peek(754):return
run
wait 198,1
```

Pinned command (`-model ntsc` for NTSC), 20,000,000 cycles, the string
quoted for the shell so that VICE sees the backslashes:

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
  -limitcycles 20000000 \
  -keybuf 'new\x0d10 print chr$(147);"wedge test"\x0d20 &c\x0d30 &b 2:&c\x0d40 if (peek(53280)and15)=2 then &c:print "then ok"\x0d50 sys 49155:gosub 200:t0=t:for i=1 to 1000:a=i:next:gosub 200:t1=t0-t\x0d60 sys 49152:gosub 200:t0=t:for i=1 to 1000:a=i:next:gosub 200:t2=t0-t\x0d70 print "loop off";t1:print "loop on";t2:print "diff";t2-t1\x0d80 if (peek(53280)and15)=2 and t2>t1 then &c\x0d85 print "verdict";peek(767)\x0d90 &b 13:&z\x0d100 print "not reached"\x0d200 sys 49158:t=peek(752)+256*peek(753)+65536*peek(754):return\x0drun\x0dwait 198,1\x0d' \
  -exitscreenshot basic-wedge.png -autostart basic-wedge.prg
```

`peek(53280)` is masked with `and15` because the VIC's colour registers
read back with the upper four bits set (measured here: an unmasked test
read 242 for border colour 2 and the `THEN` line was skipped with no
error).

## Expected output

The border is light green (colour 13) because `&B 13` on line 90 ran
before `&Z` raised the error. Screen rows, decoded from the PAL exit
screenshot by matching cells against the character ROM:

```text
 0: WEDGE TEST
 2: 1
 4: 2
 6: 3
 7: THEN OK
 8: LOOP OFF 2474332
 9: LOOP ON 2494810
10: DIFF 20478
12: 4
13: VERDICT 1
15: ?SYNTAX  ERROR IN 90
16: READY.
17: WAIT 198,1
```

Each `&C` prints a carriage return, the count and another carriage
return, so the counts sit on alternate rows. Count 1 is line 20 (the
command alone), 2 is line 30 (after `&B 2:`), 3 is line 40 (after
`THEN`, and the `PRINT` after the colon on that line still ran), 4 is
line 80 (after `THEN`, gated by the border colour and the timing). Line
85 prints $02FF: 1, green. Line 90's `&Z` is an unknown letter, so the
wedge jumps to the ROM's syntax error and the ROM prints it with the
line number; line 100 never runs.

NTSC, same cycle count: identical rows except the loop figures, which
read `LOOP OFF 2494709`, `LOOP ON 2515573`, `DIFF 20864`.

### The per-statement cost

Between the two latches the interpreter dispatches 2,006 statements
through $0308: `T=...` and `RETURN` after the first latch, `T0=T`, `FOR`,
1,000 times `A=I` and `NEXT`, `GOSUB 200` and the `SYS` that latches
again. The measured difference is 20,478 cycles on PAL and 20,864 on
NTSC, which is 10.2 and 10.4 cycles per statement. The arithmetic for the
fall-through path is 10: `TSX` 2, `STX savesp` 4, `CMP #'&'` 2, `BEQ` not
taken 2; the `JSR $0073`, `JSR $A7ED` and `JMP $A7AE` are what the ROM's
own $A7E4 does anyway, and the `JMP ($0308)` is taken in both cases. The
418 and 804 cycles over the arithmetic are not explained on this page;
the two loops sit at different phases of the jiffy interrupt, and that
difference was not measured here. Both loops are 2.47 million cycles
long, so the wedge adds under one per cent to this loop.

Screenshots from the VICE runs this page describes:
`screenshots/basic-wedge.png` (PAL) and `screenshots/basic-wedge-ntsc.png`.

## Why this works

### The vector and the fall-through

The ROM's statement loop at $A7AE reads the byte at TXTPTR ($7A/$7B),
checks for end of line and colon, and reaches the executor through
`JMP ($0308)`. The default target, $A7E4, is three instructions: `JSR
$0073` (CHRGET, advance and fetch), `JSR $A7ED` (run the statement whose
first byte is in A) and `JMP $A7AE`. The wedge repeats those three and
puts one compare between the first two. A byte that is not the prefix
goes to $A7ED with A and TXTPTR exactly as the ROM would have had them,
so no ROM statement can tell the difference. A command handler must
leave TXTPTR on the statement's terminator (the colon or the line's zero
byte) before `JMP $A7AE`, which is why `counter` starts with a CHRGET to
step past its letter; without it the loop sees `C` where it wants a
colon and raises a syntax error itself (measured here, the first run
stopped at line 20 that way). `border` steps onto the expression and
calls the ROM's byte evaluator at $B79E, which leaves TXTPTR past the
expression, the same contract POKE relies on.

### Why THEN needs the error vector

The `IF` handler at $A928 evaluates the condition and, for a statement
after `THEN`, does `JSR $0079` (CHRGOT) and `JMP $A7ED`: the executor is
entered directly, not through $0308. Direct mode goes through the vector
(the main loop jumps to $A7E1), and a statement after a colon does, but
`THEN` does not. A prefix byte at $A7ED is below $80, so the ROM treats
it as an implied LET, its variable-name check fails on the first
character, and `JMP $AF08` loads X with $0B and reaches `JMP ($0300)` at
$A437. The hook there sees X = $0B, CHRGOT returns the prefix because
neither LET nor the name check moved TXTPTR, and the letter behind it is
one the wedge knows. The stack is then set back to the value saved at
the last pass through the wedge, which is the level the statement loop
had when it dispatched the `IF`, so the pushed return into LET is
discarded and any `FOR` or `GOSUB` frames beneath it survive. The handler
runs and ends in `JMP $A7AE` as it would have from the vector, so a
colon after the command on the same line is executed too. An unknown
letter, or any error that is not a syntax error, is passed to the saved
vector, so the ROM's own message with its line number appears; in the
picture that is line 90.

### The timer

CIA 2's timer A counts system clocks from $FFFF down and reloads; timer B
counts A's underflows, so the two together are one 32-bit down-counter
and no interrupt is enabled. `latch` copies the four bytes to $02F0 and
re-reads the two high bytes until they agree with the copy, because a
borrow can pass between two reads. BASIC reads the low three bytes with
PEEK and subtracts, which is exact in its floating point up to 2^24.
CIA 1's timer A is left alone because the KERNAL jiffy interrupt runs
from it.
