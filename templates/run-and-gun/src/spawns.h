// spawns.h: FIREBASE's spawn list, included four times by objects.c (one
// array per field). EV(map row, sprite X / 2, kind, parameter), rows
// descending (wave_director keyed to map rows). Each enemy stands on a floor
// cell of src/gen/map.bin (tools/mkassets.py --preview draws the map). The
// parameter: fire period in frames (rifleman), throw period (grenadier),
// direction (runner: 0 from the left, 1 from the right; X 0 or 172 starts
// him under the border). Rows 75-95 are in view at the start: those events
// are spawned by objects_reset.
EV(88,   0, K_RUNNER,    0),
EV(84, 156, K_GRENADIER, 120),
EV(77, 100, K_RIFLE,     64),
EV(73, 144, K_RIFLE,     64),
EV(66, 148, K_GRENADIER, 80),
EV(64, 172, K_RUNNER,    1),
EV(57,  92, K_RIFLE,     64),
EV(52,  44, K_GRENADIER, 96),
EV(47,   0, K_RUNNER,    0),
EV(44,  84, K_RIFLE,     64),
EV(40, 132, K_GRENADIER, 96),
EV(35, 100, K_RIFLE,     64),
EV(33,  60, K_RIFLE,     64),
EV(28, 172, K_RUNNER,    1),
EV(24, 100, K_GRENADIER, 80),
EV(20,  52, K_RIFLE,     64),
EV(16, 132, K_RIFLE,     64),
EV(12,  92, K_GRENADIER, 80),
EV( 8,   0, K_RUNNER,    0),
EV( 5,  76, K_RIFLE,     64),
EV( 4, 116, K_RIFLE,     64),
