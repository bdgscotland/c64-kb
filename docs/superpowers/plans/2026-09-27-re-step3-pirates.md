# Reverse engineering step 3: Pirates!, the second study

> **For agentic workers:**
> - MiMo-V2.6-Pro implements each task in its own git worktree off
>   `bdgscotland/re-step3-pirates`.
> - Codex (or Claude, when Codex is at its limit) reviews each task.
> - Claude reruns every listing and screenshot check before merging.
> - Steps use checkbox (`- [ ]`) syntax.

**Goal:** the KB can say how a game like Sid Meier's Pirates! is built:
- a BASIC program as the game script, calling machine-code service blocks;
- one bytecode interpreter running every action scene;
- a sailing map with the ship fixed at screen centre;
- an open world played through separate modes.

The work lands as four new techniques, each with a recipe measured in
VICE, a new archetype, and a studied GameDesign page.

**Source:** `data/re/pirates/SYNTHESIS.txt` and the five findings files
beside it (local, gitignored). The claims Claude checked against bytes or
traces are marked [C] there. The game image is the maintainer's copy:
`~/Downloads/PIRATES!_05727_05/PIRATES!.D64`, sha1
`ec94dbfb6908b9c0249958b4aed3dff452096ea3`.

## Global constraints

- Facts only about Pirates!. No code, text, graphics, map or script bytes
  from the game in any committed file. Recipes are original code that
  shows the mechanism, not a copy of the game's routine.
- A number from the study carries its rung: "measured in VICE x64sc 3.10
  on the maintainer's copy". The copy is cracked, and its start-up options
  menu patched five interpreter table entries: say so wherever an opcode
  meaning is quoted.
- Every recipe is built by `npm run check:listings`, run in VICE and
  measured by script (the `verify-listing` skill). It is pinned in
  `docs/recipes/runs.json` with its committed PNG (`npm run verify:recipes
  -- --update` only for the new recipe), and passes
  `npm run claims:recipes`.
- Read the CONVENTIONS file for each doc type before writing: techniques
  `docs/CONVENTIONS-techniques.md`, recipes `docs/CONVENTIONS-recipes.md`,
  game designs `docs/CONVENTIONS-game-designs.md`, archetypes `docs/CONVENTIONS-archetypes.md`. Metadata lines drive the
  graph: after changing them, run `npm run ingest:clean` (only the
  controller does this, at landing).
- Plain English (CLAUDE.md rule 8). A correction to a number an agent may
  have relied on is recorded, not erased (rule 4).
- Commits: named paths, never `git add -A`. The message says what was
  missing and the evidence. Trailer: `Co-Authored-By: MiMo-V2.6-Pro (via
  Claude Opus 5.5) <noreply@anthropic.com>`. No push.
- Worker wording: keep briefs neutral: "fencing scene", "button press",
  "checkpoint is hit". Xiaomi's content filter reads the files MiMo opens.

## Tasks

### Task 1: `scene_bytecode_interpreter` technique and recipe

**Files:** `docs/techniques/logic.md` (a new technique section), a new
recipe `docs/recipes/kickassembler/scene-bytecode-interpreter.md`, its PNG,
and `docs/recipes/runs.json`.

- The technique: one small interpreter runs every animated scene from a
  byte script. Opcodes cover:
  - sprite pose (pointer) and position;
  - poke any address;
  - wait N frames;
  - counted loop;
  - random (SID voice 3);
  - read joystick;
  - branch on a value;
  - end with an event code for the caller.

  Dispatch is a table of handler addresses. Compare a self-modified
  `JMP (table)` (the study's method) with `RTS`-trick dispatch, measured.
- Timing correction (rule 4 style, stated as the lesson from the study):
  Pirates! times its scenes by interpreter pass counts (89 passes a frame,
  measured) and never reads the frame counter. The recipe waits on a frame
  counter set by the raster IRQ, so scene speed does not depend on script
  length.
- The recipe: a script moves two sprites, loops, waits, draws a random
  pose, reads the joystick and ends with an event code the main program
  shows on screen. Measure the interpreter's cost per opcode and per
  frame with a trace and write the figures on the page.
- `**Uses registers:**`, `**Demands:**` and `**Requires:**` lines per
  conventions. The "In Pirates! (1987)" paragraph quotes the study's
  measured facts: dispatch at `$A4A8`/`$A4EC`, 128-entry table, no sound
  opcodes, flat-out timing.
- **Proof:** check:listings, a verify:recipes PNG, claims:recipes, and the
  measured screenshot showing the event code and both sprites at their
  scripted end positions.

### Task 2: `basic_ml_service_blocks` technique and recipe

**Files:** `docs/techniques/memory-banking.md` or `logic.md` (choose by
conventions and say why), a new recipe, its PNG, `runs.json`.

- The technique: a BASIC program is the game script. It calls fixed-address
  machine-code blocks through a parameter convention (POKE to zero page or
  a parameter page, then SYS; results by PEEK). Include how the BASIC
  program protects machine code (MEMSIZ/FRETOP below the code) and the
  study's program swap between phases, as a described variant.
- The recipe: a tokenized BASIC program (KickAssembler can emit the bytes;
  or use petcat if installed, and say which) calls a machine-code window
  routine with five parameters and reads a result back. Measure SYS
  overhead and the routine's cost.
- **Proof:** as Task 1.

### Task 3: `centred_sprite_map_scroll` technique and recipe

**Files:** `docs/techniques/scroll.md`, a new recipe, its PNG, `runs.json`.

- The technique: the player's sprite is fixed at screen centre with
  heading poses; the world window is redrawn from a map every few frames,
  and the fine scroll goes to the raster IRQ through one dirty byte. The
  IRQ never reads the map; the map code never writes `$D011`/`$D016`.
- The recipe: a character map larger than the screen, a centred sprite
  with 8 or 16 headings (link `facing_turn_step`), joystick steering, a
  step every N frames. Measure the redraw cost against the frame and state
  PAL and NTSC.
- **Proof:** as Task 1, plus a screenshot pair showing the window moved by
  the expected amount.

### Task 4: bank-swap trampoline

**Files:** `docs/techniques/memory-banking.md` (a section in
`ram_under_kernal`, or a technique of its own if conventions demand one),
and a listing built by check:listings.

- A nesting-safe `$01` save and restore: the entry stores the caller's
  `$01` into the operand of the exit's `LDA #`, so calls nest without a
  stack. The study's instance is at `$9509`/`$9523`.
- **Proof:** check:listings. If it draws, a VICE run.

### Task 5: archetype `open_world_modes`

**Files:** `docs/game-design/c64-game-archetypes.md`.

- A world map the player travels, with separate modes (menus, trading,
  action scenes) chosen by events and a calendar.
- Reference: Pirates! (1987), measured here. Elite (1985) fits the shape
  but is not measured; say so.
- Brief words must not collide with `top_down_adventure`: "open world",
  "sailing", "trading", "career", "mini-games". Run
  `node src/cli.ts game-briefing "<brief>"` for three briefs and check the
  routing, and run the router tests.

### Task 6: the Pirates! study (Claude, with MiMo drafting)

**Files:**
- `docs/game-design/studies/sessions/pirates.json`: the sea variant, the
  one that reaches the sailing map;
- `docs/game-design/studies/observations/pirates.json`;
- `docs/game-design/studies/pirates.md`.

- The page follows `commando.md`: `kind: studied`,
  `**Game design:** pirates_1987`, `**Instance of:** open_world_modes`,
  `**Studied from:**`, `**Composes:**` (the techniques observed, the new
  ones included), `**IRQ chain:**`, `**Memory map:**`,
  `**Diverges from archetype:**`, the fixed H3 sections, and Evidence
  giving each claim's rung and observation ID.
- The session file holds PCs, register values and clocks only.
- Say what was not reached: sea battles, land battles, trading, and the
  world map's cell encoding.

### Task 7: method page and landing

- `docs/workflow/game-study-method.md` gets what Pirates! taught:
  - edge-triggered menus need one-frame presses (once-entries);
  - a text search for `$DC00` misses indexed and pointer reads, so use a
    load checkpoint;
  - BASIC-driven games (the input is a PEEK, reached through the BASIC
    ROM);
  - long sessions and streamed logs (#134);
  - when a trace clock does not match the session's staging.
- `docs/game-design/reference-game-sources.md`: a row for the image,
  facts only.
- Versions: `KB_DATA_VERSION` past main. `KB_SCHEMA_VERSION` only if the
  graph shape changes. The CHANGELOG entry says what was missing and the
  evidence.
- Gates: everything in CLAUDE.md's gate list, `npm run ingest:clean`,
  then check that `c64_game_briefing` routes "open world sailing game" to
  `open_world_modes` and names `pirates_1987` as studied.

## Order

Tasks 1, 3 and 4 run in parallel: each is a different technique file, but
all three touch `runs.json`, so merge them one at a time with the key-union
script. Then Task 2. Task 5 after 1-4, so the archetype can name the new
techniques. Task 6 after 5. Task 7 last.
