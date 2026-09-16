# Failure Pattern Reference Conventions

Failure-pattern docs live in `docs/c64-failure-patterns.md` (single
file). Each entry is one CrashPattern node, keyed by `symptom`.

The marker `<!-- doc-type: failure-reference -->` MUST appear in the
first 10 lines for the extractor to process the file.

## CrashPattern entries

Every CrashPattern in the doc gets an H2 in this exact format:

```
## black_screen — Display goes solid color or stays $00
```

Breakdown:
- `## ` (H2)
- `black_screen` — snake_case symptom canonical name
- ` — ` — em-dash separator
- Free-form one-line description

Following each H2 block:

```
**Likely causes:** vic_bank_misconfigured, screen_pointer_outside_bank, di_d011_blanked
**Diagnosis steps:** Check $D018 video matrix pointer; verify $DD00 VIC bank bits; inspect $D011 bit 4 (blank).
**Caused by registers:** D011, D018, DD00
**Caused by kernal:** SCREEN
**Caused by techniques:** vic_bank_switch
```

`Likely causes` is a comma-separated list of free-form cause tags
(short snake_case strings). Stored as a JSON-encoded array on the
node. NOT graph edges — graph edges go through the `Caused by …`
lines.

`Caused by …` lines emit CAUSED_BY edges, same structure as Pitfall's
TRIGGERED_BY.

## Section structure inside a CrashPattern

1. **Visible/audible symptom** (1–2 sentences, vivid)
2. **Likely causes** (parallel to the metadata list, expanded)
3. **Diagnosis steps** (numbered, concrete — what to inspect in vice-mcp)
4. **Common fixes** (1–3 paragraphs)
