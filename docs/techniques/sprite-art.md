---
category: sprite
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Sprite Art Techniques

How C64 artists made sprites look good inside the hardware limits: hires
overlays, colours chosen by luminance, drawing for the 2:1 multicolour
pixel, light and outline, and the racing car seen from behind. The mode
rules themselves are in `../art/art-production-reference.md` ("Sprite Art
Principles") and `../hardware/vic-ii-reference.md`.

Every claim names its source or its rung. "Measured from a rip" means a
sprite sheet ripped by someone else, downloaded from The Spriters Resource
and counted with PIL here: the pixels are the rip's, the counting is ours.
Nothing here ran the original games.

Multicolour sprite colours, for reference (`../hardware/vic-ii-reference.md`):
bit pair 01 is `$D025`, 10 is the sprite's own `$D027+n`, 11 is `$D026`.
Two of the three colours are shared by every multicolour sprite, unless
a raster interrupt changes them between lines.

---

## hires_sprite_overlay — Hires sprite over a multicolour sprite

**Complexity:** low
**Region:** both
**Uses registers:** D01C, D025, D026, D027, D028
**Uses kernal:** (none)
**Cost:** sprites_per_line=4
**Cost basis:** derived-listing
**Cost measured on:** kickassembler-rear-view-car-overlay (one overlay over a body three sprites wide)

### Why

A multicolour sprite has three colours at half horizontal resolution. A
face, an outline or a number plate needs single-pixel detail and often a
fourth colour. A hires sprite at the same position adds one colour at full
resolution on top.

### How

1. Draw the fill as a multicolour sprite (`$D01C` bit set).
2. Draw the detail as a hires sprite (`$D01C` bit clear) in one colour,
   for example black for outlines or white for highlights.
3. Give the overlay the lower sprite number. Sprite 0 is drawn in front of
   1, 1 in front of 2, and so on (`../hardware/vic-ii-reference.md`,
   "Priority"). With the numbers the other way round the fill hides the
   overlay wherever the fill is not transparent: measured in the recipe
   below, 50 of 62 overlay pixels vanished.
4. Move both sprites together, every frame.

### Cost

Each overlaid object uses two hardware sprites per column, so the sprites
available on a raster line halve. A poster on the Ocean Experience forum
put it this way: "it halved the number of sprites on a line - which is why games
like NZS had a mixture of overlays and multi colured sprites" (Paulie,
Ocean Experience forum,
https://oceanexp.proboards.com/thread/303/sprite-overlays-c64-games-who).
In the same thread: Ocean's multiplexers had to sort the overlay ahead of
its fill, and on Robocop John Meegan drew the bullets in characters to get
sprites back.

DMA: a run of k consecutively numbered sprites costs 3 + 2k cycles a line;
a gap in the numbering starts a second run with its own 3-cycle lead-in
(measured in VICE, `../hardware/vic-ii-reference.md`, "Sprite DMA").
Number each overlay just below its fill sprites so the line stays one run.

An overlay need not cover the whole object. In the recipe one hires sprite
covers the middle column of a body three sprites wide, so the line holds
four sprites, not six.

### Games

Named by Simon Butler, an Ocean artist, in the thread above: Platoon (1986,
Ocean's first use, at his suggestion), Combat School (1987), Target
Renegade (1988, his characters). He took the idea from Odin's Heartland
(1986) and credits Rupert and the Toymakers' Party (Quicksilva, coder
Martin Walker) as the likely origin. Paulie adds Robocop, New Zealand Story
and Dragon Ninja. Other titles circulate in forum lists; they are not
repeated here because no source was read.

### Recipes

- `recipes/kickassembler/rear-view-car-overlay.md`

---

## sprite_luma_colours — Choosing $D025, $D026 and the sprite colour by luminance

**Complexity:** low
**Region:** both
**Uses registers:** D025, D026, D027
**Uses kernal:** (none)

### Why

Three colours read as a shaded form only when they differ in brightness.
Two colours of the same luminance read as one flat tone on a monochrome
display and as low contrast on a colour one.

### How

Pick the three colours from three different rows of this table, dark to
light: shadow or outline, body, lit surface.

| Level | Colours (index) | Pepto's luma | Rec. 601 luma of VICE 3.10's default PAL triple |
|---|---|---|---|
| 0 | black (0) | 0 | 0 |
| 1 | blue (6), brown (9) | 8 | 76, 84 |
| 2 | red (2), dark grey (11) | 10 | 98, 98 |
| 3 | purple (4), orange (8) | 12 | 116, 116 |
| 4 | light blue (14), grey (12) | 15 | 142, 148 |
| 5 | green (5), light red (10) | 16 | 160, 160 |
| 6 | cyan (3), light grey (15) | 20 | 205, 205 |
| 7 | light green (13), yellow (7) | 24 | 220, 234 |
| 8 | white (1) | 32 | 255 |

Pepto's column is his measured scale for the common VIC-II revisions; the
first revision (6569R1) had only five levels, 0, 8, 16, 24 and 32, so many
more colours collide there (https://www.pepto.de/projects/colorvic/). The
last column is 0.299 R + 0.587 G + 0.114 B over the triples in
`../runtime/vice-reference.md`, "The default palette", computed here. The
two sources group the colours into the same nine levels.

Rules that follow from the table (rung 3, arithmetic from it):

- Put the outline or shadow in a shared register. Black in `$D025` serves
  every sprite.
- Put the lit colour in the other shared register if the objects share a
  hue family; otherwise use white or a grey, which suit any hue.
- Put the hue that differs per object in `$D027+n`. Rival cars, enemy
  variants and team colours then cost one register write each.
- Three-colour ramps on three levels: black, red, light red (0, 2, 5);
  brown, orange, yellow (1, 3, 7); blue, light blue, white (1, 4, 8).
- Do not put a pair from one row together as neighbours expecting contrast:
  red with dark grey, green with light red, grey with light blue.

Same-luminance colours alternated on lines blend into a new tint on a PAL
display, because the PAL delay line averages the chroma of adjacent lines
(https://ilesj.wordpress.com/2016/03/30/old-vic-ii-colors-and-color-blending/).
The same page says it does not work on NTSC and does not show in an
emulator without PAL display emulation; it was not measured here.

### Recipes

- `recipes/kickassembler/rear-view-car-overlay.md` (black, red, light red: levels 0, 2, 5)

---

## multicolour_sprite_aspect — Drawing for the 2:1 multicolour pixel and for expansion

**Complexity:** low
**Region:** both
**Uses registers:** D017, D01C, D01D
**Uses kernal:** (none)

### Why

A multicolour sprite is 12 pixels wide and 21 high, and each pixel is two
screen pixels wide. Art drawn in an editor with square pixels comes out
twice as wide on screen as it was drawn. That is the usual cause of
"squashed" sprites.

### How

Draw at the on-screen shape, not the data shape. Pixel sizes on screen, in
hires pixels (arithmetic from `../hardware/vic-ii-reference.md`):

| Mode | `$D01D` X-expand | `$D017` Y-expand | Pixel on screen | Sprite on screen |
|---|---|---|---|---|
| hires | off | off | 1 x 1 | 24 x 21 |
| multicolour | off | off | 2 x 1 | 24 x 21 |
| multicolour | off | on | 2 x 2 | 24 x 42 |
| multicolour | on | off | 4 x 1 | 48 x 21 |
| multicolour | on | on | 4 x 2 | 48 x 42 |

Consequences (rung 3):

- A multicolour sprite with Y-expand only has square pixels. Expanding in
  X as well keeps the 2:1 shape at twice the size.
- A shape that looks round on screen is about half as many multicolour
  pixels wide as it is rows tall: a 20-line wheel is about 10 multicolour
  pixels wide.
- A 45-degree edge on screen steps one multicolour pixel across every two
  rows. One multicolour pixel per row is a shallow slope, about 27 degrees
  from the horizontal.
- A single-pixel vertical line is two screen pixels wide in multicolour.
  Fine detail on a vertical edge needs a hires overlay
  (`hires_sprite_overlay`).
- Expansion adds no detail: the same 63 bytes drawn larger. The racing-car
  rips below use unexpanded sprites side by side for the player car, which
  keeps full multicolour resolution.

No artist's statement of these rules was found; they follow from the pixel
sizes. Whether SpritePad or Spritemate display multicolour pixels at 2:1
was not checked here.

### Recipes

- `recipes/kickassembler/rear-view-car-overlay.md` (36 x 42 multicolour pixels, 72 x 42 on screen)

---

## sprite_light_source_shading — One light source, lit tops, dark undersides, chosen outlines

**Complexity:** low
**Region:** both
**Uses registers:** D025, D026, D027
**Uses kernal:** (none)

### Why

With three colours there is no room for a gradient. Shading has to say one
thing clearly: where the light comes from.

### How

- Choose one light direction, usually from above. Faces that point at it
  take the lightest colour, faces that point away the darkest.
- Avoid pillow shading: light in the middle, dark all round the edge, with
  no direction. General pixel-art sources describe it as shading without a
  light source that looks "pillowy and undefined"
  (https://medium.com/pixel-grimoire/how-to-start-making-pixel-art-4-f57f51dcfa02).
- Outline against the background, not inside the shape. A full dark outline
  separates a sprite from any background; inner lines in the body colour or
  the lit colour keep the shape from looking like a cut-out. In the
  multicolour modes an outline pixel is two screen pixels wide, so an
  outline is heavier than in hires.
- Anti-aliasing with three colours: where a dark outline meets a light
  surface on a diagonal, one pixel of the middle colour at each step softens
  it. The shared colours make this consistent across every sprite.

What the rips show (measured from rips, see `rear_view_car_sprite`): the C64
Out Run car has a full black outline, a red body, and light red on the
upward-facing rear deck and in the tail-light band; the windscreen is left
transparent, so the background shows through it. Turbo Out Run uses black,
red and white the same way.

No C64-specific artist statement on selective outlining or anti-aliasing
was found. The rules above are general pixel-art practice (rung 4) set
against the rips (measured).

### Recipes

- `recipes/kickassembler/rear-view-car-overlay.md` (light from above: light red on the roof and rear deck, red on the rear face, black underneath)

---

## rear_view_car_sprite — Racing car seen from behind

**Complexity:** medium
**Region:** both
**Uses registers:** D000, D001, D010, D015, D017, D01C, D01D, D025, D026, D027
**Uses kernal:** (none)
**Cost:** sprites_per_line=4
**Cost basis:** derived-listing
**Cost measured on:** kickassembler-rear-view-car-overlay (3 x 2 multicolour body plus one hires overlay per row)

### Why

In a behind-the-car racer the player car is on screen all the time, at the
bottom centre, and it is the one object the player reads every frame. It
needs size, a clear outline and readable tail lights, with sprites left
over for rivals and roadside objects.

### What real C64 racers did

Measured from rips (sheet pixels counted with PIL; every car frame was
checked for 2-pixel pairs: zero pairs differed, so every frame is
multicolour):

| Game | Rip | Player car from behind | Sprites | Colours |
|---|---|---|---|---|
| Out Run | https://www.spriters-resource.com/commodore_64/outrun/asset/210392/ | 72 x 42 screen pixels, 36 x 42 multicolour; 11 frames | 3 wide x 2 high, unexpanded | black, red, light red |
| Turbo Out Run | https://www.spriters-resource.com/commodore_64/turbooutrun/asset/195132/ | 72 x 42, 36 x 42 multicolour; 11 frames. Side views 96 and 120 wide (4 and 5 sprites) | 3 x 2, unexpanded | black, red, white |
| Pitstop II | https://www.spriters-resource.com/commodore_64/pitstopii/asset/243085/ | largest 72 x 21; smaller frames 48 x 21 and 24 x 21; the smallest are hires | 3 x 1, then 2, then 1 | black, red, light blue (the rip's RGB values are Pepto's) |

The colour names are inferred from the rips' RGB values, which use the
rippers' palettes. Out Run's shape, measured on the first frame, width in
multicolour pixels per line: the roof is 14 to 18 wide on lines 2–4, the
wing mirrors reach 28 to 30 on lines 5–8, the rear window and deck are 22
to 26 wide on lines 9–14, the car widens to the full 36 by line 18 and
stays 34 to 36 wide to line 41. The lower half is full width.

From text sources:

- Lotus Esprit Turbo Challenge (Gremlin, 1990): the near car is drawn
  with expanded sprites, the distant car with characters; a turning frame in
  the prototype was cut from the release (Games That Weren't,
  https://www.gamesthatwerent.com/2015/11/lotus-esprit-turbo-challenge-early-proto/).
  No C64 rip was found. Lotus Turbo Challenge 2 had no C64 version found.
- Power Drift (Activision, Chris Butler): 230 images over 23 objects, of
  which the player's and rival cars take 16, covering distance, turning and
  climbing; "the sprites are tracked in character mode", and the spinning
  car shifts characters (interview,
  https://codetapper.com/c64/interviews/power-drift-the-butler-does-it-again/).
- Buggy Boy (code Dave Thomas, graphics Bob Thomas): "the real trick
  to make the C64 version more enjoyable was to make the buggy a lot
  smaller"; it has the smallest buggy and the fastest frame rate of the
  8-bit versions
  (http://frgcb.blogspot.com/2022/11/buggy-boy-tatsumitaito-1985.html).
- Chase H.Q. (Ocean): a counter-example. Hardcore Gaming 101 calls it "a
  curious mashup of the machines graphical modes", with a main car sprite
  that "blends into the scenery about as well as orange juice blends with
  milk" (https://www.hardcoregaming101.net/chase-hq/). Not measured here.
- Test Drive: no source on its cars was found.

### How

1. Size: 3 multicolour sprites wide by 2 high, unexpanded (36 x 42
   multicolour pixels). Two of three rips agree; Pitstop II's low F1 car uses
   one row.
2. Colours: three luminance levels (`sprite_luma_colours`). Outline in a
   shared register; body in `$D027+n` so rivals differ by one register
   each.
3. Light from above (`sprite_light_source_shading`): lit colour on the roof
   and rear deck, body colour on the rear face, the darkest colour on the
   bumper, the underside and the tyres. Tail lights in the lit colour inside
   a dark frame.
4. Proportions (from the Out Run rip): the cabin about two thirds of the
   body width, the narrow top part about 40% of the height, the lower half
   full width; the window left transparent. The recipe's car follows these
   proportions; it is drawn here, not copied from the rip.
5. Distance: step down by whole sprites (Pitstop II: 3, 2, 1 wide) or
   switch to characters (Lotus). Expansion is the other route (Lotus's near
   car); it halves horizontal detail.
6. Optional hires overlay over the middle column for the plate and glints
   (`hires_sprite_overlay`), one extra sprite per row. None of the three
   rips uses one.

### Recipes

- `recipes/kickassembler/rear-view-car-overlay.md`
