# Art research brief for #140

Scratch brief, not a KB page. Each claim has its source. "Measured here" means I downloaded the
ripped sheet and counted pixels with PIL (script in my scratchpad); the rip itself is third-party,
so the rung is "measured from someone else's rip", not "ran the game".

## 1. Hires overlay over multicolour

- Technique: a hires (1-colour, full-resolution) sprite placed over a multicolour sprite at the
  same position, giving an outline/detail colour on top of a 3-colour fill.
  Source: Lemon64 thread "Sprite Overlay" https://www.lemon64.com/forum/viewtopic.php?t=13782
  (via search summary; Lemon64 returned 403 to WebFetch).
- Cost: it halves sprites per line, because each object uses two sprites. Ocean reworked its
  multiplexers so the overlay sorted with higher priority (lower sprite number) than its fill.
  Source: Paulie, Ocean Experience forum
  https://oceanexp.proboards.com/thread/303/sprite-overlays-c64-games-who
- Games, as named by Simon Butler (Ocean artist) in the same thread: Platoon (1986, first Ocean
  use), Combat School (1987), Target Renegade (1988, he was character designer). He says he took
  the idea from Odin's Heartland (1986) and that Rupert and the Toymakers' Party (Quicksilva,
  Martin Walker) "appears to be in fact the originator". Paulie adds Robocop, New Zealand Story
  (mixed overlays and plain multicolour), Dragon Ninja. Same URL.
- Other games named (Lemon64 thread, search summary only, not read in full): Run the Gauntlet,
  Cabal, Addams Family, Daley Thompson's Olympic Challenge, Batman the Movie, Last Ninja,
  Rick Dangerous, The Untouchables; Turrican 1 and 2 used two multicolour sprites plus one
  Y-expanded hires sprite. Treat as rung 4 until someone opens the thread.
- John Meegan (Robocop) software-rendered bullets into characters to get around the halved
  sprites-per-line. Source: oceanexp thread above.
- DMA cost: each enabled sprite on a line costs the VIC its p- and s-accesses (2 cycles per
  sprite plus the bus takeover overhead). Use the KB's own figures in
  docs/hardware/vic-ii-reference.md, not a number from me.

## 2. Choosing colours by luminance

- Pepto's measured luma levels (revised VIC-II, "most common"), in his units:
  0 black; 8 blue, brown; 10 dark grey, red; 12 purple, orange; 15 grey, light blue;
  16 green, light red; 20 light grey, cyan; 24 yellow, light green; 32 white.
  First revision (rare 6569R1): only 0, 8, 16, 24, 32.
  Source: https://www.pepto.de/projects/colorvic/
- Same-luma colours blend when alternated on lines (PAL delay line averages chroma); the bigger
  the luma gap, the more visible the dither. Sources: https://ilesj.wordpress.com/2016/03/30/old-vic-ii-colors-and-color-blending/ ,
  https://www.pagetable.com/c64ref/colors/ . The ilesj page says this blend does not show in
  emulators without PAL monitor emulation, and does not work on NTSC.
- Consequence for sprites (my inference, rung 3 from the table above): a 3-colour sprite reads
  as shaded only if its three colours sit on three different luma levels, e.g. black (0) /
  red (10) / light red (16), or brown (8) / orange (12) / yellow (24). Two same-luma colours
  (red + dark grey, green + light red) read as one flat tone on a monochrome display and as
  low contrast on colour.

## 3. Designing for the 2:1 pixel and expansion

- Multicolour sprite = 12×21 pixels, each 2 hires pixels wide; two of the three colours are
  global ($D025/$D026). Source: Cosmigo Pro Motion C64 docs
  https://www.cosmigo.com/promotion/docs/onlinehelp/gfxHardware-c64.htm
- X-expanding a multicolour sprite gives 4-hires-pixel-wide pixels. Source: Lemon64 sprite
  overlay thread (search summary).
- Real racing cars below (section 5) were NOT X-expanded: Out Run, Turbo Out Run and Pitstop II
  all draw the car from unexpanded multicolour sprites side by side. Measured here.
- No artist source found for "diagonals in 2-px steps" or proportion rules. Unsourced.

## 4. Shading, outlines, pillow shading

- Pillow shading = shading inward from the outline with no light source; avoid it, pick one
  light source. General pixel-art sources, not C64-specific:
  https://medium.com/pixel-grimoire/how-to-start-making-pixel-art-4-f57f51dcfa02 ,
  https://makegames.tumblr.com/post/42648699708/pixel-art-tutorial
- C64-specific artist statement on selective outlining or anti-aliasing with $D025/$D026:
  not found. Unsourced. What the rips show (section 5) is the concrete evidence instead.

## 5. Racing cars seen from behind

Measured here from Spriters Resource rips (sheet sizes in hires pixels; every car frame had zero
pixel pairs that differ, i.e. every frame is multicolour with 2-wide pixels):

| Game | Sheet | Rear-view car | Sprites | Colours in the frame |
|---|---|---|---|---|
| Out Run (US Gold/Probe) | https://www.spriters-resource.com/commodore_64/outrun/asset/210392/ | 72×42 hires = 36×42 MC pixels, 11 frames | 3 wide × 2 high, unexpanded MC | black, a dark red, a light red (+ transparent windscreen) |
| Turbo Out Run | https://www.spriters-resource.com/commodore_64/turbooutrun/asset/195132/ | 72×42 = 36×42 MC, 11 frames; side views 96–120×42 (4–5 sprites wide) | 3×2 unexpanded MC | black, red, white |
| Pitstop II (Epyx) | https://www.spriters-resource.com/commodore_64/pitstopii/asset/243085/ | largest 72×21 (3×1 sprites); then 48×21 (2×1); then 24×21 (1); the smallest far frames are hires single-colour (pairs differ) | 3, 2, 1 | black, red, light blue (Pepto RGB exactly) |

Out Run rear-view frame, measured here (1 char = one MC pixel; `#` black, `r` dark red,
`p` light red, `.` transparent). Shape facts: full black outline; 36 MC px wide by 42 lines
(aspect on a PAL screen ~ 72:42 hires, i.e. wider than tall); the cabin/roof occupies the top
~14 lines and is narrower (about 24 px); bumper and tail-light band span the full width; two
black wheel stubs at the bottom corners; the windscreen is left transparent.

```
............##......................
...........##############...........
..........#####rrrrrrr##r#..........
.........#r##############r#.........
....##...#r####..##..####r#...##....
...#rr###r#####.#pp#.#####r###rr#...
...
#prprrrrrrrrrrrrrrrrrrrrrrrrrrrrprp#
#rrprrppprrrrppprrrppprrrrrppprrprr#
...
####rrrrrrrrr##########rrrrrrrrr####
#####rr#rrrrrrrrrrrrrrrrrrrr#rr#####
##.####.####################.####.##
```

Text sources:
- Lotus Esprit Turbo Challenge (C64, Gremlin 1990, conversion Ashley Bennett per FRGCB):
  near car = X/Y "expanded sprites"; far car = characters; an extra turning frame from the
  prototype was cut. Source: https://www.gamesthatwerent.com/2015/11/lotus-esprit-turbo-challenge-early-proto/
  , http://frgcb.blogspot.com/2014/11/lotus-esprit-turbo-challenge-gremlin.html
- Lotus Turbo Challenge 2: no C64 version found (Amiga/ST/Archimedes). Do not cite.
- Power Drift (C64, Chris Butler): 230 images over 23 objects; the player's and rival cars take
  16 images covering distance and turning/climbing states; "sprites are tracked in character
  mode"; spinning car done by shifting characters. Source:
  https://codetapper.com/c64/interviews/power-drift-the-butler-does-it-again/
- Chase HQ (C64, Ocean): car sprites widely criticised; described as small and "featureless".
  Source: https://www.hardcoregaming101.net/chase-hq/ (search summary). A negative example.
- Buggy Boy (C64, Dave Thomas code, Bob Thomas graphics): "the real trick ... was to make the
  buggy a lot smaller", the smallest buggy of the 8-bit ports and the fastest frame rate.
  Sources: http://frgcb.blogspot.com/2022/11/buggy-boy-tatsumitaito-1985.html ,
  https://genesistemple.com/quirky-weird-c64-buggy-boy
- Test Drive: no rip or text found for its rear-view cars. Unsourced.
- No rip found on Spriters Resource for C64 Lotus, Power Drift, Chase HQ, Buggy Boy.

## What the rips say for the racer (#110)

1. Rear-view player car = 3 MC sprites wide × 2 high (36×42 MC px), unexpanded. Two games agree
   (Out Run, Turbo Out Run); Pitstop II uses 3×1 (36×21) for a low F1 car.
2. Three luma-separated colours: black outline + dark body + light highlight (Out Run:
   black/red/light red; Turbo Out Run: black/red/white).
3. Full black outline; windscreen transparent.
4. Distant cars step down by whole sprites (3 → 2 → 1 wide in Pitstop II), the smallest in hires.
