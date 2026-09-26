// music3.asm: MEASURED's music at MUSIC_BASE ($1000): the full player (the
// INTERCEPTOR player as fixed for TOURNEY: filter routing cleared when a
// program ends, the NTSC skip reloading 5 so the tune keeps its PAL tempo on
// NTSC) and the tune "Lists (darker)", candidate A2 of round 3, chosen by the
// maintainer on 2026-09-24. Exposes music_init (A = 0), music_play (once a
// frame from the sequencer's line-255 interrupt) and music_pos (voice 1's
// pattern index, one bar = 1.6 s; the sequencer's SYNC_POS values are bars).
// The tune source is plan/music3/A/tune_A2.py, compiled into music3_data.asm
// by plan/music3/A/mkmusic_env3.py (the TOURNEY compiler plus filter kind 2,
// the kb's ENV3 filter envelope, which the break's bass uses since
// 2026-09-24; plan/notes-music-env3.md); the player uses no zero page.
* = MUSIC_BASE "music"
.import source "music3_player.asm"
music3_end:
// Since 2026-09-24 the tune data is two pieces (plan/music3/B/notes.md): a
// header in this block, ending at music_data_hdr_end, and a load image at
// MUSIC_IMAGE_LOAD ($6000) that runs at MUSIC_IMAGE_RUN ($E000) once the
// sequencer has copied MUSIC_IMAGE_LEN bytes there; music_play needs
// $01 = $35 around it. music3_end is the load image's end.
.errorif music_data_hdr_end > P5_TABLES, "music3: player and tune header overrun P5_TABLES ($1D00)"
.errorif music3_end > $7800, "music3: the tune image's load block overruns $7800"
