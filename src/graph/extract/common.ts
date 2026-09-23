/** Helpers every doc-type parser shares: frontmatter, section splits, field lines, lists. */

export type Frontmatter = Partial<Record<string, string>>;

export interface Section {
  heading: string;
  body: string;
}

/** Capture group `i` of a match, or "" when the group did not take part. */
export function group(m: RegExpExecArray | RegExpMatchArray, i: number): string {
  return m.at(i) ?? "";
}

/** Parse `---` YAML-ish frontmatter at the top of the doc. */
export function parseFrontmatter(content: string): { fm: Frontmatter; rest: string } {
  if (!content.startsWith("---\n")) return { fm: {}, rest: content };
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) return { fm: {}, rest: content };
  const block = content.slice(4, end);
  const fm: Frontmatter = {};
  for (const line of block.split("\n")) {
    const m = /^([a-z_]+):\s*(.+?)\s*$/i.exec(line);
    if (m) fm[group(m, 1)] = group(m, 2);
  }
  return { fm, rest: content.slice(end + 5) };
}

/**
 * Split a doc body into sections at headings that start with `prefix`
 * (`"## "` or `"### "`). Each section is the heading line plus the body up
 * to the next such heading or the end. Text before the first heading is dropped.
 */
function splitSections(body: string, prefix: string): Section[] {
  const sections: Section[] = [];
  let current: { heading: string; lines: string[] } | null = null;
  for (const line of body.split("\n")) {
    if (line.startsWith(prefix)) {
      if (current !== null) sections.push({ heading: current.heading, body: current.lines.join("\n") });
      current = { heading: line, lines: [] };
    } else if (current !== null) {
      current.lines.push(line);
    }
  }
  if (current !== null) sections.push({ heading: current.heading, body: current.lines.join("\n") });
  return sections;
}

export function splitH2Sections(body: string): Section[] {
  return splitSections(body, "## ");
}

export function splitH3Sections(body: string): Section[] {
  return splitSections(body, "### ");
}

/** Group 1 of the first match of `re` in `body`, or undefined. */
export function matchField(body: string, re: RegExp): string | undefined {
  const m = body.match(re);
  return m ? group(m, 1) : undefined;
}

/**
 * Split a comma-separated metadata value: trim each item, optionally strip
 * backticks after trimming, drop empty items.
 */
export function splitList(value: string, options: { stripBackticks?: boolean } = {}): string[] {
  return value
    .split(",")
    .map((s) => (options.stripBackticks ? s.trim().replace(/`/g, "") : s.trim()))
    .filter(Boolean);
}

/** Warn about a doc problem on stderr, in the extractor's usual form. */
export function warn(message: string): void {
  console.warn(`[extract] ${message}`);
}
