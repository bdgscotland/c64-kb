/**
 * Hydration tools. ingestDoc handles the single-file ingest path used by
 * the c64-kb ingest-doc CLI and c64_ingest_doc MCP tool. Mirrors the
 * batch ingest in src/ingest.ts: Qdrant chunk upsert + FalkorDB graph
 * entity extraction so adding a single doc via MCP keeps both stores
 * consistent.
 */

import { getQdrant, getFalkor } from "../context.ts";
import { chunkMarkdown } from "../services/chunker.ts";
import { embedBatch, isAvailable as ollamaAvailable } from "../services/embeddings.ts";
import { BM25Encoder } from "../services/bm25.ts";
import { extractGraphEntities } from "../graph/extract.ts";
import { config } from "../config.ts";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

const VOCAB_FILE = path.resolve(config.analytics.dbPath, "../bm25-vocab.json");

/**
 * Load the existing BM25 encoder. Live single-doc ingest CANNOT refit
 * vocabulary because that would invalidate every existing sparse vector
 * in the collection. If the vocab file is missing, returns null and the
 * caller falls back to empty sparse vectors (dense-only contribution).
 */
function loadBM25(): BM25Encoder | null {
  try {
    if (!fs.existsSync(VOCAB_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(VOCAB_FILE, "utf-8"));
    return BM25Encoder.fromJSON(data);
  } catch {
    return null;
  }
}

export async function ingestDoc(docPath: string, content: string): Promise<string> {
  if (!await ollamaAvailable()) {
    return "Ollama not available — cannot embed. Run: ollama pull mxbai-embed-large";
  }

  const q = await getQdrant();
  await q.ensureCollection();

  // Sanitise docPath before any filesystem call to prevent path traversal.
  // Strip null bytes and collapse every ".." segment so the value entering
  // path.resolve is already clean, then confirm it still lives inside DOCS_DIR.
  const DOCS_DIR = path.resolve(config.docs.dir);
  const sanitized = docPath
    .replace(/\0/g, "")                         // null bytes
    .split(path.sep)
    .filter((seg) => seg !== "..")              // remove every parent-dir jump
    .join(path.sep);
  const resolvedDocPath = path.resolve(DOCS_DIR, sanitized);
  if (!resolvedDocPath.startsWith(DOCS_DIR + path.sep) && resolvedDocPath !== DOCS_DIR) {
    return `Rejected: docPath must be inside the docs directory (${DOCS_DIR}).`;
  }

  // Write to disk if not already there
  if (!fs.existsSync(resolvedDocPath)) {
    fs.writeFileSync(resolvedDocPath, content);
  }

  // Chunk + embed + upsert
  const source = resolvedDocPath.replace(DOCS_DIR + path.sep, ""); // relative path under docs/
  const chunks = chunkMarkdown(content, source);
  const texts = chunks.map((c) => `${c.section}\n\n${c.text}`);
  const vectors = await embedBatch(texts);
  const bm25 = loadBM25();

  const points = chunks
    .map((c, i) => {
      const vec = vectors[i];
      if (!vec) return null;
      const id = createHash("sha256")
        .update(`${source}:${c.section}:${i}`)
        .digest("hex")
        .slice(0, 32);
      const text = `${c.section}\n\n${c.text}`;
      return {
        id,
        dense: vec,
        sparse: bm25 ? bm25.encode(text) : { indices: [], values: [] },
        payload: {
          source,
          section: c.section,
          text,
          embed_model: config.ollama.model,
          ingested_at: new Date().toISOString(),
        },
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (points.length > 0) {
    await q.upsertChunks(points);
  }

  // Graph extraction — parity with batch ingest.
  // Single-file ingest stays single-pass intentionally: with only one doc in
  // flight, node ordering doesn't matter and FalkorDB's MERGE-stub fallback
  // handles any forward references within the doc. The two-pass linker in
  // src/ingest.ts is only needed for the full-corpus batch run where edges
  // from one file may reference nodes defined in a later file.
  const f = await getFalkor();
  await f.ensureSchema();
  const entities = extractGraphEntities(content, source);
  let graphCount = 0;
  for (const entity of entities) {
    switch (entity.type) {
      case "register":
        await f.addRegister(entity.name, entity.address, entity.chip, entity.rw, entity.aliases);
        graphCount++;
        break;
      case "kernal_routine":
        await f.addKernalRoutine(entity.name, entity.address, entity.description);
        graphCount++;
        break;
      case "memory_region":
        await f.addMemoryRegion(
          entity.name,
          entity.start,
          entity.end,
          entity.default_use ?? "",
          entity.bank_switchable ?? false
        );
        graphCount++;
        break;
      case "belongs_to":
        await f.linkBelongsTo(entity.entityType, entity.entityName, entity.chip);
        break;
      case "pairs_with":
        await f.linkPairsWith(entity.a, entity.b);
        break;
      case "tool":
        await f.addTool(entity);
        graphCount++;
        break;
      case "file_format":
        await f.addFileFormat(entity.name, entity.description);
        graphCount++;
        break;
      case "produces":
        await f.linkProduces(entity.tool, entity.format);
        break;
      case "consumes":
        await f.linkConsumes(entity.tool, entity.format);
        break;
      case "targets":
        await f.linkTargets(entity.tool, entity.chip);
        break;
      case "recipe":
        await f.addRecipe(entity);
        await f.linkRecipeUsesTool(entity.name, entity.toolchain);
        for (const reg of entity.uses_registers) {
          await f.linkRecipeUsesRegister(entity.name, reg);
        }
        for (const k of entity.uses_kernal) {
          await f.linkRecipeUsesKernal(entity.name, k);
        }
        graphCount++;
        break;
      case "implements":
        await f.linkRecipeImplements(entity.recipe, entity.technique);
        break;
      case "produces_format":
        await f.linkRecipeProducesFormat(entity.recipe, entity.format);
        break;
      case "technique":
        await f.addTechnique(entity);
        graphCount++;
        break;
      case "technique_uses_register":
        await f.linkTechniqueUsesRegister(entity.technique, entity.register);
        break;
      case "technique_uses_kernal":
        await f.linkTechniqueUsesKernal(entity.technique, entity.kernal);
        break;
      case "technique_requires_region":
        await f.linkTechniqueRequiresRegion(entity.technique, entity.region);
        break;
      case "technique_belongs_to":
        await f.linkTechniqueBelongsTo(entity.technique, entity.chip);
        break;
      case "technique_demands":
        await f.linkTechniqueDemands(entity.technique, entity.resource, entity.description);
        break;
      case "technique_requires":
        await f.linkTechniqueRequires(entity.technique, entity.requires);
        break;
      case "pitfall":
        await f.addPitfall(entity);
        graphCount++;
        break;
      case "triggered_by":
        await f.linkTriggeredBy(entity.pitfall, entity.target, entity.targetKind);
        break;
      case "mitigated_by":
        await f.linkMitigatedBy(entity.pitfall, entity.target);
        break;
      case "crash_pattern":
        await f.addCrashPattern(entity);
        graphCount++;
        break;
      case "caused_by":
        await f.linkCausedBy(entity.symptom, entity.target, entity.targetKind);
        break;
      case "recipe_occupies":
        await f.linkRecipeOccupies(entity.recipe, entity.start, entity.end);
        break;
      case "archetype":
        await f.addArchetype(entity);
        graphCount++;
        break;
      case "archetype_features":
        await f.linkArchetypeFeatures(entity.archetype, entity.technique);
        break;
      case "archetype_risks":
        await f.linkArchetypeRisks(entity.archetype, entity.pitfall);
        break;
      case "scaffolds":
        await f.linkRecipeScaffolds(entity.recipe, entity.archetype);
        break;
      default: {
        // Every entity type the extractor emits has a case above; a new one
        // is a tsc error here, not a silent skip. technique_demands was
        // skipped by single-file ingest for a release, and recipe_occupies
        // until this guard was added and named it.
        const _exhaustive: never = entity;
        void _exhaustive;
      }
    }
  }

  return `Ingested ${points.length} chunks + ${graphCount} graph entities from ${source}.`;
}
