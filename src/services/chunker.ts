/**
 * Markdown chunker: splits documents into sections by headings.
 * Each chunk gets a heading path for context (e.g. "Exec > Semaphores > ObtainSemaphore").
 */

export interface DocChunk {
  section: string;
  text: string;
}

const MAX_CHUNK_SIZE = 1500;

export function chunkMarkdown(content: string, source: string): DocChunk[] {
  const lines = content.split("\n");
  const chunks: DocChunk[] = [];

  let h1 = "";
  let h2 = "";
  let currentHeading = source;
  let currentText: string[] = [];
  let inCodeFence = false;

  function flush() {
    const text = currentText.join("\n").trim();
    if (text.length > 0) {
      if (text.length > MAX_CHUNK_SIZE && !containsCodeFence(text)) {
        // Only split on paragraphs if the chunk doesn't contain a code fence.
        // Code blocks should stay intact even if they exceed MAX_CHUNK_SIZE.
        for (const sub of splitOnParagraphs(text, MAX_CHUNK_SIZE)) {
          chunks.push({ section: currentHeading, text: sub });
        }
      } else {
        chunks.push({ section: currentHeading, text });
      }
    }
    currentText = [];
  }

  for (const line of lines) {
    // Track code fence state — never split inside a fenced code block
    if (line.startsWith("```")) {
      inCodeFence = !inCodeFence;
      currentText.push(line);
      continue;
    }

    if (inCodeFence) {
      // Inside a code fence — accumulate without checking for headings
      currentText.push(line);
      continue;
    }

    if (line.startsWith("# ") && !line.startsWith("## ")) {
      flush();
      h1 = line.replace(/^#\s+/, "").trim();
      h2 = "";
      currentHeading = h1;
    } else if (line.startsWith("## ")) {
      flush();
      h2 = line.replace(/^##\s+/, "").trim();
      currentHeading = h1 ? `${h1} > ${h2}` : h2;
    } else if (line.startsWith("### ")) {
      flush();
      const h3 = line.replace(/^###\s+/, "").trim();
      currentHeading = h2 ? `${h1} > ${h2} > ${h3}` : (h1 ? `${h1} > ${h3}` : h3);
    } else {
      currentText.push(line);
    }
  }
  flush();

  // Keep all chunks as-is. The earlier <80-char merge silently dropped
  // section headings for tiny chunks (e.g. per-opcode H3s in 6510-cpu-
  // reference.md), which broke retrieval. Tiny chunks are fine — their
  // heading is the searchable identifier.
  const merged: DocChunk[] = chunks;
  return merged;
}

function containsCodeFence(text: string): boolean {
  return text.includes("```");
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
