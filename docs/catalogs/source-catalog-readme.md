# c64-kb resource catalog

> **Status: manifest only.** This is a list of where things are. None of the
> sources below has been ingested into the knowledge base; the corpus under
> `docs/` is original prose written for this project. The ingest pipeline
> reads `docs/` and nothing else.

`c64_resource_catalog.json` — 137-entry manifest for ingesting the Commodore 64 corpus into your knowledge base. Built to be consumed directly by Claude Code (or any agent) iterating over `resources[]` and dispatching per `fetch_strategy`.

## Schema at a glance

Every entry has:

```
id              slug (machine-friendly, stable across versions)
name            human display name
url             primary URL
alt_url         optional mirror/secondary
category        top-level taxonomy (14 categories)
subcategory     finer grain
type            wiki | tool | book | github-repo | ftp_archive | pdf | ...
fetch_strategy  one of 9 ingestion patterns
priority        critical | high | medium | low
description     1-2 line summary
ingest_notes    (optional) gotchas, parsing hints, dedupe warnings
canonical       (optional) flag the authoritative source when mirrors exist
```

Top-level `_meta` carries the schema hints, entity types, and relationship types the kb should normalize to. `_ingestion_strategy` defines 5 phases — seed → corpus → toolchain → archaeology → long tail. `_de_duplication_aliases` flags known overlaps (zimmers vs bombjack, HVSC vs STIL, cc65 sub-tools).

## Distribution

```
By priority:          critical 20  | high 38  | medium 57  | low 22
By fetch strategy:    static_html 42 | git_clone 41 | manual_curate 25
                      pdf_corpus 8 | wiki_scrape 7 | ftp_mirror 7
                      csdb_api 4 | blog_archive 2 | db_dump 1
Top 4 categories:     cross-toolchain 24 | archive-database 19
                      demo-development 17 | reference-book 16
```

Critical-priority anchors (the schema-defining sources): codebase64, c64-wiki, vic-ii-bauer (Christian Bauer's VIC-II doc), c64-rom-ultimate-reference, c64-prg-ref-guide, mapping-c64, petlibrary-disk-formats, zimmers schematics, kickassembler, cc65, exomizer, krill-loader, vice-emulator, csdb, gb64, hvsc, bombjack-cbm-archive.

## Suggested Claude Code loop

```python
import json, pathlib
cat = json.load(open("c64_resource_catalog.json"))

for r in cat["resources"]:
    if r["priority"] not in ("critical", "high"):
        continue
    dispatch = {
        "git_clone":    clone_and_index,
        "wiki_scrape":  scrape_wiki,
        "ftp_mirror":   mirror_ftp,
        "static_html":  fetch_and_extract,
        "pdf_corpus":   ingest_pdfs,
        "csdb_api":     scrape_csdb_releases,
        "db_dump":      ingest_sqlite,
        "blog_archive": walk_archive_pages,
        "manual_curate": queue_for_review,
    }[r["fetch_strategy"]]
    dispatch(r)
```

Run the 5 phases in order — phase 1 establishes the schema, later phases hang releases/tunes/games off the chip/register/opcode entities that already exist.

## Phase ordering rationale

1. **Seed** — chips, registers, opcodes, memory map, file formats. The canonical entities.
2. **Corpus** — CSDb, GB64, HVSC bulk databases. Releases, games, tunes hang off phase-1 entities.
3. **Toolchain** — assemblers, compilers, crunchers, loaders. Tool entities + their docs + their source signatures (so archaeology can fingerprint crunched/loaded payloads).
4. **Archaeology** — mist64 disassemblies, Elite source, Ghidra. Ties into Rosetta64.
5. **Long tail** — magazines, blogs, forum threads. Summarize rather than verbatim ingest.

## Cross-references to your existing work

- **Rosetta64**: `elite-disassembly`, `elite-c64-ca65`, `mist64-cbm-history`, `ghidra-mos65xx`, `da65`, `regenerator` are the natural extensions of the PageRank/betweenness-on-disassembly approach. Christian Bauer's VIC-II doc and `c64-rom-ultimate-reference` give you the ground-truth labels for nodes the archaeology agent identifies.
- **Code archaeology methodology**: `oxyron-tricks` and `vic-ii-undocumented` are the catalog of "what does this clever code actually do?" — pair them with the disassembly tools as evidence sources.
- **Cruncher/loader fingerprinting**: source for `exomizer`, `pucrunch`, `bytebooze`, `krill-loader`, `spindle-loader`, `bitfire-loader`, `sparkle-loader` lets you build signature-based detectors for what tool produced any given crunched binary in the wild.

## Known caveats

- CSDb has no formal public API but stable HTML — 1 req/sec is polite.
- HVSC distributes as ~250MB zip; mirror once, delta on update releases.
- bombjack.org full mirror is multi-TB; the catalog flags this — be selective.
- Several blog-era sites (ffd2.com Fridge, Ray Carlsen, telarity) are aging ISP-hosted pages. Archive proactively via WARC.
- Lemon64 forum URLs sometimes embed `&sid=` session tokens. Strip during normalization to avoid dupes.

## Gaps you may want to fill manually

- **Per-game disassemblies beyond Elite** (Boulder Dash, Impossible Mission, Wizball — community efforts exist on CSDb and GitHub but are scattered; no single index).
- **Party-specific archives** (X, Datastorm, GubbData) — partial coverage via CSDb but full party packages live on party websites with varying retention.
- **YouTube long-form content** (8-Bit Show and Tell, Robin Harbron / 8-Bit Guy episodes on C64 internals) — high signal but requires transcript extraction.
