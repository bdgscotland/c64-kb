---
name: audit-doc
description: Fact-check one knowledge-base document claim by claim against the instruments on this machine (VICE, the assemblers, the ROM images, the Oscar64 headers, the other documents), with an evidence ladder and a fixed report shape. Use when asked to audit, validate, fact-check or "is this right" about any docs/**/*.md, and before trusting a document as the basis for a recipe.
---

# audit-doc — claim-by-claim, instrument first

Announce: "Using audit-doc on <doc>."

## Evidence ladder

Strongest first. Every verdict says which rung it stands on.

1. **Ran it**: VICE run measured from the PNG; assembler/compiler output;
   bytes read from `/opt/homebrew/opt/vice/share/vice/C64/*.bin`; a header
   file under the Oscar64 include dir; a KickAssembler manual behaviour
   reproduced.
2. **Two independent documents in this repo agree** and neither cites the
   other.
3. **Arithmetic from stated constants** (63 × 312 = 19,656; 985,248 / 63).
4. **Your own knowledge.** Rung 4 supports "unverifiable", never
   "verified" and never "wrong" on its own.

## Procedure

1. Read the whole document. List its factual claims: addresses, register
   semantics, cycle counts, byte values, API names and signatures, format
   offsets, timing constants, tool flags, dates, and every cross-reference
   (does the target exist, and does it say what this document says it says?).
2. For each claim, pick the highest rung you can reach and go there.
   Prefer doing to reasoning: build the fragment, run it, read the bytes,
   open the header, open the other doc. Scratch under `/tmp/c64kb-audit/<slug>/`.
3. Classify: **wrong** (evidence contradicts it), **inconsistent** (two
   places in the repo disagree), **misleading** (true but an agent acting
   on it would do the wrong thing), **unverifiable** (stated as fact, no
   instrument or second source on this machine can settle it), or
   verified (say how).
4. For each finding: exact location (heading and quoted sentence), the
   claim, the verdict, the rung, the evidence (commands and numbers), and
   a concrete replacement.

## Report shape

```
doc: <path>
claims checked: <n>   instruments: <vice-run, rom-bytes, build, header-read, arithmetic, cross-doc>
findings:
  - id: <slug>  verdict: wrong|inconsistent|misleading|unverifiable  severity: high|medium|low
    location: <heading> — "<quoted sentence>"
    claim: ...
    evidence: <what you ran/read, with numbers>
    fix: <replacement text>
verified highlights: <up to 8 important claims confirmed at rung 1–2, with method>
```

`high` means an agent acting on the claim produces broken code or states a
falsehood. Do not report style. Do not pad a sound document with
low-value findings; "claims checked: 41, findings: 0" is a good result.

## Applying fixes

- Keep the document's voice. Where a number or mechanism changes, one
  clause says what was wrong.
- Do not touch frontmatter or metadata lines unless the finding is about
  them; if you do, `npm run ingest:clean` afterwards.
- If the file has listings, the hook builds them; if one you did not
  change fails, report it rather than silently fixing around it.
- Commit the corrections with the evidence in the message.

## Things already settled this year (cite, do not re-litigate without rung-1 evidence)

PAL 63/312, NTSC R8 65/263, R56A 64/262. Badline: bus 15–54, BA low on
12, CPU keeps 20 (23 counting write-only cycles). `$FFFE`→`$FF48` (29
cycles); `$0314`→`$EA31` (full service); `$EA81` bare exit. DEN sampled
once on line $30. Side border: one CSEL 1→0 write cycle on cycle 56. FLI:
$D011 write with the badline condition true on cycle 15, three grey
columns. No `JMP (abs,X)`; LAX has no zp,X.
