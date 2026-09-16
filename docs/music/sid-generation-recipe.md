# SID Generation Recipe — composing a tune that sounds like composer X

> Distilled from the 2026-05-21 build sessions (SP-phrase → SP-arp → SP-arrange →
> SP-harmonize). This is the **how-to for generating a SID tune from the ontology**
> that actually sounds musical, not just vocabulary-matched. The ear is the final
> gate; the metrics below are compasses, not grades.

## One call (the auto-composer)

`c64_compose_auto("<name>")` encodes this whole recipe into one deterministic call —
it pulls the palette, lays an arc from the composer's song-form, fills harmony from
their progressions, voices a lead (real mined phrases + PWM + vibrato + the voicing
findings below), an octave/sparse bass by role-mix, and a percussion voice, then
self-screens the two Score-derivable `mix_check` gates (drum density + stutter, no
audio needed). Returns `{ score, plan, screen, palette_used }`; feed `score` to
`c64_compose`, or `npm run compose:auto -- --composer "<name>" --seed N --render` for
audio + the full `mix_check`. `seed` gives deterministic variation; `ablation`
(`scramble_palette` / `no_timbre` / `generic_phrases`) isolates an identity layer for
evaluation. Use the manual loop below to refine or to learn what the auto-composer bakes in.

## The loop
1. **Pull the composer's vocabulary** — `c64_composer_palette("<name>")` (patches,
   phrases, arps, progressions, song-forms, voice-roles, gestures). Optionally seed
   structure from a real tune with `c64_arrange_tune("<title>")` (its sections +
   per-section harmony + per-voice phrases/arps as a refinable Score scaffold).
1b. **Pull his timbre** — `c64_timbre_lookup("<name>")` for PWM depth/width + filter
   usage. Set `Voice.pwm` on the lead/arp (the breathing pulse) and `Score.filter`
   (shared cutoff sweep) only as often as his `filter.active_fraction` suggests.
1c. **Pull his groove** — `c64_drum_lookup("<name>")` for percussion rhythms. Add a
   percussion voice (voice 3) with `drums` [{type,beat}] at those 16th-grid spacings
   (kick downbeats, snare backbeat, hihat between). Drums spend a voice.
1d. **Pull his multiplexing** — `c64_multiplex_lookup("<name>")`: which roles share a
   voice + the gap-fill rate. To keep 3 melodic voices AND drums, interleave drums into
   an arp/lead voice's rests at that rate (`Voice` with both melodic + `drums`); the
   renderer preempts the melodic note for each hit. Screen the result with `mix_check`
   (it flags stutter when the host voice has no gaps).
2. **Author a Score** from that vocabulary (see voicing rules below).
3. **`c64_compose`** → render + grade. Read `clash_bars`/`consonance_pct` (harmonic
   fit) and `style.in_style_pct` (vocabulary match).
4. **Listen.** Iterate. `in_style_pct` rising while it sounds worse is normal — it
   scores *vocabulary*, not *musicality*.

## Voicing rules (the difference between "shocking" and "sounds better")
- **One prominent lead.** Two dense leads at once = mud. (`arrangeTune` keeps only the
  first lead by default.)
- **Sparse, clean bass.** Root (half-notes is plenty) on a **mellow waveform
  (triangle)**. Do **not** use busy octave-jump patterns, and do **not** reuse a mined
  bass patch that is **filter-routed** — we render the patch *static* (no filter
  motion yet), so a filter-routed patch becomes a raw buzz that **dominates**. (A real
  SID has **no per-voice volume** — one master `$D418` — so you control prominence via
  density, register, and patch, not a mixer.)
- **Never voice a melody with the `noise` waveform** (mis-mined/percussive patch).
- **Turn on voice-leading.** Set `Voice.harmonize: true` on melodic voices (lead/arp).
  At render, each note snaps to the section's chord (scale always; chord tones on
  strong/long notes), preserving contour + rhythm — this removes the off-chord clashes
  that make it "sound bad." `arrangeTune` enables it on lead/dual automatically.
- **Hold the harmony.** Changing chords every bar with phrases that don't track them
  clashes; prefer his progressions held a couple of bars (his `i-bVI-bVII`-type moves).
- **Keep his timbre/identity** — patch family (incl. `hard_restart`), vibrato gesture,
  and *real* mined phrases/arps carry the "sounds like him" (see
  `palette-scaffolding-finding`); generic scaffolding alone does not.
- **Move the timbre.** A static pulse is a buzz. Put a `Voice.pwm` LFO on every pulse
  lead/arp (depth from `c64_timbre_lookup`). If a voice's mined patch is `filter_routed`,
  give the Score a `filter` block (LP, his resonance) — otherwise it renders as raw buzz.
- **Tame "harsh between the instruments"** (ear-validated 2026-05-21). A bright square lead
  + raw-noise drums grate together. A gentle shared **LP routed across the bright voices**
  (lead + percussion, `resonance` low ~3, `cutoff_center` ~1600, slow shallow LFO) rounds
  off the harsh highs — Hubbard's own tool, used sparingly (his `filter.active_fraction`).
- **Don't let the lead JAR** (ear-validated 2026-05-21). `hard_restart:"classic"` clicks the
  envelope before *every* note and `attack=0` snaps each note in — together the lead stabs
  jarringly. Soften: a small **attack (≈3)**, **drop the per-note hard-restart** (or use
  `"light"`), a **gentler PWM** (lower depth, `sine`), and an **off-square pulse width**
  (~2400, not 2048) for a less hollow tone. Keeps the melody; removes the stab.

## Worked example — timbre fields (SP-timbre, ear-validated 2026-05-21)

Add to a clean-voiced Score. PWM on the pulse lead/arp is the strong Hubbard signal;
the shared LP is gentle and routed sparingly (his filter is active ~20%).

```jsonc
// on a pulse lead/arp voice — the "breathing pulse":
"pwm": { "rate_frames": 24, "depth": 320, "center": 2048, "shape": "triangle", "onset_delay_frames": 6 },
// route a voice through the shared filter (or rely on the mined filter_routed flag):
"route_to_filter": true,
// one Score-level (per-chip) shared filter with a slow cutoff sweep:
"filter": { "mode": "lp", "resonance": 4, "cutoff_center": 1150, "lfo_rate_frames": 96, "lfo_depth": 550, "lfo_shape": "sine" }
```

Pull `depth`/`center`/`resonance`/`cutoff` ranges from `c64_timbre_lookup("<name>")`.
`inspect().timbre` confirms the motion rendered; `style.timbre_in_palette` confirms it's
in-style. A/B by ear vs the static-patch version — that's the gate.

## Reading the metrics
- `consonance_pct` / `clash_bars` (from `inspect`) are computed over the **rendered
  events** (notes + expanded phrases/arps, post-harmonize) vs the declared chords —
  this is the trustworthy "does it fit the harmony" signal.
- `style.in_style_pct` is **vocabulary** proximity to the composer's `FAVORS_*`
  palette — necessary, not sufficient. High style % can still sound bad.
- Neither captures arrangement quality (arc, drive, timbre motion). The **ear** is the
  gate until a learned audio-quality evaluator exists.

## Known gaps (deliberately not yet built)
- **Corpus-faithful timbre replay** — SP-timbre (2026-05-21) added *authored* PWM +
  shared-filter motion (`Voice.pwm`, `Score.filter`, `c64_timbre_lookup`); replaying a
  composer's *exact* per-frame `filter_curve`/`pulsewidth` trajectory (per-role/section)
  is the deferred next layer.
- **Drum voice time-sharing** — SP-drums (2026-05-21) added a dedicated percussion voice
  (`Voice.drums`, `c64_drum_lookup`); time-sharing one voice between drums *and* an arp
  (so a tune keeps 3 melodic voices + drums) is the deferred next layer.
- **The iconic ~50 Hz triad arp shimmer** — our mined arps top out ~8-10 Hz; faster
  ones are freq-register-only and a probe showed low payoff for mining them.
- **Learned "good" evaluator** — quality judgement is still the human ear.
