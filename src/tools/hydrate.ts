/**
 * Hydration tools. ingestDoc handles the single-file ingest path used by
 * the c64-kb ingest-doc CLI and c64_ingest_doc MCP tool. Mirrors the
 * batch ingest in src/ingest.ts: Qdrant chunk upsert + FalkorDB graph
 * entity extraction so adding a single doc via MCP keeps both stores
 * consistent.
 */

import { getQdrant, getFalkor } from "../context.ts";
import { chunkMarkdown } from "../services/chunker.ts";
import { isAvailable as ollamaAvailable } from "../services/embeddings.ts";
import { loadBM25Vocab } from "../services/bm25.ts";
import { extractGraphEntities } from "../graph/extract.ts";
import { applyEntity } from "../graph/apply.ts";
import { replaceDocPoints } from "../ingest/points.ts";
import { config } from "../config.ts";
import fs from "fs";
import path from "path";

/**
 * Resolve a caller-supplied doc path inside the docs directory, or null
 * when it would land outside. Null bytes are stripped and every ".."
 * segment dropped before path.resolve sees the value.
 */
function resolveDocPath(docPath: string, docsDir: string): string | null {
  const sanitized = docPath
    .replace(/\0/g, "") // null bytes
    .split(path.sep)
    .filter((seg) => seg !== "..") // remove every parent-dir jump
    .join(path.sep);
  const resolved = path.resolve(docsDir, sanitized);
  if (!resolved.startsWith(docsDir + path.sep) && resolved !== docsDir) return null;
  return resolved;
}

export async function ingestDoc(docPath: string, content: string): Promise<string> {
  if (!(await ollamaAvailable())) {
    return "Ollama not available — cannot embed. Run: ollama pull mxbai-embed-large";
  }

  const q = await getQdrant();
  await q.ensureCollection();

  // Sanitise docPath before any filesystem call to prevent path traversal.
  const DOCS_DIR = path.resolve(config.docs.dir);
  const resolvedDocPath = resolveDocPath(docPath, DOCS_DIR);
  if (resolvedDocPath === null) {
    return `Rejected: docPath must be inside the docs directory (${DOCS_DIR}).`;
  }

  // Write the content being indexed. This used to write only when the file
  // was absent, so an update indexed text the file on disk did not hold and
  // the next clean ingest silently reverted it.
  fs.mkdirSync(path.dirname(resolvedDocPath), { recursive: true });
  fs.writeFileSync(resolvedDocPath, content);

  // Chunk + embed + upsert. Live single-doc ingest cannot refit the BM25
  // vocabulary, because that would invalidate every sparse vector already
  // in the collection; without a vocab file the sparse vectors are empty.
  const source = resolvedDocPath.replace(DOCS_DIR + path.sep, ""); // relative path under docs/
  const pointCount = await replaceDocPoints(q, {
    source,
    chunks: chunkMarkdown(content, source),
    bm25: loadBM25Vocab(),
  });

  // Graph extraction — parity with batch ingest, through the same applier.
  // Single-file ingest stays single-pass intentionally: with only one doc in
  // flight, node ordering doesn't matter and FalkorDB's MERGE-stub fallback
  // handles any forward references within the doc. The two-pass linker in
  // src/ingest.ts is only needed for the full-corpus batch run where edges
  // from one file may reference nodes defined in a later file.
  const f = await getFalkor();
  await f.ensureSchema();
  let graphCount = 0;
  for (const entity of extractGraphEntities(content, source)) {
    if (await applyEntity(f, entity)) graphCount++;
  }

  return `Ingested ${pointCount} chunks + ${graphCount} graph entities from ${source}.`;
}
