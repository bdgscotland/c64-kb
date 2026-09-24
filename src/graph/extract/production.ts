/**
 * Production nodes (#22 step 8, ON-06): the titles an archetype's
 * `**Reference titles:**` line links. Since #40 each title links the page
 * that gives its C64 genre and year (C64-Wiki, or Wikipedia), and a title
 * no source confirmed was removed, so only a linked title is read. The line
 * is a list, `[Title](url) (year[, note])` items joined by commas, then
 * prose; the list ends at the first item that does not match, so a title
 * named in the prose after it ("An earlier version listed [Green Beret]
 * ...") is not a production.
 */

// A URL may hold one level of parentheses: .../Boulder_Dash_(video_game).
const ITEM =
  /^\s*\[([^\]]+)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)(?:\s*\(((?:[^()]|\([^()]*\))*)\))?\s*(,|\.|$)/;

export interface ReferenceTitle {
  title: string;
  url: string;
  /** The C64 year the line gives, when its parenthesis starts with one. */
  year?: number;
  /** The rest of the parenthesis: "isometric", "Pipe Mania in Europe". */
  note?: string;
}

/** The linked titles at the head of a Reference titles line, in order. */
export function referenceTitles(line: string): ReferenceTitle[] {
  const out: ReferenceTitle[] = [];
  let rest = line;
  for (;;) {
    const m = ITEM.exec(rest);
    if (!m?.[1] || !m[2]) break;
    const paren = (m[3] ?? "").trim();
    const year = /^(\d{4})\b[,;]?\s*(.*)$/.exec(paren);
    const note = (year ? (year[2] ?? "") : paren).trim();
    out.push({
      title: m[1].trim(),
      url: m[2],
      ...(year?.[1] ? { year: Number(year[1]) } : {}),
      ...(note ? { note } : {}),
    });
    rest = rest.slice(m[0].length);
    if (m[4] !== ",") break;
  }
  return out;
}
