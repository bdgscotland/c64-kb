.macro Blink() {
    inc $d020
}
*=$1000
    Blink
    rts
