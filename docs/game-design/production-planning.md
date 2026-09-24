<!-- doc-type: reference -->

# Production Planning for C64 Games and Demos

How people who shipped C64 software decided what to build first, how much
memory each part could have, how big the game could be, and what tools they
wrote. Each design pattern is a decision taken before or between the
techniques, and names the techniques and recipes here that carry it out. Every fact is attributed to a person and a year; a number is
theirs or is shown as a sum. Nothing on this page was measured in VICE.

---

## build_order — Build the thing everything depends on first

**Kind:** production

**Applies to:** scrolling_platformer, horizontal_shmup, vertical_shmup, single_screen_platformer, top_down_adventure, action_puzzle, beat_em_up, racing

**Realised by:** soft_scroll_h, infinite_scroll_h, tile_map_render, tile_grid_collision, wave_director, object_pool, logic_rate_decoupling, memory_layout_plan, platformer-scaffold, simple-shmup, tile-map-render, soft-scroll-h, memory-layout

**Sources:** John and Steve Rowlands (Commodore Format, 1992 to 1993); Peter Liepa (interview transcript published by BBG Entertainment, 2022); Manfred Trenz (Recollection diskmag interview); Jeff Minter (COMPUTE!'s Gazette, August 1983); Codebase64 wiki guide to programming games (unattributed); Chris Crawford, The Art of Computer Game Design (1984, 1997 electronic edition)

**Checks:**

- Boots and scrolls the level as a runnable PRG before any enemy module is linked in.
- Runs the same entity positions after a fixed frame count whether the placeholder art or the final art is loaded.
- Builds each milestone in the plan as its own PRG that reaches a screen in VICE.
- Keeps a memory map file in the repository before the first full build, and the linker map agrees with it.

**Why.** The order in which parts are built decides how much rework there is.
The Rowlands brothers wrote in Commodore Format in December 1992 that they
could not start on player-to-enemy collision because there were no enemies
yet, and could not write the enemies until the scrolling worked, because the
enemies are tied to the scrolling level. Their priority list therefore put
the screen-handling routines first. John Rowlands spent weeks on the scroll
code before anything sat on top of it.

Peter Liepa's account of Boulder Dash (2022) shows the same rule applied to a
physics game. The first thing he worked on was making the rocks and the
digging behave, because the physics had to be interesting before anything
else mattered. At that stage dirt was drawn as squares, rocks as circles and
the player as a plus sign. The name came four or five months in.

Manfred Trenz (Recollection interview) said he coded small test programs to
see whether an approach was the right one before committing to it, and gave
the large sprite routines in Katakis as the example; the plan should name
the test program behind each risky routine, a reader's check rather than a
harness's. Jeff Minter, interviewed in COMPUTE!'s Gazette in August 1983,
described adding very small pieces one at a time as a disciplined style, and
said Attack of the Mutant Camels took four or five weeks.

**The shape.** Two written plans exist that an agent can follow. The
Codebase64 guide names eight stages, paraphrased here: plan and talk the idea
through; design on paper, including sketched maps and the graphics; code the
core routines; add sound; add the presentation screens; fix bugs; hand the
build to testers; compress. Chris Crawford's chapter on the design sequence
(1984) puts a design phase before any code, made of three structures worked
out together: the I/O structure (what the player sees and touches), the game
structure (the causal rules and obstacles) and the program structure, of
which he says the memory map is one of the most important elements. He then
asks for an evaluation pass before programming: does the design meet its
goals, can any value run away without bounds, is there a shortcut to victory,
and should the project be aborted now rather than later. He says most of his
own designs were aborted at that stage, and that no more than five or six
playtesters should ever be used.

A design that survives the evaluation is written down before any code, in
what Crawford calls the pre-programming phase (chapter 5, "Pre-Programming
Phase"). Until then the notes are sketches. Now the I/O structure and the
game structure go on paper as the complete game documentation, written
about what the player experiences rather than about technical matters.
That document is then compared with the program-structure notes, and the
program structure is changed to fit it where they disagree.

A build order that fits both plans and the diaries:

```text
step  deliverable                          proves
1     memory map on paper                  the parts fit
2     scrolling or playfield engine        the dependency root works
3     player movement on placeholder art   the feel
4     one enemy, one collision             the core loop
5     level data from an editor            content can scale
6     music and effects in their budget    the raster and RAM plan holds
7     title, get-ready, game-over states   the state machine is complete
8     tests outside the team, then pack    it ships
```

**What breaks when it is skipped.** Enemies built before the scroller are
rewritten when the scroll representation changes; final art drawn before the
physics is redrawn when the tile size changes; a risky routine never proved
in a test program is found too slow when everything already depends on it.

**Variations.** A single-screen game's dependency root is the playfield and
collision grid; a demo's is the loader (`../demo-design/demo-design-philosophy.md`).

Related: `./game-design-patterns.md`, `./c64-game-archetypes.md`,
`../toolchains/memory-layout-planning.md`.

---

## memory_budget_first — Music and every other part get a byte budget before the code

**Kind:** production

**Applies to:** scrolling_platformer, horizontal_shmup, vertical_shmup, single_screen_platformer, top_down_adventure, puzzle, action_puzzle, beat_em_up, racing, sports, demo_intro, dentro

**Realised by:** memory_layout_plan, sid_play_routine_pattern, sfx_engine_beside_music, exomizer_basics, multi_load_sequencing, memory-layout, sid-music-player, sfx-engine, level-rle-decoder

**Sources:** Chris Butler interviewed by Gary Penn (Zzap!64 issue 17, September 1986); Manfred Trenz (Recollection diskmag interview); Andrew Braybrook, Birth of a Paradroid (Zzap!64, 1985); Dane of Booze Design (Vandalism News issue 65)

**Checks:**

- Lists every part of the program with a byte figure in a budget file, and the figures sum to no more than the RAM the plan claims.
- Places the music player and tune data inside the region the budget reserves for them, as read from the linker map.
- Finishes the music play call inside its raster allowance on PAL and on NTSC.
- Leaves the amount of free RAM the budget promised after the final link, or records the overflow with a date.

**Why.** Music is the part most often squeezed out, because it arrives last
and needs a fixed block of RAM and a fixed slice of every frame. Chris Butler
told Zzap!64 in 1986 that Commando was completely finished when Rob Hubbard
came to add the music, said he needed about 6K, and there was no room; a
level was cut to make it. Manfred Trenz said he hated playing Turrican
without in-game music, and that there was no possibility of putting it in.
Dane of Booze Design said a continuous soundtrack in a C64 demo is tricky
because the visuals and effects on screen limit the memory and
raster time left for it.

**The shape.** Andrew Braybrook's Paradroid diary (1985) is the worked
example. He set out to use the 64K of RAM plus the 4K under the I/O area,
which he calls a 68K plan (64 + 4 = 68). He allowed about 2K for the game's
text and found he needed more like 4K; a smaller patrol-route table freed the
space, and the text went under the I/O devices. Earlier in the same diary the
transfer sub-game grew to about 2K once its presentation was added, larger
than he had planned for, and had to be squeezed in; a week later the last
spare 4K went to deck data. The budget was written first, overflowed in two
places, and was rebalanced rather than abandoned.

A budget file an agent can keep alongside the source:

```text
part            reserved  measured  note
game code       ---       ---
level data      ---       ---       packed or raw, say which
charsets        ---       ---       per VIC bank
sprites         ---       ---       per VIC bank
music player    ---       ---       player and tune together
sound effects   ---       ---       tables and code
text            ---       ---       Braybrook doubled his
free            ---       ---       the overflow reserve
```

Fill the reserved column before the first build and the measured column from
the linker map after each one. For demos, Dane's remark implies a budget per
part: each part hands the music a memory and raster allowance to write to.

**What breaks when it is skipped.** The game ships without music (Trenz), or
a level is cut at the end to make room (Butler), or the play call overruns
the frame on NTSC because it was never given a slice.

**Variations.** A multi-load game can budget per level and reload the music
with it; a single-load game cannot. Butler's own saving in his next game was
character graphics in place of sprites in Space Harrier, to save memory.

Related: `../toolchains/memory-layout-planning.md`, `../techniques/memory-banking.md`,
`../techniques/music-sid.md`, `../music/music-production-reference.md`.

---

## scope_and_region — Decide the load model, the video standard and the schedule margin at the start

**Kind:** production

**Applies to:** scrolling_platformer, horizontal_shmup, vertical_shmup, single_screen_platformer, top_down_adventure, puzzle, action_puzzle, beat_em_up, racing, sports, demo_intro, dentro, party_intro_4k

**Realised by:** pal_ntsc_detection, multi_load_sequencing, exomizer_basics, sprite_multiplex_game, logic_rate_decoupling, pal-ntsc-detect, memory-layout, sprite-multiplex-game

**Sources:** Sarah Jane Avory (development blog, 10 September 2020); Andrew Braybrook, Mental Procreation parts 5 and 6 (Zzap!64 issues 27 and 28, 1987, read in the archive.org scans); Chris Butler (Zzap!64 issue 17, 1986); Manfred Trenz (Recollection diskmag interview); psenough, Teach Yourself Demoscene in 14 Days (MIT licensed guide); Kodiak64 (Seawolves sales post, July 2025)

**Checks:**

- Reaches the first level from one file load when the plan says single-load.
- Runs to the end of a level under `-model ntsc` without the frame counter skipping.
- Stretches each PAL map section to the NTSC height the plan states, and the section count is the same on both.
- Takes the same number of seconds to traverse a section on PAL and on NTSC, within one frame.
- Keeps the on-screen sprite count at or below the limit the plan set for NTSC.

**Why.** Three decisions limit everything else: how many loads,
which video standards, and how much time. Each is cheap on day one and
expensive on the last day.

**Load model.** Sarah Jane Avory wrote in September 2020 that she made Zeta
Wing a single load to keep the scope down and to avoid feature creep, and
that the limits this imposes are the challenge. The core of the game was the
engine from her earlier game Santron, with updates from Soul Force, so the
scope decision sat on reused code rather than on a new engine.

**Video standard.** NTSC runs at 60 frames per second to PAL's 50, so a
raster-synchronised game gets less CPU time per frame. Braybrook's figure in
the Morpheus diary (part 5, Zzap!64 issue 27, July 1987, p. 43, entry for 5
May 1987) is that American machines run about 16 percent slower on
raster-synchronised games, and his rule was that everything in the European
version had to leave at least 16 percent spare processor time. On 19 May
(part 6, issue 28, August 1987, p. 44) his sprites, counted by type, came to
24 against a top limit of 32 that he called safe, and he kept to 24 to
safeguard the NTSC version, which needs CPU use kept down. An earlier version
of this paragraph said he capped the multiplexer at 24; the 32 is the safe
limit, the 24 his allocation under it. His 16 percent is a frame-rate figure (50 / 60 = 0.83). Counting cycles from the
constants in `../hardware/pal-ntsc-reference.md`, a PAL frame is 19,656
cycles and a 6567R8 NTSC frame is 17,095; 17,095 / 19,656 = 0.87, so about
13 percent fewer cycles per frame. Not measured here. Avory's answer to the
same problem is data rather than time: Zeta Wing's PAL map sections are 10
blocks high and are stretched to 12 for NTSC by copying the first two rows
again, because there is no RAM for two maps. NTSC then scrolls faster over
more data and a section takes the same time on both (12 / 10 = 1.2 = 60 /
50).

**Schedule.** Chris Butler told Zzap!64 he was given about eight weeks to
write Commando, that it was messy because it was his first time splitting
sprites, and that there were a lot of bugs, in the gameplay too, because he
did not have time. Trenz gave 6.5 weeks for the R-Type conversion under
pressure. psenough's demoscene guide advises reserving buffer time to redo
or scrap work, typically an extra 20 to 50 percent, and to start small and
build on what works. The plan should also record a delivery date and a
non-zero buffer; no build check sees this.

**Sales.** One modern data point, Kodiak64's own figure for Seawolves,
posted in July 2025: about 110 units over 15 months, 700 to 800 pounds, and the game on
file-sharing sites within 72 hours of release. Roughly 7 units a month
(110 / 15 = 7.3); one game, one channel, not a market figure.

**What breaks when it is skipped.** A PAL-only game tears or drops frames
on NTSC; a game designed as multi-load and then squeezed to a single file
loses levels late; an eight-week schedule with no buffer ships its bugs.

**Variations.** A game can detect the standard at boot and pick a map set,
a sprite cap or a logic rate; the Realised-by recipes do the detection. A
demo's equivalent is trackmo versus parts joined by a key press
(`../demo-design/demo-design-philosophy.md`).

Related: `../techniques/raster.md`, `../techniques/loaders-packers.md`,
`../toolchains/release-disk.md`.

---

## tooling_and_editors — Every component gets an editor, and the level editor runs the game's own routines

**Kind:** production

**Applies to:** scrolling_platformer, horizontal_shmup, vertical_shmup, single_screen_platformer, top_down_adventure, puzzle, action_puzzle, beat_em_up, racing

**Realised by:** tile_map_render, tile_grid_collision, charset_animation, table_generation, actor_activation_window, level-rle-decoder, tile-map-render, wave-director, headless-verify

**Sources:** Manfred Trenz (Recollection diskmag interview); John and Steve Rowlands (Commodore Format, 1993); Andrew Braybrook, Birth of a Paradroid (Zzap!64, 1985)

**Checks:**

- Generates every level table in the build from an editor file, with no hand-typed hex in the source.
- Loads each level file both in the editor and in the game without a conversion step.
- Changes the matching tile in the VICE screenshot after one map cell is edited and the build is rerun.
- Flags duplicate and unused characters in a charset with a build-time tool rather than by eye.

**Why.** Manfred Trenz's rule was that every part of a game had to be quick
to make and quick to alter, which is why each of his games came with its own
set of editors and small tools. The cost of not having them is in
Braybrook's Paradroid diary: in one entry he converted the remaining twelve
decks to hex and keyed them in, about five hours for each of the two steps
by his figure, so around ten hours (5 + 5 = 10) before the next day's corrections.

**The shape.** John Rowlands wrote in Commodore Format in March 1993 that
the Mayhem in Monsterland map editor shared the game's own scroll and draw
code, so that Steve could design a level and then switch straight to the
game to test it. The editor was the one from Creatures with the Creatures
scroll code swapped for the Mayhem scroll code, and it carried a small
graphics editor so any part of a level's appearance could be adjusted in
place. The workflow he describes is: put the platforms into blocks; load the
blocks, the character set and the character colours into the editor; design;
play. Later parts of the diary add utilities that check block designs for
duplicate and missing characters, and an editor that converts a level's
happy tileset to its sad one.

The general form is one tool per data table:

```text
data table          editor or generator         checked by
tile blocks         block editor                duplicate-char scan
level map           map editor on game scroller play from the editor
enemy placements    same map editor, layer 2    activation window test
charset             char editor                 unused-char scan
sprite frames       sprite editor               frame count vs table
music               tracker                     play-call cycle count
```

On a modern host the editors run on the PC and the game's routines are
exercised by running the PRG headlessly; the `headless-verify` recipes and
`../art/asset-pipelines.md` cover the path from editor file to build bytes.

**What breaks when it is skipped.** Hand-keyed data costs hours per level
and hides transcription errors until play. An editor that renders with its
own code shows a level the game then draws differently. Steve Rowlands ran
out of graphic space in the landscape designer in January 1993 and had to
wait for John to change the editor: the editor's limits are part of the plan.

**Variations.** A puzzle or flip-screen game can use a text-file level format
and a build-time converter instead; `level-rle-decoder` shows the runtime half.

Related: `../art/asset-pipelines.md`, `../art/art-production-reference.md`,
`../techniques/scroll.md`, `../techniques/logic.md`.

---

## where_the_documents_are — What survives from the period, and on what terms

**Kind:** production

**Applies to:** scrolling_platformer, horizontal_shmup, vertical_shmup, single_screen_platformer, top_down_adventure, puzzle, action_puzzle, beat_em_up, racing, sports, cracktro, demo_intro, dentro, party_intro_4k

**Realised by:** memory_layout_plan, memory-layout

**Sources:** Video Game History Foundation library announcement (30 January 2025); the diaries and interviews named on this page

**Checks:**

- Ships a sources file in the build's documentation that names an author and a year for every design fact the documentation cites.

The rest is for the writer to keep, since no build can check it: a person and a
year for every fact, no unlicensed scan linked, every number the source's or
arithmetic.

**Why.** An agent asked for a period design document will not find one.
None of the sources read for this page is an internal 1980s design memo;
what survives is what developers published at the time and said later.

- Developer diaries in magazines, written while the game was being made:
  Braybrook's Paradroid and Morpheus diaries in Zzap!64 (1985, 1987) and
  the Rowlands brothers' Mayhem in Monsterland diary in Commodore Format
  (1992 to 1993). The text is the publisher's copyright and transcriptions
  carry no licence of their own: take facts, name the author and the issue.
- Diskmag interviews, retrospective: Manfred Trenz and Dane of Booze Design
  in Recollection and Vandalism News. No licence is stated; same rule.
- Modern developer blogs and posts: Sarah Jane Avory, Kodiak64, and the
  Codebase64 wiki, which is CC BY-NC-SA and so cannot enter this
  BSD-licensed repository beyond its facts.
- Books: Chris Crawford's 1984 text is online in a 1997 electronic edition
  with his permission, the only period book found with a full design sequence.

The Video Game History Foundation's library, announced on 30 January 2025,
makes over 1,500 out-of-print magazines full-text searchable, the fastest
way to find a diary entry by phrase. The foundation states that it does not
own the intellectual property in the library and cannot give permission to
reproduce it, and that it operates under US fair-use guidelines; what a
reader may do with a page is the reader's own question. Museum finding aids
for arcade-era play-test records exist but were not readable from this
machine, so nothing about their contents is claimed here.

**What breaks when it is skipped.** A paraphrase of a paraphrase drifts:
Braybrook's 16 percent becomes a fifth, Butler's 6K a few K. Take the
number from the sentence the person wrote.

Related: `./game-design-patterns.md`, `../demo-design/demo-design-philosophy.md`.
