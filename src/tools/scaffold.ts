/** Structure-aware scaffold (2026-05-21): derive a composer's STRUCTURAL skeleton
 * — form, voice config, bass style, tempo — from their ontology, so compositions
 * differ in skeleton, not just skin. Previously these were hand-templated (same
 * intro→A→B→A' + same bass for every composer). Pure: (palette, avgTempo) → plan. */
import type { ComposerPalette } from "./auto-compose.js";

export interface ScaffoldPlan {
  tempo: number;
  form: string[];                       // ordered section labels incl. leading "intro"
  barsPerSection: number;
  bass: "driving" | "sparse";           // octave-driving 8ths vs sparse roots
  third: "arp" | "drums" | null;        // the 3rd voice, from the role mix
  multiplex: boolean;
}

function distinctLetters(form: string): string[] {
  const seen: string[] = [];
  for (const ch of form) if (/[A-Z]/.test(ch) && !seen.includes(ch)) seen.push(ch);
  return seen.length ? seen : ["A"];
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function deriveScaffold(palette: ComposerPalette, avgTempo: number): ScaffoldPlan {
  const role = (r: string) => palette.voice_roles.find((v) => v.role === r)?.count ?? 0;
  const lead = role("lead") || 1, bass = role("bass"), perc = role("percussion"), arp = role("arp");

  // 3rd voice from the role mix: drums if percussion dominates, else arp if present.
  const third: "arp" | "drums" | null = perc > 0 && perc >= arp ? "drums" : arp > 0 ? "arp" : null;
  const bassStyle: "driving" | "sparse" = bass / lead >= 0.5 ? "driving" : "sparse";
  const tempo = clamp(Math.round(avgTempo) || 128, 96, 150);

  // form: distinct-section count + how through-composed the composer is (avg form length)
  const structured = palette.song_forms.filter((s) => distinctLetters(s.label).length >= 2);
  const top = structured.length
    ? structured.reduce((a, b) => (a.count >= b.count ? a : b))
    : { label: "AB", count: 1 };
  // section count from the distinct-section complexity of the dominant structured
  // form (mined repeat_shapes are loop-dominant, so string length is too noisy a
  // signal; distinct-letter count is the reliable one).
  const D = clamp(distinctLetters(top.label).length, 2, 4);
  const nSections = clamp(4 + D, 6, 8);

  const letters = ["A", "B", "C", "D"].slice(0, D);
  const body: string[] = [letters[0], letters[0]];
  for (const l of letters.slice(1)) body.push(l, letters[0]);
  const form: string[] = ["intro"];
  for (let i = 0; i < nSections - 1; i++) form.push(body[i % body.length]);

  return {
    tempo, form, barsPerSection: 4, bass: bassStyle, third,
    multiplex: palette.multiplex.multiplex_rate > 0.15,
  };
}
