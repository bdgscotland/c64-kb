// sound.asm: the audio hooks, imported by kernel.asm. A stub in this slice:
// the audio module (PLAN.md, "Modules") replaces the bodies with the tune and
// sfx_voice_takeover (c64-kb recipe kickassembler/sfx-voice-takeover): effects
// take voices 1 and 2, the tune keeps stepping them silently and plays on 3.
//
//   audio_init    once, from kernel_init, interrupts off
//   audio_play    once a frame, from the frame IRQ (line 250), after the sprites.
//                 Its cost comes off the redraw's lead over the beam on NTSC
//                 (PLAN.md, "Budget"): keep it short, or move it.
//   sfx_request   A = effect number (0 = none); C calls it with interrupts held
//                 off (main.c sfx()). The last request wins.
// Nothing here may use zero page (Oscar64 owns it).

audio_init:
        lda #0
        sta sfx_pending
        rts

audio_play:
        rts

sfx_request:
        sta sfx_pending
        rts

sfx_pending: .byte 0
