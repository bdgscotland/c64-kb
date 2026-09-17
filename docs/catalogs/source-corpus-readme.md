# c64-kb source corpus catalog

> **Status: manifest only.** This is a list of where things are. None of the
> sources below has been ingested into the knowledge base; the corpus under
> `docs/` is original prose written for this project. The ingest pipeline
> reads `docs/` and nothing else.

`c64_source_corpus_catalog.json` — 71-entry manifest of **source-bearing** C64 games, demos, libraries, and tutorial code. Companion to `c64_resource_catalog.json` (137 entries, schema-scaffolding sources).

## What this is for

The first catalog tells your c64-kb *what exists* — chips, registers, file formats, tools. This one tells it *how good practitioners actually write code* using those tools. Designed to feed Claude Code when the harness asks it to autonomously develop a C64 game or demo: it queries this catalog for reference implementations of each technique it needs, ingests the highest-ranked source, and uses author comments + companion articles as ground truth.

## Coverage at a glance

```
By type:                    original-release 21 | tutorial-sample 19
                            reverse-engineering 14 | tool-source 7
                            technique-isolate 6 | engine-framework 4

By form:                    game 22 | tutorial-series 14 | snippet-collection 11
                            library 8 | demo 6 | tool 4 | engine 3 | intro 3

By language (top):          6502-asm 45 | KickAssembler 7 | C-Oscar64 5
                            cc65/C 2 | Millfork 1

By pedagogical level:       beginner 9 | intermediate 19 | advanced 22 | expert 16

By priority:                critical 13 | high 34 | medium 20 | low 4

Distinct techniques:        46 tagged
Top 5 coverage depth:       sprite-multiplexing-ocean (29 entries)
                            raster-interrupt-stable (28)
                            sid-playroutine-custom (27)
                            char-mode-scroll (16)
                            fastloader-integration (14)
```

## Author concentrations

- **Cadaver / Lasse Öörni** (Covert Bitops): 7 entries — Hessian, Steel Ranger demo, MW4, c64gameframework, c64loader, oldschoolengine2, rants. The single highest-value author corpus on GitHub: shipping commercial-grade games + canonical tutorial articles, all MIT.
- **lft / Linus Åkesson**: 8 entries — Spindle, Craft, Nine, Quondam Tunneling, A Mind Is Born, Lunatico/MISC, sprite Y-sort article, pitch article. Demoscene state-of-the-art, every entry has a companion article explaining why the code works.
- **drmortalwombat**: 6 entries — Oscar64 compiler + Corescape, Minotrace, Zombies, Plekthora, OscarTutorials. Proves C/C++ is viable for action games when targeting Oscar64.
- **mwenge**: 5+ entries — reverse-engineered Uridium, Morpheus, Iridis Alpha, Psychedelia, Llamasource collection. Plus a dedicated "Common Patterns in Llamasoft C64 Assembly" overview document.
- **Mark Moxon**: cross-platform Elite disassemblies (BBC, Apple II, NES, C64) — most exhaustively commented disassembly project anywhere.
- **Maciej Małecki**: 4 entries — Trex64, Tony, Bluevessel, c64lib org. Modern Gradle-based KickAssembler workflow.

## Schema highlights

Each entry tags `techniques_demonstrated` against a normalized taxonomy split across:

- **graphics_modes**: hires-bitmap, multicolor-bitmap, ECM, FLI, AFLI, IFLI, NUFLI, NUFLIX, FLD, FPP, DYCP
- **sprite_techniques**: multiplexing variants (Ocean, radix-sort, SWIV), stretching, doublebuffering, priority, overlay-color
- **raster_effects**: stable IRQ, double IRQ, raster bars, line crunch, open borders, VSP
- **scrolling**: hardware H/V, char-mode, bitmap, multidirectional, parallax (charset / color-ram), double-buffer
- **audio**: custom playroutines, instrument tables, digi-samples, music-runstop, 8-bit PCM
- **memory_io**: bank switching, char ROM mapping, decompression (in-place/backwards), fastloader integration
- **engine_patterns**: actor system, level data tiling, world streaming, checkpoint save, dialogue, inventory, collision (AABB/tile)
- **optimization**: self-modifying code, speedcode unrolling, illegal opcodes, page-boundary tricks, cycle counting, table precomputation

`pattern_signals` maps technique → specific path within the repo where it lives (e.g., `"sprite-multiplexing-swiv": "src/sprite.s, src/raster.s"` for Hessian).

`companion_article` (when present) is the *why* counterpart to the code's *how* — Cadaver's rants pair with his game code; lft's articles pair with his demos; pditincho's mm-explained docs pair with the Maniac Mansion disassembly.

## Six-phase ingestion order

Defined in `_pedagogical_phase_ordering_for_autonomous_dev`:

1. **Minimal viable understanding** — Easy 6502 + Codebase64 snippets + OscarTutorials + wizofwor examples + cc65 samples. Bedrock vocabulary.
2. **Engine patterns** — celso, Bluevessel, leissa-c64engine, Fabrizio multiplexor, zendar tutorial, Cadaver rants. Mid-complexity composition of multiple techniques.
3. **Complete production engines** — c64gameframework, Hessian, Steel Ranger, MW4, all drmortalwombat games, Trex64, Tony, c64lib. Where Claude Code learns to integrate.
4. **Advanced demoscene** — all lft entries, Spindle template, NUFLIX article, Unfortunate Coincidence. State-of-the-art, often inventing techniques.
5. **Historical grounding** — mwenge corpus, Mark Moxon Elite family, pditincho mm-explained, Loderunner disassembly, popc64, original Prince of Persia. How the masters of the 80s actually shipped.
6. **Infrastructure** — Krill, Exomizer, Bitfire, ByteBoozer, Covert Bitops loader, VICE testprogs, mist64 ROMs. The substrate beneath everything.

## How to query this in the harness

```python
import json
cat = json.load(open("c64_source_corpus_catalog.json"))

def find_implementations(technique, min_pedagogical="intermediate"):
    """Return source entries demonstrating <technique>, ranked by quality."""
    order = {"beginner":0, "intermediate":1, "advanced":2, "expert":3}
    return sorted(
        [r for r in cat["resources"]
         if technique in r.get("techniques_demonstrated", [])
         and order.get(r["pedagogical_level"], 99) >= order[min_pedagogical]],
        key=lambda r: (
            -{"critical":3,"high":2,"medium":1,"low":0}[r["priority"]],
            -{"production-grade":3,"well-commented":2,"learning-oriented":1,"minimal-comments":0,"sparse":0,"varies":1}.get(r["code_quality"], 0)
        )
    )

# Example: agent needs to implement sprite multiplexing for a side-scroller
hits = find_implementations("sprite-multiplexing-ocean", min_pedagogical="intermediate")
# → first hit will be cadaver-hessian or cadaver-c64gameframework
# Ingest source from r["url"], also fetch r["companion_article"] if present
# Use pattern_signals to know which files in the repo to focus on
```

## Cross-references to catalog #1

- Every `toolchain` value resolves to a tool entity in catalog 1 (`KickAssembler` → `kickassembler`, `Oscar64` → `oscar64`, `xa65` → `xa65`, etc.).
- Every `techniques_demonstrated` tag should normalize against technique entities you derive from catalog 1's seed sources (codebase64, c64-wiki, Christian Bauer's VIC-II doc, mist64 c64ref).
- Author handles resolve to person entities, many of which appear on CSDb — cross-link `person.csdb_id` when available.

## Ranking heuristics (already encoded in `_quality_signals_for_ranking`)

Strongly positive: author also wrote the canonical tutorial article on the technique used; builds cleanly with modern toolchain; recent commits; explicit license.

Strongly negative: source only available as binary inside D64 (needs disassembly first); >5 years stale + no working build; author explicitly says "not learning-friendly" (Cadaver said this about steelranger-demo — caveat the ingestion); comments in untranslated non-English.

## Generative workflow example

User: *"Generate a side-scrolling shooter."*

1. Agent identifies required techniques from c64-kb: `hardware-horizontal-scroll`, `sprite-multiplexing-ocean`, `actor-system`, `sid-playroutine-custom`, `collision-aabb`, `fastloader-integration`.
2. For each, query this catalog → ranked source hits.
3. Top integrated reference: `drmortalwombat-corescape` (vertical) or `drmortalwombat-plekthora` (horizontal) → clone + study. Then `cadaver-c64gameframework` for the engine architecture pattern.
4. For the specific multiplexer: `fabrizio-multiplexor` (C-callable) if writing in Oscar64, or `cadaver-rants` → `multi.zip` if writing in pure asm.
5. For the fastloader: `krill-loader-source` + integration patterns from `cadaver-hessian`.
6. Author comments + companion articles become the prompt context grounding the agent's generated code.

The whole pipeline runs entirely on data declared in these two catalogs.
