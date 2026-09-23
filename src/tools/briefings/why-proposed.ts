/**
 * The one-line "why proposed" reason a briefing gives for each technique.
 * Rules are tried in order; the first that matches wins.
 */

const CATEGORY_REASONS = new Map<string, string>([
  ["music", "SID music / audio requested in brief"],
  ["input", "Player input (joystick / keyboard) the brief's controls need"],
  ["maths", "Arithmetic or lookup-table support the brief's mechanics need"],
  ["logic", "Frame loop / game-state structure the brief needs"],
  ["text", "Text, font or number display mentioned or implied in brief"],
  ["io", "Disk load / save or persistence mentioned in brief"],
]);

type NameRule = {
  /** The technique name (lower case) contains one of these. */
  name: string[];
  /** The brief (lower case) contains one of these; omitted means no brief condition. */
  desc?: string[];
  reason: string;
};

const NAME_RULES: NameRule[] = [
  {
    name: ["scroll", "soft_scroll"],
    desc: ["scroll", "scroller"],
    reason: "Scroller effect mentioned in brief",
  },
  {
    name: ["sprite", "multiplex"],
    desc: ["sprite", "24", "multiplexer", "enemy"],
    reason: "Sprite/multiplexer technique required for brief",
  },
  {
    name: ["raster", "bar", "double_irq", "stable_raster"],
    desc: ["raster", "bar", "color"],
    reason: "Raster color effect mentioned in brief",
  },
  { name: ["bitmap"], desc: ["bitmap"], reason: "Bitmap mode mentioned in brief" },
  {
    name: ["stable_raster"],
    reason: "Prerequisite: all raster timing work needs stable IRQ foundation",
  },
  {
    name: ["effect", "plasma", "tunnel", "starfield"],
    reason: "Visual effect mentioned or implied in brief",
  },
  {
    name: ["loader", "exomizer", "krill"],
    reason: "Loading / compression needed for multi-part work",
  },
];

const EXACT_NAME_REASONS = new Map<string, string>([
  [
    "text_mode_overlay_render",
    "Text-mode playfield + moving overlay is the foundation for any falling-piece / board / Tetris-like game",
  ],
]);

function ruleMatches(rule: NameRule, name: string, desc: string): boolean {
  if (!rule.name.some((w) => name.includes(w))) return false;
  return rule.desc === undefined || rule.desc.some((w) => desc.includes(w));
}

/**
 * Determine a human-readable "why proposed" string for a technique
 * given the original description.
 */
export function whyProposed(techniqueName: string, category: string, description: string): string {
  const byCategory = CATEGORY_REASONS.get(category);
  if (byCategory !== undefined) return byCategory;
  const desc = description.toLowerCase();
  const name = techniqueName.toLowerCase();
  const rule = NAME_RULES.find((r) => ruleMatches(r, name, desc));
  if (rule) return rule.reason;
  return EXACT_NAME_REASONS.get(name) ?? `Relevant to the brief: "${description.slice(0, 60)}"`;
}
