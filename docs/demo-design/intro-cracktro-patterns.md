---
kind: demo
---

<!-- doc-type: archetype-reference -->

# Cracktro and One-Screen Intro Patterns

The cracktro is the smallest self-contained C64 demo form: one screen that names a
group, carries a message and exits cleanly. It combines the core techniques (stable
raster, side-border open, sprite animation, SID player, scroller) in their simplest
form, so its conventions come before any larger demo or game intro.

This page is also the archetype reference for demo forms. Each form below is an
`Archetype` node of kind `demo` in the graph, named by its `**Archetype:**` line;
its `**Technique fingerprint:**` line becomes `FEATURES` edges to techniques and its
`**Common pitfalls:**` line `RISKS` edges to pitfalls, and `c64_demo_briefing` reads
them when called with an `archetype` (`../CONVENTIONS-archetypes.md`). Technique
names match H2s in `../techniques/`; pitfall names match H2s in `../pitfalls/`.
A section without an `**Archetype:**` line is prose and is not a node.

---

## History

From approximately 1985 to 1995 the cracktro had a practical job. Cracking
groups stripped the copy protection from commercial games and prefixed the cracked
binary with a short intro: the group's name, a scroller message declaring the crack
version and date, greetings to allied groups, and a SID tune. The intro ran until
the user pressed a key, then it jumped into the game.

It served two purposes. It claimed the crack for the group. And the greetings list
in the scroller text was the scene's address book: a group's standing was partly
measured by who greeted it back.

Size constraints were strict because the intro shared memory with the game. Common
limits were 1 KB or less — sometimes 256 bytes — because the cracked game image
had to fit alongside the intro in the C64's 64 KB address space. Every byte of code
and every raster line of display time was accounted for.

From the mid-1990s, cracktros were increasingly made for their own sake. Groups like Triad, Onslaught, F4CG and
Genesis Project continued releasing cracks with attached intros well into the 2000s
and 2010s. The cracktro format also migrated to demo parties as a compo category:
productions capped at 4 KB compete on the same terms as the 1985 originals. It
remains a constrained form distinct from the full demo.

---

## Crack Intro

**Archetype:** `cracktro`

The crack intro is the canonical form: exactly five elements in a fixed spatial
layout, each mapping to one or more C64 techniques. None is optional; without any one
of them the intro reads as incomplete to a scene-literate viewer.

### Group Logo

The logo occupies roughly the top half of the visible screen — approximately 80 to
100 pixels tall, spanning the full 320-pixel width. The viewer sees it first, and it
is the hardest element to get right visually.

Two implementation paths exist. The first is a bitmap logo: a hi-res or multicolor
bitmap on an 8 KB boundary inside the chosen 16 KB VIC bank (for example
$6000 in bank 1, $4000–$7FFF), with color data in screen RAM and color RAM.
(An earlier version called $4000–$7FFF "the standard VIC-II bitmap area";
there is none: the bitmap sits at $0000 or $2000 within whichever bank
`$DD00` selects, per `../hardware/vic-ii-reference.md`.) The VIC-II's multicolor bitmap mode (bit 5 of $D011 = 1,
bit 4 of $D016 = 1) gives three colors plus background, enough for a bold logo
glyph. The second path is a large custom multicolor charset: a 4x4 or 8x4
character-cell logo built from custom character definitions. The charset uses less
RAM and is easier to re-color at run time, so it is the usual choice when the intro
must fit under 1 KB.

Either way, the logo is static. Cracktros do not animate the logo; the animation
budget goes to the sprite layer beneath it.

Logo placement in screen coordinates: top edge at raster line 51 (the first line
of the 25-row display window on PAL), bottom edge at approximately raster line 140.
That leaves lines 140–234, about 95, for the sprite layer and character rows 23–24
(lines 235–250) for a double-height scroller, or row 24 (243–250) for a single one;
the bottom border starts on line 251. (An earlier version put the first line below
the top border at 40 and gave the scroller 40 lines.)

Color conventions: see Conventions below.

### Side-Border Sprites

The left and right side borders normally hide anything behind them: the VIC-II's
border flip-flop is set at X=344 (CSEL=1) or X=335 (CSEL=0) and draws border colour
until X=24 on the next line. Side-border opening (`sideborder_open`) is one write per
line: CSEL goes from 1 to 0 on cycle 56 (PAL), between the two set positions, so
the flip-flop stays clear and neither this line's right border nor the next line's
left border is drawn. Sprites then show across the whole side border; in a VICE PAL
screenshot that is 32 pixels each side (x 0–31 and 352–383). (An earlier version
called the border a "horizontal blank window", described two writes, and said about
7 pixels were exposed; 7 pixels is how far CSEL=0 widens the left border.)

In a cracktro, side-border sprites are decoration: thin vertical bars, dashed lines
or simple shapes that frame the screen. They show that the coder can open the
border.

It needs a stable raster IRQ (`stable_raster_irq`) and a per-line loop that puts
the write on cycle 56 of every line in the band, exactly; on a badline the loop's
`DEC $D016` cannot reach cycle 56, so the band is kept badline-free. The measured
listing is `../recipes/kickassembler/sideborder-open.md`; see `../techniques/raster.md`
for the technique. (An earlier version gave a ±1-cycle window for two writes.)

In intros smaller than 1 KB, side-border opening is sometimes omitted to save code
space. In any intro above approximately 512 bytes it is expected.

### Sprite-Chain Animation

Eight hardware sprites are available at once. A cracktro usually spends all eight on
an animated element in the middle of the screen, between the logo and the scroller
bar. Common patterns are a horizontal sweep (sprites moving left-to-right in
a chain, wrapping), a bounce (sprites oscillating vertically at different phases),
or a sine-wave chain that forms a ribbon.

The sprite positions are updated in the raster IRQ handler or a main-loop timer. Each
sprite gets an X and Y position computed from a precomputed sine table indexed by a
per-sprite phase offset. The phase advances by a fixed amount each frame, and each
sprite's phase is offset from the previous by a constant (256/8 = 32 units for an
evenly spaced chain over a full sine period).

The chain animation itself (eight sprites phased along one table, the `$D010`
high-bit wrap, the bounce, the expanded-sprite logo) is `sprite_sine_chain` in
`../techniques/sprite.md`, with the recipe `../recipes/kickassembler/sprite-sine-chain.md`;
`sprite_multiplex_8` is a multiplexer and is only needed when more than eight
objects are on screen at once (an earlier version of this page named it for the
chain). For showier intros with more than 8 simultaneous sprite objects, `sprite_multiplex_8`
is replaced by `sprite_multiplex_24`, which reuses the eight hardware sprites across
multiple raster bands. The trade-off is IRQ complexity and a minimum vertical spacing
requirement between bands.

Cracktro sprites follow the logo's color limit: two or three colors, chosen to suit
the logo's palette. Multicolor
sprites (bit set in $D01C) give three colors plus transparent; hi-res sprites give
one color with sharper edges. Cracktros almost universally use multicolor.

### SID Tune

Every cracktro carries a SID tune. It plays while the scroller runs and loops until
the user presses a key.

The tune is almost always a standalone SID binary: a composer exports a `.sid` file
from a tracker (GoatTracker, SID Factory II, or older tools like Music Assembler),
and the intro relocates and links it. The player follows the `sid_play_routine_pattern`
convention: an `init` entry point that accepts a song number in the accumulator, called
once at startup, and a `play` entry point called once per frame (every 50 Hz on PAL,
every 60 Hz on NTSC) from the raster IRQ.

In an intro under 1 KB the SID player is the largest single component. A minimal three-voice SID routine with one short tune can occupy 200–400
bytes. Some groups ship hand-assembled micro-players for extreme size categories.

Loop length is set by convention as much as by memory: 30 to 60 seconds is expected.
A tune that loops in under 20 seconds grates. A tune
longer than 90 seconds was historically impractical because the tracker data would
overflow the available RAM.

### Scroller Bar

The scroller is the text layer at the bottom of the screen, one
character row (8 raster lines) or a double-height zone (16 lines). It scrolls
horizontally from right to left at a speed of one pixel per frame (50 pixels/second
on PAL), shifting the VIC-II's fine X-scroll register ($D016 bits 2–0) and advancing
a character pointer when the fine-scroll wraps to 7.

Implementation uses `soft_scroll_h` from `../techniques/scroll.md`. The scroller
buffer holds enough characters to fill the screen plus one additional character to
absorb the pipeline delay. New characters are fed from the message string as the
scroll pointer advances.

The scroller bar sits at the bottom of the visible display, often with its own
background color (set via color RAM for that row) to separate it from the sprite
layer. A common layout places it at character row 24 (the last
row before the border).

The scroller carries the cracktro's text. See Conventions below for its format.

### Size and Exit

The canonical form is one screen, often under 1 KB, sometimes 256 bytes, with all
five elements in minimal form. The code is hand-optimized machine language (or
KickAssembler with heavy constant-folding), and RAM is tracked byte by byte. The SID
tune takes the most space. Groups in the extreme-size category
sometimes synthesize audio from a tiny engine rather than shipping tracker data.

The crack intro exits to the game when the user presses a key or fire. The exit
routine patches the game's reset vector or JSRs directly into the game entry point.

The variant formats that follow scale the cracktro pattern up or down:
the demo intro, the pack intro, the dentro and the 4K party intro.

**Technique fingerprint:** `stable_raster_irq`, `sideborder_open`, `sprite_sine_chain`, `soft_scroll_h`, `raster_bars`, `sid_play_routine_pattern`

**Common pitfalls:** `raster_irq_first_line_jitter`, `d016_unmasked_rmw_clobbers_csel_mcm`, `xscroll_applies_to_all_rows`, `sprite_x_high_bit_wrong_register`, `pal_ntsc_tempo_mismatch`

The fingerprint is the Technique Checklist's five core names plus `raster_bars`, which the
canonical recipe builds behind the scroller; `sprite_multiplex_24` is the checklist's
alternative for larger intros and is not forced. The pitfalls follow from the elements:
the stable IRQ (`raster_irq_first_line_jitter`), two users of `$D016` on one screen
(`d016_unmasked_rmw_clobbers_csel_mcm`), a scroller on one row under a static logo
(`xscroll_applies_to_all_rows`), the `$D010` wrap in the sprite chain
(`sprite_x_high_bit_wrong_register`) and a play call once a frame on both models
(`pal_ntsc_tempo_mismatch`).

---

## Demo Intro

**Archetype:** `demo_intro`

**Starter:** `demo`

A demo intro is the opening part of a longer multi-part demo, released as a
standalone production. Its size ceiling is 1 KB to 4 KB. It may add to the cracktro
layout a simple effect (a plasma, a vector cube or a tunnel) that previews the demo's
look. The transition from the intro screen to the first effect is a design decision:
fade-to-black, raster wipe, or hard-cut. The fade is `colour_fade` in `../techniques/transitions.md`, a
sixteen-step luminance-ordered table measured in the `colour-fade` recipe;
a fade done by arithmetic on the colour numbers flickers through hues.

**Technique fingerprint:** `stable_raster_irq`, `soft_scroll_h`, `sid_play_routine_pattern`, `colour_fade`

**Common pitfalls:** `raster_irq_first_line_jitter`, `pal_ntsc_tempo_mismatch`

The effect that previews the demo (plasma, vector, tunnel) is the intro's own choice
and is not in the fingerprint; the fade out of the intro screen is.

---

## Pack Intro

**Archetype:** `pack_intro`

A pack intro is the interface wrapper for a compilation (a "pack" or "disk magazine").
It presents a menu of productions loadable from the disk. The pack intro's scroller
explains the contents; the sprite layer and logo identify the group curating the
collection. It replaces the exit-to-game logic with a disk directory reader and a
loader call. Pack intros from the late 1980s are
some of the earliest examples of C64 software with a designed UI.

**Technique fingerprint:** `stable_raster_irq`, `soft_scroll_h`, `sid_play_routine_pattern`, `multi_load_sequencing`

**Common pitfalls:** `raster_irq_first_line_jitter`, `pal_ntsc_tempo_mismatch`, `fastloader_kernal_dependency`

The loader that replaces the exit-to-game logic is `multi_load_sequencing` in
`../techniques/loaders-packers.md`; which loader sits under it is the pack's choice.

---

## Mini-Demo / Dentro

**Archetype:** `dentro`

The "dentro" (usually read as "demo" plus "intro"; the origin is not sourced
here, and an earlier version called it a mid-1990s portmanteau of "demo" and
"dentro") is a multi-part
production in the 8 KB to 16 KB range, usually 2 to 4 parts. Each part is a
self-contained effect with its own raster setup and SID tune. A minimal loader
sequences the parts from disk. The dentro sits between the one-screen intro and the
full competition demo that needs several disk sides.
A two-part dentro might open with a cracktro-style screen, transition to a plasma
or sprite-multiplexed effect, then roll credits.

**Technique fingerprint:** `stable_raster_irq`, `sid_play_routine_pattern`, `multi_load_sequencing`, `colour_fade`

**Common pitfalls:** `raster_irq_first_line_jitter`, `pal_ntsc_tempo_mismatch`, `fastloader_kernal_dependency`

Each part brings its own raster setup and tune, so the stable IRQ and the play
convention are per part; the sequencing loader and the transitions between parts
are what the dentro adds over the one-screen intro.

---

## Conventions

### Scroller Text Format

The canonical scroller text follows this template:

```
*** GROUP NAME PRESENTS ANOTHER 100% CRACK / GREETINGS TO: GROUP A ... GROUP Z ***
```

Key conventions:
- Triple asterisks as visual separators between message segments
- "PRESENTS" as the verb (alternatives: "RELEASED", "BRINGS YOU")
- "100% CRACK" as the quality claim (100% = no trainer, no nag screen, fully working)
- "GREETINGS TO" as the transition to the social network list
- Group names in ALL CAPS throughout
- Ellipsis represented as " ... " with spaces
- The message loops: the closing ` ***` connects back to the opening `*** ` without pause

A longer scroller might include: release date, version number, crack notes ("TRAINED
BY XXX" or "ORIGINAL TRAINER REMOVED"), requests for originals, contact addresses
(BBS phone numbers in the historical era, nowadays IRC or email), and an extended
greetings list of 10 to 30 groups.

### Logo Placement and Sizing

Logo top edge: no higher than raster line 51 (first line of the 25-row display
window). Logo bottom edge: no lower than raster line 140. This preserves the sprite
zone (lines 140–234, about 95 lines) and the scroller zone (character rows 23–24,
lines 235–250). (An earlier version said line 40, a "100-line" sprite zone of
140–190, which is 50 lines, and a scroller zone of 190–248.) The logo fills the horizontal screen
fully — 320 pixels wide for hi-res, 160 pixels wide for multicolor (with 2x pixel
width).

### Color Scheme

Cracktros use 2 to 3 colors maximum. The historically dominant palette is:

- Logo: blue ($06) or light blue ($0E) on black ($00) background
- Scroller bar background: dark blue ($06), text color cyan ($03) or white ($01)
- Sprite chain: white ($01) or yellow ($07)
- Border: black ($00) always

This palette comes from early-1980s European scene taste, influenced by the default
C64 BASIC screen colors. Modern cracktros sometimes break with it on purpose, and
viewers read the change as a departure from the norm.

### Tune Length

30 to 60 seconds per loop. A 30-second loop is acceptable for intros under 512 bytes
where tune data is the bottleneck. 60 seconds is the comfortable maximum before the
tracker pattern data begins to strain the available RAM in a sub-4KB intro.

### Greetings List

The greetings list is the cracktro's main social function. Groups are listed roughly
in order of alliance strength, close allies first and distant contacts last. Listing
a group is a public mark of respect and is expected to be returned. Groups revise
their lists from release to release as relationships change.

For an agent building a cracktro for functional purposes (a demo framework test, a
toolchain validation), the greetings list can be a stub: `GREETINGS TO ALL CODERS
READING THIS SOURCE CODE`. The format must be present; the content can be anything.

---

## 4K Party Intro

**Archetype:** `party_intro_4k`

The 4K party intro is the form's modern successor. The cracktro format has outlasted
the software piracy that created it. Several groups have kept producing cracktros as releases in their own right through the
2000s and 2010s. Triad (Sweden) has been releasing cracks with attached intros since
the mid-1980s and was still active into the 2010s. Genesis Project and Onslaught
have similarly long release histories with cracktro production as a consistent
component.

At demo parties, the intro compo (productions under 4 KB) continues the cracktro
tradition. The constraint is the same, fitting everything into a small binary, but the
entry competes on its own instead of being attached to a cracked game. The best 4 KB
intros from major parties (Revision, X, Datastorm) combine real-time plasma, vector
objects and polyphonic SID within the cracktro spatial layout.

The cracktro is also a teaching reference. Every element is present in minimal form,
so it is the starting point for learning how the five core C64 techniques interact. A
working cracktro shows that stable raster, side-border, sprite animation, SID playback
and hardware scroll can coexist in a single binary without conflicts.

**Technique fingerprint:** `stable_raster_irq`, `soft_scroll_h`, `sprite_sine_chain`, `sid_play_routine_pattern`

**Common pitfalls:** `raster_irq_first_line_jitter`, `pal_ntsc_tempo_mismatch`

The fingerprint is the cracktro spatial layout the compo entry keeps; the plasma
and vector work that the best entries add is not required of every one and is left
to the brief.

---

## Buildable Reference

### Canonical Recipe

The canonical buildable cracktro is at `../recipes/kickassembler/cracktro-template.md`.
It implements all five elements in KickAssembler. Start a cracktro there: the recipe
provides the full memory map, IRQ handler structure, sprite
sine table, scroller main loop, and SID relocation pattern.

The current revision of that recipe builds a text logo, ten raster bars from a
chained IRQ ring, a sine scroller and a SID play call, and says in its synopsis that
it no longer opens the side borders or drives a sprite layer; those two come from
`../recipes/kickassembler/sideborder-open.md` and
`../recipes/kickassembler/sprite-sine-chain.md`. Read the recipe's own synopsis for
what it builds today.

KickAssembler is the primary toolchain for cracktros because it gives cycle-exact
control over the raster timing that `sideborder_open` needs. Oscar64 suits game logic
and high-level demo structure; where the write must land on one
cycle of the line, use hand-assembled KickAssembler.

### Technique Checklist

A complete cracktro combines the following techniques (snake_case names as used in
the knowledge graph):

| Technique | Role in cracktro |
|---|---|
| `stable_raster_irq` | Prerequisite for all timed writes; provides the cycle-stable IRQ baseline |
| `sideborder_open` | Opens left and right borders; requires `stable_raster_irq` |
| `sprite_sine_chain` | Phases the eight sprites of the middle band along one table (sweep, bounce, logo); `sprite_multiplex_8` is only needed above eight objects |
| `sprite_multiplex_24` | Alternative for showier intros with more than 8 simultaneous objects |
| `soft_scroll_h` | Drives the bottom scroller bar one pixel per frame |
| `sid_play_routine_pattern` | Standard init+play convention for the background SID tune |

These six names can be passed directly to `c64_check_compatibility` to detect register
conflicts before writing a line of code. The primary known conflict is that
`sideborder_open` and `sprite_multiplex_24` both require IRQ handlers at multiple
raster lines, so the IRQ schedule must be planned so the handlers do not collide.
`sprite_multiplex_8` does not have this problem because it operates in a single
raster band.

---

## Cross-References

- `./demo-design-philosophy.md` — broader scene philosophy; cracktros as the atomic
  unit of demo culture
- `../recipes/kickassembler/cracktro-template.md` — the canonical buildable recipe
  for a complete cracktro in KickAssembler
- `../techniques/sprite.md` — `sprite_multiplex_8` and `sprite_multiplex_24`
  implementation details, sine table patterns, sprite chain construction
- `../techniques/scroll.md` — `soft_scroll_h` implementation; scroller buffer
  management; fine-scroll register protocol
- `../techniques/raster.md` — `stable_raster_irq` and `sideborder_open`; the
  one-write-per-line cycle-56 timing
- `../techniques/music-sid.md` — `sid_play_routine_pattern`; SID binary relocation;
  init/play entry point conventions
