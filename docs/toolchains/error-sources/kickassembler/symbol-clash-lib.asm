*=$1000 "lib"
main:           // same name as the caller's entry label; no .filenamespace
    lda #5
    sta $d020
    rts
