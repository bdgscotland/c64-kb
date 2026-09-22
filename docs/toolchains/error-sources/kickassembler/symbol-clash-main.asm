.import source "symbol-clash-lib.sym"
*=$0801 "basic"
BasicUpstart2(main)
main:
    jsr main
    jmp *
