/**
 * Markdown chunker: splits documents into sections by headings.
 * Each chunk gets a heading path for context (e.g. "Exec > Semaphores > ObtainSemaphore").
 */

export interface DocChunk {
  section: string;
  text: string;
}

const MAX_CHUNK_SIZE = 1500;
const FENCE = "```";

interface Headings {
  h1: string;
  h2: string;
  /** The heading path chunks under this point are filed under. */
  path: string;
}

/** The heading state after `line`, or null when `line` is not an H1-H3. */
function nextHeadings(line: string, h: Headings): Headings | null {
  if (line.startsWith("# ")) {
    const h1 = line.replace(/^#\s+/, "").trim();
    return { h1, h2: "", path: h1 };
  }
  if (line.startsWith("## ")) {
    const h2 = line.replace(/^##\s+/, "").trim();
    return { h1: h.h1, h2, path: h.h1 ? `${h.h1} > ${h2}` : h2 };
  }
  if (line.startsWith("### ")) {
    const h3 = line.replace(/^###\s+/, "").trim();
    let path = h3;
    if (h.h2) path = `${h.h1} > ${h.h2} > ${h3}`;
    else if (h.h1) path = `${h.h1} > ${h3}`;
    return { ...h, path };
  }
  return null;
}

/** One section's text as chunks: split on paragraphs when too long, unless it holds a code fence. */
function sectionChunks(section: string, lines: string[]): DocChunk[] {
  const text = lines.join("\n").trim();
  if (text.length === 0) return [];
  // Code blocks stay intact even when they exceed MAX_CHUNK_SIZE.
  if (text.length <= MAX_CHUNK_SIZE || text.includes(FENCE)) return [{ section, text }];
  return splitOnParagraphs(text, MAX_CHUNK_SIZE).map((sub) => ({ section, text: sub }));
}

export function chunkMarkdown(content: string, source: string): DocChunk[] {
  // Keep all chunks as-is. An earlier <80-char merge silently dropped
  // section headings for tiny chunks (e.g. per-opcode H3s in 6510-cpu-
  // reference.md), which broke retrieval. Tiny chunks are fine: their
  // heading is the searchable identifier.
  const chunks: DocChunk[] = [];
  let headings: Headings = { h1: "", h2: "", path: source };
  let currentText: string[] = [];
  let inCodeFence = false;

  for (const line of content.split("\n")) {
    // Track code fence state; a heading inside a fenced block is code, not a split point.
    const isFence = line.startsWith(FENCE);
    if (isFence) inCodeFence = !inCodeFence;
    const next = isFence || inCodeFence ? null : nextHeadings(line, headings);
    if (next === null) {
      currentText.push(line);
      continue;
    }
    chunks.push(...sectionChunks(headings.path, currentText));
    currentText = [];
    headings = next;
  }
  chunks.push(...sectionChunks(headings.path, currentText));
  return chunks;
}

function splitOnParagraphs(text: string, maxSize: number): string[] {
  const paras = text.split(/\n\n+/);
  const result: string[] = [];
  let buf = "";
  for (const p of paras) {
    if (buf.length + p.length + 2 > maxSize && buf.length > 0) {
      result.push(buf.trim());
      buf = p;
    } else {
      buf += (buf ? "\n\n" : "") + p;
    }
  }
  if (buf.trim()) result.push(buf.trim());
  return result.length > 0 ? result : [text];
}
