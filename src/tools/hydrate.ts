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
import { locateDoc } from "../ingest/doc-path.ts";
import fs from "fs";
import path from "path";

export async function ingestDoc(docPath: string, content: string): Promise<string> {
  if (!(await ollamaAvailable())) {
    return "Ollama not available — cannot embed. Run: ollama pull mxbai-embed-large";
  }

  const q = await getQdrant();
  await q.ensureCollection();

  // Resolve docPath before any filesystem call; a path outside docs/ is refused.
  const DOCS_DIR = path.resolve(config.docs.dir);
  const doc = locateDoc(docPath, DOCS_DIR);
  if (doc === null) {
    return `Rejected: docPath must be inside the docs directory (${DOCS_DIR}).`;
  }

  // Write the content being indexed, unless the file already holds it. This
  // used to write only when the file was absent, so an update indexed text
  // the file on disk did not hold and the next clean ingest silently
  // reverted it.
  if (!fs.existsSync(doc.file) || fs.readFileSync(doc.file, "utf-8") !== content) {
    fs.mkdirSync(path.dirname(doc.file), { recursive: true });
    fs.writeFileSync(doc.file, content);
  }

  // Chunk + embed + upsert. Live single-doc ingest cannot refit the BM25
  // vocabulary, because that would invalidate every sparse vector already
  // in the collection; without a vocab file the sparse vectors are empty.
  const source = doc.source;
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
