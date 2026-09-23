// parts.asm: the demo's running order and every part's IRQ chain. To add a
// part: write its file (part_title.asm is the smallest model), give it a
// chain below, add a column to the part table, and import the file in
// main.asm.
//
// A part is six things:
//   init      main loop, once, with the idle chain playing the music. May be
//             slow: decrunch, generate speedcode, draw the screen.
//   update    frame slot (IRQ), once a frame while the part plays and while
//             its out-transition runs.
//   out       frame slot, once a frame after its frames run out, until it
//             returns carry set. wipe_columns, or hard_cut for a cut.
//   teardown  main loop, once, before the next part's init: put back what
//             the next part must not inherit (sprites, $D016, $D018 ...).
//   frames    how long it plays; 0 plays forever.
//   chain     its rows in the slot table: rising lines, the frame slot last.

// PART_COUNT and LOOP_PART are in config.asm.
//                    part 0 (title)       part 1 (main)
part_init_lo:     .byte <title_init,     <main_init
part_init_hi:     .byte >title_init,     >main_init
part_update_lo:   .byte <title_update,   <main_update
part_update_hi:   .byte >title_update,   >main_update
part_out_lo:      .byte <wipe_columns,   <wipe_columns
part_out_hi:      .byte >wipe_columns,   >wipe_columns
part_teardown_lo: .byte <title_teardown, <main_teardown
part_teardown_hi: .byte >title_teardown, >main_teardown
part_frames_lo:   .byte <TITLE_FRAMES,   0
part_frames_hi:   .byte >TITLE_FRAMES,   0
part_chain:       .byte chain_title - slots, chain_main - slots

// The slot table: every chain's rows, five bytes each (Slot in framework.asm).
slots:
chain_title:
        Slot(FRAME_LINE, frame_slot, true)
chain_main:
        StableSlot(BARS_SLOT_LINE, bars_slot, false)
        Slot(SCROLL_LINE, scroll_slot, false)
        Slot(FRAME_LINE, frame_slot, true)
chain_idle:                            // between parts: the music and nothing else
        Slot(FRAME_LINE, frame_slot, true)
slots_end:
.errorif (slots_end - slots > 255), "the slot table is longer than 255 bytes"
