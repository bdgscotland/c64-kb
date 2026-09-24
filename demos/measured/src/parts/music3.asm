// music3.asm: MEASURED's music at MUSIC_BASE ($1000): the full player (the
// INTERCEPTOR player as fixed for TOURNEY: filter routing cleared when a
// program ends, the NTSC skip reloading 5 so the tune keeps its PAL tempo on
// NTSC) and the tune "Lists (darker)", candidate A2 of round 3, chosen by the
// maintainer on 2026-09-24. Exposes music_init (A = 0), music_play (once a
// frame from the sequencer's line-255 interrupt) and music_pos (voice 1's
// pattern index, one bar = 1.6 s; the sequencer's SYNC_POS values are bars).
// The tune source is music/tune.py, compiled by the TOURNEY
// compiler into music3_data.asm; the player uses no zero page.
* = MUSIC_BASE "music"
.import source "music3_player.asm"
music3_end:
.errorif music3_end > P5_TABLES, "music3: player and tune overrun P5_TABLES ($1D00)"
