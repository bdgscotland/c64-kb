/**
 * toolchain-reference and format-reference pages. Both carry FileFormat H3s
 * (`### .PRG — …`) with **Produced by:** / **Consumed by:** lines under them;
 * a toolchain page also names its Tool in frontmatter and its target chips
 * on **Targets:** lines.
 */

import { group, parseFrontmatter, splitList, type Frontmatter } from "./common.ts";
import type { GraphEntity } from "./types.ts";

const FORMAT_H3 = /^###\s+(\.[A-Z0-9]+)\s+(?:—|--)\s+(.+)$/;
const PRODUCED_BY = /^\*\*Produced by:\*\*\s+(.+)$/;
const CONSUMED_BY = /^\*\*Consumed by:\*\*\s+(.+)$/;
const TARGETS = /^\*\*Targets:\*\*\s+(.+)$/;

/**
 * Walk lines for FileFormat H3s and the Produced/Consumed lines under them.
 * With `tool` set, **Targets:** lines become TARGETS edges from that tool.
 */
function formatEntities(body: string, tool: string | undefined): GraphEntity[] {
  const entities: GraphEntity[] = [];
  let format: string | null = null;
  for (const line of body.split("\n")) {
    const f = FORMAT_H3.exec(line);
    if (f) {
      format = group(f, 1).replace(/^\./, "");
      entities.push({ type: "file_format", name: format, description: group(f, 2) });
    } else {
      entities.push(...lineEntities(line, format, tool));
    }
  }
  return entities;
}

/** Edges from one line under a FileFormat H3 (`format`), or from a **Targets:** line anywhere. */
function lineEntities(line: string, format: string | null, tool: string | undefined): GraphEntity[] {
  const p = PRODUCED_BY.exec(line);
  if (p && format)
    return splitList(group(p, 1)).map((t): GraphEntity => ({ type: "produces", tool: t, format }));
  const c = CONSUMED_BY.exec(line);
  if (c && format)
    return splitList(group(c, 1)).map((t): GraphEntity => ({ type: "consumes", tool: t, format }));
  const tg = TARGETS.exec(line);
  if (tg && tool)
    return splitList(group(tg, 1)).map((chip): GraphEntity => ({ type: "targets", tool, chip }));
  return [];
}

function toolEntity(fm: Frontmatter): GraphEntity | null {
  if (!fm.tool || !fm.tool_kind || !fm.home_url) return null;
  return {
    type: "tool",
    name: fm.tool,
    kind: fm.tool_kind,
    ...(fm.maintainer !== undefined ? { maintainer: fm.maintainer } : {}),
    ...(fm.license !== undefined ? { license: fm.license } : {}),
    home_url: fm.home_url,
    // The version the repo's gates ran with (CONVENTIONS-toolchain-reference.md).
    ...(fm.version_verified ? { version_verified: fm.version_verified.replace(/^["']|["']$/g, "") } : {}),
  };
}

export function parseToolchainDoc(content: string): GraphEntity[] {
  const { fm, rest } = parseFrontmatter(content);
  const tool = toolEntity(fm);
  return [...(tool ? [tool] : []), ...formatEntities(rest, fm.tool)];
}

/** A format-reference page: FileFormat H3s and Produced/Consumed only, no Tool. */
export function parseFormatDoc(content: string): GraphEntity[] {
  return formatEntities(content, undefined);
}
