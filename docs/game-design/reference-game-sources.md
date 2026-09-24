<!-- doc-type: reference -->

# Reference Game Sources: what an agent may read, and what it may copy

When a mechanism is not in this knowledge base, read a complete game that
does it. This page lists the public C64 game, engine,
loader and packer sources, what each holds, the licence each states, and
what this repository may do with it. The repository is BSD-3-Clause
(`LICENSE`), so a source's licence decides whether its code or text can
enter a page here.

Every licence below was read at its source on 2026-09-23: the repository's
`LICENSE` file, the licence section of its README, the file headers, or the
site footer. "No licence" means none was found in those places. Nothing on
this page is legal advice; it records what each source says.

---

## The sources

"Adapt" means code may be adapted with attribution and the licence notice
kept. "Facts only" means read it for mechanisms, formats, table layouts and
names; write original code and prose.

| Source | URL | What it holds | Licence as stated (where read) | This KB may | Already cited by |
|---|---|---|---|---|---|
| c64gameframework (Lasse Öörni, Cadaver) | https://github.com/cadaver/c64gameframework | Multidirectional scrolling game framework: scroll, 24-sprite multiplexer, sprite cache, actors, loader, level and sprite editors. A modified version runs MW ULTRA (repository description). | MIT, full text in the README "License" section, "Copyright (c) 2018-2026 Lasse Öörni". There is no `LICENSE` file, so GitHub's licence field shows none. | Adapt | `techniques/logic.md`, `raster.md`, `scroll.md`, `sprite.md`, `file-io.md`, `loaders-packers.md`, `music-sid.md`; `pitfalls/raster-and-badline.md`; `recipes/kickassembler/easyflash-save.md`, `scroll-panel-split.md`, `sprite-multiplex-game.md` |
| Hessian (Cadaver) | https://github.com/cadaver/hessian | A complete action adventure game. | README "Code license": program code (`.s` files excluding story and dialogue text), tool code and build scripts are MIT. README "Content license": graphics, levels, music, sound effects and story text are "All rights reserved". | Adapt the code; do not use the content | `techniques/logic.md` |
| Steel Ranger demo (Cadaver) | https://github.com/cadaver/steelranger-demo | Source of the free demo of Steel Ranger. | README: code, tools and build scripts MIT (2016-2018); graphics, levels, music, sound effects and text "All rights reserved". | Adapt the code; do not use the content | none |
| Other Covert Bitops sources: Metal Warrior 1 to 4, MW4 Dojo Preview, Escape From New York, BOFH, Advanced Action Movie Simulator, the Amiga and GBA ports | https://cadaver.github.io/games.html | Zipped game sources. Steel Ranger 2 and MW ULTRA have no source link there. | No licence. `games.html` states none; `mw4src.zip` (V1.2) holds no licence file, and its `readme.txt` and `doc/manual.txt` state none. | Facts only | none |
| Cadaver's articles ("rants") | https://cadaver.github.io/rants/ | Articles on multiplexing, scrolling, interpolation, sprite caches, loaders. | No licence (issue #21 records none). | Facts only | `techniques/logic.md`, `scroll.md`, `sprite.md`, `loaders-packers.md`, `text-mode-render.md`; `recipes/kickassembler/sprite-multiplex-game.md`, `recipes/oscar64/iffl-kernal-skip.md` |
| Bitfire (Tobias Bindhammer, Bitbreaker) | https://github.com/bboxy/bitfire | Demo loader and framework with a built-in decompressor. | BSD-3-Clause, `LICENSE` file, "Copyright (c) 2021, Tobias Bindhammer". | Adapt | `pitfalls/loader.md`, `techniques/loaders-packers.md` |
| Sparkle (Sparta/OMG) | https://github.com/spartaomg/SparkleCPP | IRQ loader and disk linker. | BSD-3-Clause, `LICENSE` file, "Copyright (c) 2019-2026, Sparta/OMG". | Adapt | `pitfalls/loader.md`; `techniques/loaders-packers.md`, `memory-banking.md`; `recipes/kickassembler/irq-owns-port.md` |
| Krill's Loader (Gunnar Ruthenberg) | `loader-v194.zip` from CSDb ("Repository Version 194"); there is no public git repository (`techniques/loaders-packers.md`) | IRQ loader, drive code, decompressors, bundled tools. | README "License" section in the v194 zip: BSD-3-Clause wording, "Copyright 2022 Gunnar Ruthenberg", with a credit request ("Loader by Krill") and a binary clause that wants that credit in the production or in documentation inside the release archive; a website credit alone does not count. Third-party tools and decompressors in the zip keep their own licences. | Adapt, with the credit in the release | `techniques/loaders-packers.md`, `input.md`; `pitfalls/loader.md`, `cia.md`; `formats/iec-disk-reference.md`, `c64-file-formats.md`; `hardware/cia-reference.md`; `toolchains/cc65-reference.md`; `c64-failure-patterns.md`; the game and demo design pages |
| TSCrunch (Antonio Savona) | https://github.com/tonysavon/TSCrunch | Byte-aligned LZ+RLE cruncher and three 6502 decrunchers. | Apache-2.0, `LICENSE` file. | Adapt, with the notice | `techniques/loaders-packers.md` |
| Exomizer (Magnus Lind) | https://bitbucket.org/magli143/exomizer | Cruncher (C) and decrunchers for several assemblers. | Current master: zlib-style headers, "for any purpose, including commercial applications" (read in `src/exo_main.c`, `src/search.c`, `exodecrs/exodecrunch.s`, `exodecrs/kick/exodecrunch.asm`). Older copies differ: the Exomizer 3.1 inside Krill's v194 zip has cruncher C files that say "non-commercial, non-profit", while its decrunchers say "any purpose". The GitHub mirror `bitshifters/exomizer` has no licence file. | Adapt a current decruncher, keeping the notice and marking changes | `techniques/loaders-packers.md`; `pitfalls/loader.md`; `art/asset-pipelines.md`; the game and demo design pages |
| Oscar64 (drmortalwombat) | https://github.com/drmortalwombat/oscar64 | The C compiler, its runtime library and headers, samples. | GPL-3.0, `LICENSE` file. No runtime-library exception was found in `LICENSE` or the README, and the installed `include/` files carry no notice. | Use as a tool; facts only from its source. Whether a PRG that links its runtime library is affected is not settled here. | `toolchains/oscar64-reference.md`, `oscar64-headers-reference.md`; `recipes/oscar64/attract-replay.md`, `pal-ntsc-detect.md` |
| drmortalwombat's Oscar64 games: Corescape, Plekthora, MetalMayhem, zombies, ballnchain, minotrace, bunkerdigger, shalldom; OscarTutorials | https://github.com/drmortalwombat | Complete games written in Oscar64 C. | GPL-3.0: `LICENSE` file read for Corescape; GitHub's licence field says GPL-3.0 for every one listed. | Facts only | Corescape: `techniques/logic.md`, `raster.md`, `sprite.md` |
| mwenge's disassemblies: Uridium (Braybrook), Iridis Alpha and Gridrunner (Minter) | https://github.com/mwenge/uridium, https://github.com/mwenge/iridisalpha, https://github.com/mwenge/gridrunner | Commented, buildable reverse-engineered source of commercial games (64tass). | No licence. No `LICENSE` file and no licence wording in any of the three READMEs. The READMEs make no claim over the games. | Facts only | Iridis Alpha: `techniques/logic.md` |
| Mark Moxon's annotated C64 Elite | https://github.com/markmoxon/elite-source-code-commodore-64 and https://elite.bbcelite.com | The 1985 Bell and Braben source, reformatted and annotated. | README, "A note on licences, copyright etc.": no licence, "intentionally no `LICENSE` file"; readers may "read and fork this repository... but that's it". Game copyright D. Braben and I. Bell 1985; commentary copyright Mark Moxon. | Facts only | `techniques/effects-vector-3d.md`, `maths.md`; `recipes/kickassembler/wireframe-ships.md` |
| Lode Runner reverse engineering (XekriRedmane) | https://github.com/XekriRedmane/lode_runner_reveng | Literate source of the Apple II Lode Runner (1983) that assembles to the original. | README "License": CC BY-SA 4.0. The README says nothing about the game's own rights; the game is Doug Smith's and Broderbund's. | Facts only | `techniques/logic.md` |
| a2-lode-runner (fschuhi) | https://github.com/fschuhi/a2-lode-runner | Research notes and a browsable site built on the repository above. | README "License and attribution": its own scripts and tests MIT (`LICENSE`); the research material and documentation CC BY-SA 4.0 (`LICENSE-CC-BY-SA-4.0.md`); "Rights in the original game ... remain with their holders." | Facts only | `techniques/logic.md` |
| Ultima IV Remastered (Per Olofsson, MagerValp) | https://github.com/MagerValp/u4remastered | The C64 Ultima IV rebuilt with new loaders; builds with cc65 from the original disk images, which the repository does not include. | README "License and Copyright": code Apache 2.0, "© 2006-2015 Per Olofsson"; new graphics and intro music are their artists' copyright; the original game "© 1985 Origin Systems". | Adapt Olofsson's code, with the notice; the game data is not his | none |
| Codebase64 wiki | https://codebase.c64.org/ | Routines and articles, including a game sources section. | Footer: "CC Attribution-Noncommercial-Share Alike 4.0 International", "Except where otherwise noted". | Facts only (non-commercial and share-alike terms do not fit a BSD repository; `game-design/production-planning.md` says the same) | `hardware/` references; `techniques/scroll.md`, `sprite.md`, `logic.md`, `memory-banking.md`, `cpu-cycle-tricks.md`, `text-mode-render.md`; `recipes/kickassembler/reu-dma.md`; the game design pages |
| C64-Wiki | https://www.c64-wiki.com/ | Reference articles on the machine, games and people. | Footer: "Content is available under GFDL unless otherwise noted." The version is not stated on the copyrights page. | Facts only | `hardware/` references; `pitfalls/cia.md`, `kernal-and-io.md`, `sid.md`; `techniques/scroll.md` |
| Microchess (Peter Jennings), on 6502.org | https://6502.org/source/games/uchess/uchess.htm | 6502 chess program, adapted for a serial terminal by Daryl Rictor. | Page: "MicroChess (c) 1996-2002 Peter Jennings"; the poster was "given permission to distribute this program"; "Please get his permission if you wish to re-distribute a modified copy". | Facts only | `techniques/logic.md` |

---

## Rules for this KB

- **The KB ships original code.** Every listing here is written for the page
  and built by `npm run check:listings`. MIT, BSD, Apache and zlib code may
  be adapted with attribution and its notice kept, but no page has done so
  yet; keep writing original listings unless the maintainer decides
  otherwise.
- **Prose is always original.** Do not paste a source's text, even from an
  MIT repository.
- **Facts only** for GPL sources, sources with no licence, CC BY-NC-SA and
  GFDL wikis, and disassemblies of commercial games. A disassembly's stated licence
  describes the repository; the READMEs here make no claim over the games
  themselves.
- **Game content is not code.** Hessian's and Steel Ranger's graphics,
  levels, music and text are all rights reserved, even though their code is
  MIT.
- **Cite by URL** in the page's Sources section, with the licence in
  brackets and the file you read, as `techniques/logic.md` does:
  `https://github.com/cadaver/c64gameframework (MIT): actor.s`. Say "facts
  only" beside a source that is not open for copying.
- **Check the licence again before adapting.** Licences change: Exomizer's
  cruncher moved from non-commercial terms to zlib-style ones between the
  copy in Krill's v194 zip and the current master.

---

## Sources

- Licence texts read with `gh api repos/<owner>/<repo>` (licence field),
  `gh api repos/<owner>/<repo>/contents/LICENSE` and
  `gh api repos/<owner>/<repo>/readme`, for every GitHub repository in the
  table, 2026-09-23.
- https://cadaver.github.io/games.html and
  https://cadaver.github.io/games/mw4src.zip (files listed and read).
- https://bitbucket.org/magli143/exomizer, raw file headers on `master`.
- `loader-v194.zip` (Krill's Loader, Repository Version 194): `loader/README`
  "License", and `loader/tools/exomizer-3.1/src/*.c` and `exodecrs/`
  headers.
- https://codebase.c64.org/doku.php?id=start (footer).
- https://www.c64-wiki.com/wiki/C64-Wiki:Copyrights (footer).
- https://6502.org/source/games/uchess/uchess.htm.
