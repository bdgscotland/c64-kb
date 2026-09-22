---
kind: demo
---

<!-- doc-type: archetype-reference -->

# Cracktro and One-Screen Intro Patterns

The cracktro is the smallest self-contained unit of C64 demo aesthetics. It is a
one-screen production that declares a group's existence, delivers a message, and
exits cleanly. Understanding its conventions is prerequisite to building any larger
demo or game intro, because the cracktro is where every single technique — stable
raster, side-border open, sprite animation, SID player, scroller — appears in its
simplest combined form.

This page is also the archetype reference for demo forms. Each form below is an
`Archetype` node of kind `demo` in the graph, named by its `**Archetype:**` line;
its `**Technique fingerprint:**` line becomes `FEATURES` edges to techniques and its
`**Common pitfalls:**` line `RISKS` edges to pitfalls, and `c64_demo_briefing` reads
them when called with an `archetype` (`../CONVENTIONS-archetypes.md`). Technique
names match H2s in `../techniques/`; pitfall names match H2s in `../pitfalls/`.
A section without an `**Archetype:**` line is prose and is not a node.

---

## History

From approximately 1985 to 1995 the cracktro was a functional artifact. Cracking
groups stripped the copy protection from commercial games and prefixed the cracked
binary with a short intro: the group's name, a scroller message declaring the crack
version and date, greetings to allied groups, and a SID tune. The intro ran until
the user pressed a key, then it jumped into the game.

The cracktro served two purposes simultaneously. First, it was attribution: the
group claimed the crack. Second, it was social infrastructure: the greetings list
embedded in the scroller text was the scene's address book. A group's standing in
the community was partly measured by who greeted them back.

Size constraints were strict because the intro shared memory with the game. Common
limits were 1 KB or less — sometimes 256 bytes — because the cracked game image
had to fit alongside the intro in the C64's 64 KB address space. These constraints
forced extreme economy: every byte of code, every raster line of display time, had
to earn its place.

From the mid-1990s onward, cracktros became increasingly aesthetic objects in their
own right. Groups like Triad, Onslaught, F4CG (Fairlight's successor formation), and
Genesis Project continued releasing cracks with attached intros well into the 2000s
and 2010s. The cracktro format also migrated to demo parties as a compo category:
productions capped at 4 KB compete on the same terms as the 1985 originals. The
cracktro remains alive as a constrained art form distinct from the full demo.

---

## Crack Intro

**Archetype:** `cracktro`

The crack intro is the canonical form, built from five elements. A canonical cracktro
consists of exactly five elements assembled in a fixed spatial
layout. Each element maps to one or more C64 techniques. The five elements are not
optional: omitting any one of them produces something that reads as incomplete to a
scene-literate viewer.

### Group Logo

The logo occupies roughly the top half of the visible screen — approximately 80 to
100 pixels tall, spanning the full 320-pixel width. It is the first thing the viewer
sees and the hardest to get right aesthetically.

Two implementation paths exist. The first is a bitmap logo: a hi-res or multicolor
bitmap loaded into $4000–$7FFF (standard VIC-II bitmap area), with color data in
screen RAM and color RAM. The VIC-II's multicolor bitmap mode (bit 5 of $D011 = 1,
bit 4 of $D016 = 1) gives three colors plus background, which is sufficient for a
bold logo glyph. The second path is a large custom multicolor charset: a 4x4 or 8x4
character-cell logo built from custom character definitions. The charset approach
is smaller in RAM footprint and easier to re-color dynamically, making it the common
choice when the intro must fit under 1 KB.

Regardless of rendering method, the logo is static. Cracktros do not animate the
logo. Animation budget goes to the sprite layer beneath it.

Logo placement in screen coordinates: top edge at raster line ~40 (the first visible
line below the top border), bottom edge at approximately raster line 140. This leaves
roughly 100 raster lines for the sprite layer and 40 lines for the scroller bar.

Color conventions: see Conventions below.

### Side-Border Sprites

The left and right side borders are normally invisible extensions of the border
region; the VIC-II's horizontal blank window cuts them off. Side-border opening
(`sideborder_open`) uses a two-write timing trick in the horizontal blank to trick
the VIC-II into leaving the border generator disabled, exposing roughly 7 pixels
of sprite rendering on each side.

In a cracktro context, side-border sprites are purely decorative: thin vertical bars,
dashed lines, or simple graphic elements that frame the screen. They reinforce the
sense that the intro has pushed the hardware as far as it will go — a deliberate
display of technical competence.

The implementation requirement is a stable raster IRQ (`stable_raster_irq`) firing on
the correct scanline for each horizontal blank crossing. The two VIC-II writes
($D016 wide / $D016 narrow) must land within a ±1 cycle window. See
`../techniques/raster.md` for the exact cycle budget.

In intros smaller than 1 KB, side-border opening is sometimes omitted to save code
space. In any intro above approximately 512 bytes it is expected.

### Sprite-Chain Animation

Eight hardware sprites are available simultaneously. A cracktro typically devotes all
eight to an animated element in the middle of the screen — between the logo and the
scroller bar. Common patterns are a horizontal sweep (sprites moving left-to-right in
a chain, wrapping), a bounce pattern (sprites oscillating vertically at different
phases), or a sine-wave chain that produces a fluid ribbon effect.

The sprite positions are updated in the raster IRQ handler or a main-loop timer. Each
sprite gets an X and Y position computed from a precomputed sine table indexed by a
per-sprite phase offset. The phase advances by a fixed amount each frame, and each
sprite's phase is offset from the previous by a constant (typically 256/8 = 32 units
for an evenly spaced chain over a full sine period).

The chain animation itself (eight sprites phased along one table, the `$D010`
high-bit wrap, the bounce, the expanded-sprite logo) is `sprite_sine_chain` in
`../techniques/sprite.md`, with the recipe `../recipes/kickassembler/sprite-sine-chain.md`;
`sprite_multiplex_8` is a multiplexer and is only needed when more than eight
objects are on screen at once (an earlier version of this page named it for the
chain). For showier intros with more than 8 simultaneous sprite objects, `sprite_multiplex_8`
is replaced by `sprite_multiplex_24`, which reuses the eight hardware sprites across
multiple raster bands. The trade-off is IRQ complexity and a minimum vertical spacing
requirement between bands.

Sprite design in cracktros is constrained by the same color economy as the logo: two
or three colors, chosen to complement the palette of the logo region. Multicolor
sprites (bit set in $D01C) give three colors plus transparent; hi-res sprites give
one color with sharper edges. Cracktros almost universally use multicolor.

### SID Tune

Every cracktro carries a SID tune. The tune plays in the background while the scroller
runs; it loops for as long as the user lets the intro run before pressing a key.

The tune is almost always a standalone SID binary: a composer exports a `.sid` file
from a tracker (GoatTracker, SID Factory II, or older tools like Music Assembler),
and the intro relocates and links it. The player follows the `sid_play_routine_pattern`
convention: an `init` entry point that accepts a song number in the accumulator, called
once at startup, and a `play` entry point called once per frame (every 50 Hz on PAL,
every 60 Hz on NTSC) from the raster IRQ.

In a size-constrained intro (under 1 KB) the SID player is the largest single
component. A minimal three-voice SID routine with one short tune can occupy 200–400
bytes. Some groups ship hand-assembled micro-players for extreme size categories.

Loop length is a social convention as much as a technical one: 30 to 60 seconds is
the expected range. A tune that loops in under 20 seconds becomes annoying. A tune
longer than 90 seconds was historically impractical because the tracker data would
overflow the available RAM.

### Scroller Bar

The scroller is the text layer at the bottom of the screen, typically occupying one
character row (8 raster lines) or a double-height zone (16 lines). It scrolls
horizontally from right to left at a speed of one pixel per frame (50 pixels/second
on PAL), shifting the VIC-II's fine X-scroll register ($D016 bits 2–0) and advancing
a character pointer when the fine-scroll wraps to 7.

Implementation uses `soft_scroll_h` from `../techniques/scroll.md`. The scroller
buffer holds enough characters to fill the screen plus one additional character to
absorb the pipeline delay. New characters are fed from the message string as the
scroll pointer advances.

The scroller bar is positioned at the bottom of the visible display, often with a
distinct background color (set via color RAM for that row) to separate it visually
from the sprite layer. A common layout places it at character row 24 (the last
row before the border).

The text in the scroller is the human-readable content of the cracktro. See Conventions
below for text conventions.

### Size and Exit

The canonical form: one screen, often under 1 KB, sometimes 256 bytes. All five
elements are present in minimal form. The code is hand-optimized machine language
(or KickAssembler with aggressive constant-folding). RAM usage is tracked byte by
byte. The SID tune is the primary size driver. Groups in the extreme-size category
sometimes synthesize audio from a tiny engine rather than shipping tracker data.

The crack intro exits to the game when the user presses a key or fire. The exit
routine patches the game's reset vector or JSRs directly into the game entry point.

The core cracktro pattern scales up and down into the variant formats that follow:
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

A demo intro is the opening part of a longer multi-part demo, released as a
standalone production in its own right. Size ceiling is typically 1 KB to 4 KB.
It may combine the cracktro layout with a simple effect — a plasma, a vector cube,
or a tunnel — that previews the demo's aesthetic. The transition from the intro
screen to the first effect is itself a design moment: fade-to-black, raster wipe,
or hard-cut. The fade is `colour_fade` in `../techniques/transitions.md`, a
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
collection. Functionally the pack intro replaces the exit-to-game logic with a
disk directory reader and a loader invocation. Pack intros from the late 1980s are
some of the earliest examples of C64 software with a designed UI.

**Technique fingerprint:** `stable_raster_irq`, `soft_scroll_h`, `sid_play_routine_pattern`, `multi_load_sequencing`

**Common pitfalls:** `raster_irq_first_line_jitter`, `pal_ntsc_tempo_mismatch`, `fastloader_kernal_dependency`

The loader that replaces the exit-to-game logic is `multi_load_sequencing` in
`../techniques/loaders-packers.md`; which loader sits under it is the pack's choice.

---

## Mini-Demo / Dentro

**Archetype:** `dentro`

The "dentro" (a mid-1990s portmanteau of "demo" and "dentro") is a multi-part
production in the 8 KB to 16 KB range, typically 2 to 4 parts. Each part is a
self-contained effect with its own raster setup and SID tune. A minimal loader
sequences the parts from disk. The dentro format emerged as a middle ground between
the one-screen intro and the full competition demo requiring multiple disk sides.
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

The canonical scroller text follows a well-established template:

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

Logo top edge: no higher than raster line 40 (first line below top border). Logo
bottom edge: no lower than raster line 140. This preserves the 100-line sprite zone
(140–190) and the scroller zone (190–248). The logo fills the horizontal screen
fully — 320 pixels wide for hi-res, 160 pixels wide for multicolor (with 2x pixel
width).

### Color Scheme

Cracktros use 2 to 3 colors maximum. The historically dominant palette is:

- Logo: blue ($06) or light blue ($0E) on black ($00) background
- Scroller bar background: dark blue ($06), text color cyan ($03) or white ($01)
- Sprite chain: white ($01) or yellow ($07)
- Border: black ($00) always

This palette is a historical artifact of early-1980s European scene aesthetics
influenced by the default C64 BASIC screen colors. Modern cracktros sometimes break
with it deliberately as an aesthetic statement, but the departure is always legible
as a deviation from the norm.

### Tune Length

30 to 60 seconds per loop. A 30-second loop is acceptable for intros under 512 bytes
where tune data is the bottleneck. 60 seconds is the comfortable maximum before the
tracker pattern data begins to strain the available RAM in a sub-4KB intro.

### Greetings List

The greetings list is the cracktro's primary social function. Its composition is not
arbitrary: groups are listed roughly in order of alliance strength, with close allies
first and friendly-but-distant contacts toward the end. Listing a group is a public
statement of respect. Being listed earns reciprocal listing. Groups actively curate
their greetings lists across releases as social relationships evolve.

For an agent building a cracktro for functional purposes (a demo framework test, a
toolchain validation), the greetings list can be a stub: `GREETINGS TO ALL CODERS
READING THIS SOURCE CODE`. The format must be present; the content is context-dependent.

---

## 4K Party Intro

**Archetype:** `party_intro_4k`

The 4K party intro is the form's modern reinvention. The cracktro format has outlasted
the software piracy context that created it. Several
groups have continued producing cracktros as releases in their own right through the
2000s and 2010s. Triad (Sweden) has been releasing cracks with attached intros since
the mid-1980s and was still active into the 2010s. Genesis Project and Onslaught
have similarly long release histories with cracktro production as a consistent
component.

At demo parties, the intro compo (productions under 4 KB) functions as the modern
heir to the cracktro tradition. The constraint is identical — fit everything into a
small binary — but the production context is competitive rather than attached to a
specific cracked game. The best 4 KB intros from major parties (Revision, X, Datastorm)
demonstrate what is technically achievable when experienced coders maximize every byte:
real-time plasma, vector objects, and polyphonic SID all within the cracktro spatial
layout.

The cracktro is also used as a pedagogical reference. Because every element is present
in minimal form, it is the ideal starting point for learning how the five core C64
techniques interact. A working cracktro is a proof that stable raster, side-border,
sprite animation, SID playback, and hardware scroll can coexist in a single binary
without conflicts.

**Technique fingerprint:** `stable_raster_irq`, `soft_scroll_h`, `sprite_sine_chain`, `sid_play_routine_pattern`

**Common pitfalls:** `raster_irq_first_line_jitter`, `pal_ntsc_tempo_mismatch`

The fingerprint is the cracktro spatial layout the compo entry keeps; the plasma
and vector work that the best entries add is not required of every one and is left
to the brief.

---

## Buildable Reference

### Canonical Recipe

The canonical buildable cracktro is at `../recipes/kickassembler/cracktro-template.md`.
It implements all five elements in KickAssembler. Readers building a cracktro should
start there: the recipe provides the full memory map, IRQ handler structure, sprite
sine table, scroller main loop, and SID relocation pattern.

The current revision of that recipe builds a text logo, ten raster bars from a
chained IRQ ring, a sine scroller and a SID play call, and says in its synopsis that
it no longer opens the side borders or drives a sprite layer; those two come from
`../recipes/kickassembler/sideborder-open.md` and
`../recipes/kickassembler/sprite-sine-chain.md`. Read the recipe's own synopsis for
what it builds today.

KickAssembler is the primary toolchain for cracktros because it gives cycle-exact
control over the raster timing required by `sideborder_open`. Oscar64 is suitable for
game logic and high-level demo structure, but for a component where every cycle of
the horizontal blank window matters, hand-assembled KickAssembler gives the necessary
precision.

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
raster lines — the IRQ schedule must be planned explicitly to avoid handler collision.
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
- `../techniques/raster.md` — `stable_raster_irq` and `sideborder_open`; cycle
  budget for the horizontal blank window; two-write timing protocol
- `../techniques/music-sid.md` — `sid_play_routine_pattern`; SID binary relocation;
  init/play entry point conventions
