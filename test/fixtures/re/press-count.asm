// A menu loop that counts fresh fire presses, edge-triggered: a press
// counts only after a release, the way a game with one question per press
// reads its input. test/re-session.test.ts injects A = $6F (fire on port 2)
// at the CMP; any other value the read brings is a release, and with no
// injection the port reads its own idle value again, so one `once`
// injection is one press and two are two, while one injection that holds A
// is one press and stays one. The press count ends in Y and is stored to
// $C000 once, when the loop stops polling. The loop polls 256 times and
// stops whatever the input does, so the monitor log stays small.
BasicUpstart2(start)

.const armed   = $c001
.const presses = $c000
.const passes  = $c002

* = $0810 "menu"
start:  sei                 // $0810: no keyboard scan, the port read is the idle one
        ldy #0              // $0811: the press count
        lda #0              // $0813
        sta armed           // $0815: nothing held down
        sta passes          // $0818
poll:   lda $dc00           // $081B: the port read
        cmp #$6f            // $081E: the injection point: fire on port 2
        bne released        // $0820
        lda armed           // $0822: already counted this hold?
        bne tick            // $0825
        lda #1              // $0827
        sta armed           // $0829
        iny                 // $082C: a fresh press
        jmp tick            // $082D
released:
        lda #0              // $0830: the release re-arms the count
        sta armed           // $0832
tick:   inc passes          // $0835
        beq done            // $0838: 256 polls
        jmp poll            // $083A
done:   sty presses         // $083D: publish the count, once
stop:   jmp stop            // $0840
