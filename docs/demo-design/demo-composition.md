<!-- doc-type: reference -->

# Demo Composition

How a multi-part C64 demo is put together: what one part owes the next, how a
part ends, how long anything is allowed to run, how the music survives the
joins, and in what order the work gets done. These are design patterns, not
techniques. Each one names the techniques and recipes that realise it; the
mechanics live on those pages. `./demo-design-philosophy.md` covers why demos
exist and the lifecycle of a release; this page starts where a group has parts
on disk and has to make a demo out of them.

No archetype covers a full multi-part demo; the nearest are `demo_intro` and
`dentro`, and `party_intro_4k` inherits the same rules at a smaller scale.
Sources are named in prose. Nothing here was measured on this machine unless a
sentence says which repo page did.

---

## part_lifecycle — What one part owes the next

**Kind:** structure
**Applies to:** demo_intro, dentro, party_intro_4k
**Realised by:** irq_chain_table, stable_raster_irq, multi_load_sequencing, sparkle_irq_loader, krill_loader_integration, vic_bank_select, memory_layout_plan, sid_play_routine_pattern, irq-chain, memory-layout, sid-music-player
**Sources:** Linus Åkesson, Spindle v2 documentation (2015); Raistlin, Stopping Music Popping (2023)

**Checks:**
- Every part writes $D011, $D012, $D015, $D016, $D018 and $DD02 before its first frame is shown.
- No part writes $DD00 when it runs under a loader that owns that register.
- After a part's clean-up returns, the IRQ vector points at a handler the next part installed, not at a handler in memory the next part has loaded over.
- The music play routine is entered exactly once per frame during a part's preparation and fade-out.
- No load in the disk image overlaps a page range the next part declares inherited.

**Why.** A part written on its own assumes a clean machine. A part in a demo
follows another part, and inherits whatever that part left in the VIC, the
SID, the interrupt vector and RAM. Åkesson's Spindle documentation makes the
contract explicit because the loader runs between parts and needs to know what
each one touches. The same contract holds with any loader, or with none.

**The shape.** Åkesson divides a part into six routines that the framework
calls in order. In this page's words:

```
stage      runs with IRQs   job
prepare    enabled          build tables and speedcode, copy data; no VIC writes
set up     disabled         write the VIC registers and colour RAM; fast
interrupt  (is the IRQ)     the effect's per-frame work; vector at $FFFE
main       enabled          framebuffer effects that do not reach full frame rate
fade out   enabled          raise a flag the effect reads; return "done" when the fade has finished
clean up   enabled          tear down: stop interrupts, wait for a chosen raster line
```

Preparation of the next part overlaps the current part's run, which is why
prepare may not write VIC registers: the screen still belongs to the part on
display. The next part's remaining data finishes loading after fade out
reports done and before clean up is called (Åkesson).

What a part hands back is what it owned: the interrupt vector, the six VIC
registers in the first check, the sprite enable bits, the SID registers its
effects wrote, and any memory it did not declare as inherited. Åkesson lists
the registers to re-initialise because the previous part may leave unexpected
values in them.

**Memory inheritance.** Two adjacent parts may not overlap in RAM unless the
second declares that it inherits a page range from the first. Åkesson's linker
inserts a filler part when two neighbours collide: a black screen with no
badlines and an interrupt handler that only calls the music player. A
deliberate filler is the seam a transition is built in. The loader keeps a
fixed region ($0C00 to $0DFF in Spindle v2) and may write a further page and
four zero-page bytes while loading, so a part's memory plan starts by
subtracting those.

**Music across the boundary.** One player is active at a time, and each part's
handler carries a three-byte placeholder the linker turns into the call to the
installed player (Åkesson). The handler has to be entered every frame through
preparation, fade out and clean up, or the tune skips; see
`music_continuity_across_parts` below.

**What breaks when it is skipped.** A part that trusts $D018 from its
standalone build shows the wrong charset for a frame after a part that moved
it. A part that leaves $D015 set hands the next part its sprites. A part that
disables interrupts and never re-enables them before the switch kills the
music at the join. A part that uses $0E00 while the next one loads is
overwritten from under itself.

**Variations.** A megademo (see `pacing_and_length`) resets between parts, so
the contract shrinks to leaving the disk readable. A one-file intro has no
contract, and the six stages are still the order to write it in.

Related: `../techniques/loaders-packers.md` (`multi_load_sequencing`),
`../techniques/raster.md` (`irq_chain_table`),
`../techniques/memory-banking.md` (`memory_layout_plan`).

---

## transition_conditions — Three ways a part ends

**Kind:** behaviour
**Applies to:** demo_intro, dentro, party_intro_4k
**Realised by:** screen_wipe, colour_fade, colour_cycling, keyboard_matrix_scan, sid_play_routine_pattern, screen-wipe, colour-fade, colour-cycling
**Sources:** Linus Åkesson, Spindle v2 documentation; Dane, interviewed by Magic in Vandalism News 65

**Checks:**
- A part whose end condition is the space bar advances on that key and on no other.
- A part whose end condition is drop-through advances only after the next part's scheduled load has completed.
- A part whose end condition is an address reaching a value advances on the frame the player writes that value, and does not advance if the tune is stopped.
- The fade-out stage reports done before the clean-up stage runs.
- No frame between two parts shows the first part's screen with the second part's colours.

**Why.** A part has to know when it is over. Åkesson's script format has three
answers. **The shape:** each part carries one condition.

```
condition          meaning                                  used for
key (space)        wait for the viewer                      early builds; megademo parts
drop-through       end as soon as the next part is loaded   parts that exist to cover a load
address = value    wait until RAM holds a value             music sync: the player's song position
```

The third is how a demo runs to its soundtrack. Åkesson's example reads the
player's song position from a zero-page byte, so a part ends on a pattern
boundary rather than a frame count. The condition is met, the fade-out stage
runs until it reports done, then the switch happens; a part that fades over
two seconds has to be told to end two seconds early.

**The judgement.** Dane, on the soundtrack of Edge of Disgrace, describes the
job as solving the memory and raster-time limits without letting the viewer
see where either ran out. Applied to a join, that is the test: a transition
reads as forced when the viewer can see the limit that caused it. A cut to
black because two parts collide in memory, a pause because the disk had not
finished, a fade keyed to a raster count instead of the tune. The fix is not a
faster effect over the seam; it is moving the condition so the seam falls
where the music already has one.

**What breaks when it is skipped.** A part timed by a frame counter drifts
against the tune by one frame per missed play call. A part ended by the loader
alone ends at a different moment on a 1541, on an SD2IEC and in VICE. A part
that waits for space in the final build stops the demo on the big screen.

**Variations.** A demo mixes the three: space everywhere during development
(Åkesson's advice), address-equals-value once the tune is in, drop-through for
filler parts. A 4K intro with no loader has the first and third.

Related: `../techniques/transitions.md`,
`./demo-design-philosophy.md` section 5 (transitions as an aesthetic
site), `music_continuity_across_parts` below.

---

## pacing_and_length — How long anything may run

**Kind:** composition
**Applies to:** demo_intro, dentro, party_intro_4k
**Realised by:** multi_load_sequencing, big_font_2x2, dycp_scroller, big-font-scroller, dycp-scroller, sine-scroller
**Sources:** Raistlin, X 2023 Demo Compo: A Look Back (2023); Goto80, The First Megademos (2021); Cascade release notes (1998)

**Checks:**
- No single effect stays on screen for more than about twenty seconds without a visible change of state.
- The part that runs across the disk flip loops until the flip is detected and shows a scroller.
- Every part in the final build advances without a key press unless the design names it a megademo.
- No effect in the final build runs below the frame rate its design states.
- The final build's running time, measured start to end, is within ten percent of the figure in the part list.

**Why.** The audience at a party sees the demo once, projected, in a row of
other demos. Length and dwell are the two numbers they feel directly.

**Two structural families.** Goto80's history of the megademo separates the
forms. A megademo is a run of discrete parts; the viewer presses a key to
reach the next, tolerates a break for a loader or a menu, and needs no common
theme, so the next part can be anything. A trackmo drops the loading part and
streams the next part from disk with no visible break, and then the name
megademo stops fitting. The C64 megademos he lists all date from 1987; 6581
Crew and Finland Cracking Service are among the six groups named. A megademo
part is a complete short programme with its own ending; a trackmo part is a
paragraph in a longer piece.

**The numbers.** Raistlin's look back at X 2023 states the rules Genesis
Project set for No Bounds: do not dwell on an effect for more than twenty
seconds however long it took to write, and a total running time close to ten
minutes. He gives the field's running times as Mojo and Wonderland XIV about
sixteen and a half minutes, Multiverse about eighteen, Next Level about
twenty-one, and calls fifteen minutes and more the new norm for the bigger
demos. He takes the blame for his own demo running short and leaning on code
while the others carried far more art and flipped sides quickly. The dwell
rule held up; the ten-minute total did not. Both figures are his, from one
competition.

**The disk flip.** Raistlin describes No Bounds' turn-disk part as a greetings
scroller long enough to cover the flip and then some, kept because it looked
good. The scroller at the flip is the standard placement: a part that can run
indefinitely while the viewer changes sides, and that has to be there anyway
(the boast tradition, `./demo-design-philosophy.md` section 5).

**What reads as unfinished.** Raistlin's note on another entry's fight
sequence is that it wanted more animation and a higher frame rate: the
audience cannot see the code but can see a slideshow. Cascade's note on Trip
to Nepa(l) (1998) says trouble linking the parts left the whole demo slow
paced, the other visible form: parts each fine, a whole that drags.

**What breaks when it is skipped.** Without a dwell rule the hardest effect
stays up for a minute because it was hard, and the room's attention leaves
after twenty seconds. Without a length figure against the part list the demo
is short against the field or padded.

**Variations.** A 4K intro keeps the dwell rule and runs the length of its
tune. A single-file demo has no flip and puts the scroller at the end.

Related: `./demo-design-philosophy.md` sections 2 and 5,
`transition_conditions` above, `composition_workflow` below.

---

## music_continuity_across_parts — One play call per frame, always

**Kind:** behaviour
**Applies to:** demo_intro, dentro, party_intro_4k, cracktro
**Realised by:** sid_play_routine_pattern, irq_chain_table, stable_raster_irq, frame_sync_loop, pal_ntsc_detection, sid-music-player, irq-chain, pal-ntsc-detect
**Sources:** Raistlin, Stopping Music Popping (2023); Linus Åkesson, Spindle v2 documentation; Dane, Vandalism News 65

**Checks:**
- Consecutive entries to the play routine are 19,656 cycles apart on PAL, within the tolerance the design states, on every frame of a run that crosses every part boundary.
- Consecutive entries to the play routine are 17,095 cycles apart on NTSC under the same rule.
- No frame between the first play call and the end of the demo has zero play calls or two.
- The play call is the first thing the interrupt handler does, or it has an interrupt of its own.
- When the play call moves to a different raster line between two parts, it moves by steps and not in one frame.

**Why.** A SID tune is a sequence of register writes that assume one call per
frame. Raistlin's article names the moments a demo breaks that assumption:
initialising a new part, the transition into it, and the final switch when the
IRQ vector changes. Each can drop a call or make two, and the result is an
audible pop or a lurch in the tempo.

**The figure.** A PAL frame is 312 raster lines of 63 cycles: 312 × 63 =
19,656 cycles. An NTSC frame on the 6567R8 is 263 lines of 65 cycles: 263 × 65
= 17,095 cycles. Both are arithmetic from the line counts on
`../hardware/pal-ntsc-reference.md`; the PAL sum is also the figure Raistlin
states, and that page measured it in VICE x64sc with a CIA timer latch. The
NTSC figure stands on arithmetic and that page's table.

**The shape.** The play call sits at a fixed point in the frame. Raistlin's
two fixes are ordering and sliding. Ordering: make the play call the first
thing the handler does, or give it its own interrupt, so variable-time code
cannot move it. Sliding: when the new part wants its call on a different
raster line, move it over several frames; his example walks the call from line
255 to line 50 in steps of about twenty lines over eleven frames. He allows
about five to ten percent variance during a transition and expects the exact
figure in steady state.

Dane's remark on Edge of Disgrace is the design-side half: the music is
written to each part's memory and raster budget, and a continuous soundtrack
is hard for that reason. The composer knows which parts have raster time for a
heavy player and which do not, and the player's cost is a line in the part's
budget from the start, not a surprise at linking.

**Detection.** Raistlin traces execution of the play routine's address in the
VICE monitor, logs each hit with its clock to a file, and differences
consecutive clocks; any gap that is not the figure is a fault. The same
monitor commands (`trace`, `logname`, `log on`) are documented for another
purpose on `../runtime/vice-reference.md`. A trace on stores to $D400 to $D418
asks the same question from the register side.

**Measured across a part switch.** The demo starter (`templates/demo`) plays the
tune from the frame slot at line 236, the last row of every chain, and keeps an
idle chain of that slot alone running between one part's out-transition and
the next part's init. A plain build (no `AUTOPILOT`) was run for 10,000,000
cycles in the windowless VICE x64sc 3.10 with `trace exec 1003` (the play
entry) and `trace exec` on `start_part`, logged with `logname`. PAL: 354 calls,
every gap 19,652 to 19,660 cycles, 166 of them exactly 19,656; the three gaps
before the title-to-main switch were 19,653, 19,657 and 19,655, the three after
it 19,657, 19,657 and 19,656. NTSC (6567R8): 333 calls, gaps 17,092 to 17,098 and, every
sixth frame, 34,187 to 34,193, because the starter skips one call in six so a
50 Hz tune keeps its tempo at 60; the switch fell inside that pattern with no
other change. Every call entered on line 239, at cycle 17 to 21 on PAL and 25
to 29 on NTSC (exec-trace CYC; Bauer's cycle is one more). The ±4 is the raster
IRQ's entry jitter, since the frame slot does not stabilise; no call was
dropped or doubled. An earlier version of this paragraph said a trace across a
part boundary was not measured here.

**What breaks when it is skipped.** One dropped call is a click. A doubled
call is a note that lands early. A call that moves from line 255 to line 50 in
one frame gives one short gap of 312 − 255 + 50 = 107 lines, 107 × 63 = 6,741
cycles, about a third of a frame (Raistlin calls it about half), and the tempo
stumbles once. In a trace, a missed call shows as a gap near 39,312 cycles and
a doubled call as one near zero. On NTSC a tune written for PAL runs faster by
19,656 ÷ 17,095, which is a separate fault with a separate page
(`../pitfalls/region-timing.md`).

**Variations.** A demo that changes tune between parts has the same problem at
the join: the old player's last call and the new one's first want the same
spacing. A cracktro with one part has only the initialisation case.

Related: `../techniques/music-sid.md` (`sid_play_routine_pattern`),
`../pitfalls/region-timing.md`, `../hardware/pal-ntsc-reference.md`,
`part_lifecycle` above.

---

## composition_workflow — The order the work goes in

**Kind:** production
**Applies to:** demo_intro, dentro, party_intro_4k
**Realised by:** multi_load_sequencing, memory_layout_plan, exomizer_basics, memory-layout
**Sources:** Dane, Vandalism News 65; Linus Åkesson, Spindle v2 documentation; psenough, Teach Yourself Demoscene in 14 Days; Phoenix, NVScene 2014 report in Hugi 38 (2014)

**Checks:**
- The first linked build runs every part in order with a key press between them and no transitions.
- The second linked build runs to the tune with every part ended by a song position.
- Transitions are added only after a build exists that runs end to end on the tune.

**Why.** The whole is assembled last and under a fixed deadline. The order in
which the pieces are made decides how much of the deadline goes to polish and
how much to firefighting.

**The shape, from two shipped accounts.** Dane, on Booze Design's process: for
Uncensored the theme was decided at a gathering in the summer of 2014 and the
linking order came naturally from it; nothing is decided early. For Edge of
Disgrace, HCL stacked up previews of effects, the group worked toward
coherency, and when HCL stopped making effects they linked the demo in
chronological order over about six months, HCL linking one more effect or
transition and Dane adjusting or composing to it; the soundtrack changed
almost daily. Most of the work on Uncensored was done in the three months, and
the forty-eight hours, before the deadline. Read as an order: theme, then
linking order, then effects fitted to both, with the last quarter of the
calendar carrying most of the load.

Åkesson, from the tool side, gives four steps. Put the parts in a script in
order of increasing interest with every transition set to the space bar. Add
the tune and switch every transition to a song position so the music drives
the demo; this is the rough cut. Build the transitions, biggest first, such as
an intermediate part that brings in a background picture ahead of the effect
that uses it. Then polish the switchovers that glitch, with clean-up routines
that stop interrupts and wait for a chosen raster line. Åkesson's reason for
leaving transitions until the order is fixed is that once it is, inherit tags
and transitions can rely on it. Two practices sit alongside the steps and leave
no trace in the binary: write the part order, the total time and the
owner of each join down before the last quarter of the calendar, and show each
art-heavy part to someone other than its coder before the deadline.

**Who owns what.** psenough's guide puts the demo's overall design, from
concept through the arrangement of scenes to the joins, with the graphician
more often than not: the coder produces effects, the composer a tune to each
part's budget, and someone holds the order and the joins. The guide also
advises a schedule buffer of twenty to fifty percent over the estimate,
and starting small.

**Paintovers.** Phoenix's report on NVScene 2014 records Pixtur introducing
paintovers to get feedback on colour and tone before a release. The method is to let others paint over a work-in-progress frame; that
description is this page's, not the report's. On a sixteen-colour machine this
is cheap and the alternative is finding out at the projector.

**What breaks when it is skipped.** Transitions built before the order is
fixed are rebuilt when it moves. A tune commissioned before the part budgets
are known is too heavy for the part that needs raster time or too thin for the
part that had it. A demo linked in the last week ships the pacing fault
Cascade described. An unwritten part order means the group learns the running
time at the party.

**Variations.** A one-coder 4K intro collapses the roles into one person and
keeps the four steps. A megademo skips the transition steps and spends them on
each part's own ending.

Related: `./demo-design-philosophy.md` section 4 (the release lifecycle,
which this pattern refines), `pacing_and_length` above,
`../techniques/loaders-packers.md`.
