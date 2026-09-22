#!/usr/bin/env node

/**
 * Batch ingest pipeline. Walks docs/, chunks markdown, generates dense
 * + sparse vectors, upserts to Qdrant, and extracts graph entities into
 * FalkorDB. Single-file equivalent lives in src/tools/hydrate.ts
 * (c64-kb ingest-doc CLI + c64_ingest_doc MCP tool).
 *
 * Prerequisites:
 *   docker compose up -d
 *   ollama pull mxbai-embed-large
 *
 * Run: npm run ingest          # incremental (skips unchanged files)
 *      npm run ingest:clean    # wipe graph + cache and re-ingest
 *      npm run ingest -- --force  # wipe graph + collection, rehash and re-upsert every file
 */

import { QdrantService } from "./services/qdrant.js";
import { FalkorService } from "./services/falkor.js";
import { chunkMarkdown } from "./services/chunker.js";
import { embedBatch, isAvailable as ollamaAvailable } from "./services/embeddings.js";
import { extractGraphEntities } from "./graph/extract.js";
import { BM25Encoder } from "./services/bm25.js";
import { config } from "./config.js";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

const DOCS_DIR = config.docs.dir;
const HASH_FILE = path.resolve(config.analytics.dbPath, "../ingest-hashes.json");
const LOG_FILE = path.resolve(config.analytics.dbPath, "../ingest.log");
const VOCAB_FILE = path.resolve(config.analytics.dbPath, "../bm25-vocab.json");

/**
 * Classify a GraphEntity as a node (pass 1) vs an edge (pass 2).
 * Nodes must exist before any edges that reference them can be created.
 */
function isNodeEntity(e: { type: string }): boolean {
  switch (e.type) {
    case "register":
    case "kernal_routine":
    case "memory_region":
    case "tool":
    case "file_format":
    case "recipe":
    case "technique":
    case "pitfall":
    case "crash_pattern":
      return true;
    default:
      return false;
  }
}

/**
 * A local edge record type used to defer all graph edge creation until
 * pass 2 (after all node entities across all files have been created).
 * This removes the implicit WALK_PRIORITY ordering dependency for
 * edge correctness — forward references from any doc are handled
 * by FalkorDB's MERGE-stub fallback.
 */
type PendingEdge =
  | { kind: "belongs_to"; entityType: string; entityName: string; chip: string }
  | { kind: "pairs_with"; a: string; b: string }
  | { kind: "produces"; tool: string; format: string }
  | { kind: "consumes"; tool: string; format: string }
  | { kind: "targets"; tool: string; chip: string }
  | { kind: "implements"; recipe: string; technique: string }
  | { kind: "produces_format"; recipe: string; format: string }
  | { kind: "technique_uses_register"; technique: string; register: string }
  | { kind: "technique_uses_kernal"; technique: string; kernal: string }
  | { kind: "technique_requires_region"; technique: string; region: string }
  | { kind: "technique_belongs_to"; technique: string; chip: string }
  | { kind: "recipe_uses_tool"; recipe: string; tool: string }
  | { kind: "recipe_uses_register"; recipe: string; register: string }
  | { kind: "recipe_uses_kernal"; recipe: string; kernal: string }
  | { kind: "triggered_by"; pitfall: string; target: string; targetKind: "Register" | "KernalRoutine" | "Technique" }
  | { kind: "caused_by"; symptom: string; target: string; targetKind: "Register" | "KernalRoutine" | "Technique" }
  | { kind: "recipe_occupies"; recipe: string; start: number; end: number }
  | { kind: "technique_demands"; technique: string; resource: string; description: string }
  | { kind: "technique_requires"; technique: string; requires: string }
  | { kind: "mitigated_by"; pitfall: string; target: string };

function loadHashes(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(HASH_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveHashes(hashes: Record<string, string>): void {
  fs.mkdirSync(path.dirname(HASH_FILE), { recursive: true });
  fs.writeFileSync(HASH_FILE, JSON.stringify(hashes, null, 2));
}

function log(msg: string): void {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const line = `${new Date().toISOString()} ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

/**
 * Load existing BM25 vocab from disk if present; otherwise fit a fresh
 * encoder over the full corpus (so all sparse vectors share the same
 * vocabulary indices) and persist it.
 */
function loadOrFitBM25(corpus: string[], forceRefit: boolean): BM25Encoder {
  if (!forceRefit && fs.existsSync(VOCAB_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(VOCAB_FILE, "utf-8"));
      return BM25Encoder.fromJSON(data);
    } catch {
      // Fall through to refit
    }
  }
  const enc = new BM25Encoder();
  enc.fit(corpus);
  fs.mkdirSync(path.dirname(VOCAB_FILE), { recursive: true });
  fs.writeFileSync(VOCAB_FILE, JSON.stringify(enc.toJSON()));
  return enc;
}

/**
 * Recursively walk a directory and return all *.md paths relative to root.
 * Skips non-knowledge subtrees (specs and plans).
 *
 * Walk priority is now ONLY load-bearing for FileFormat description authority:
 * docs/formats/c64-file-formats.md must land first so addFileFormat's
 * ON-CREATE-only description set wins over later per-toolchain `.FORMAT`
 * blurbs. Everything else used to depend on this order for edge correctness,
 * but the two-pass linker (P0-3) defers all edges to pass 2, where every
 * node already exists — so node-creation order no longer affects edge
 * outcomes. The hardware/toolchains/runtime/techniques/recipes ordering
 * remains for log readability + the FileFormat race.
 */
const WALK_PRIORITY: readonly string[] = [
  "formats/",       // FileFormat catalog: descriptions land first (ON CREATE SET wins). LOAD-BEARING.
  "hardware/",      // Register / KernalRoutine / MemoryRegion nodes (cosmetic ordering only)
  "toolchains/",    // Tool nodes (cosmetic)
  "runtime/",       // More Tool nodes — vice, vice-mcp, sim6502 (cosmetic)
  "techniques/",    // Technique nodes (cosmetic — edges resolve in pass 2)
  "recipes/",       // Recipe nodes (cosmetic — edges resolve in pass 2)
];

function findMarkdown(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  // Use Node's native recursive readdir (Node 20+) to avoid building
  // intermediate paths with user-influenced segments. All returned names
  // are filesystem-derived relative-from-root strings.
  const entries = fs.readdirSync(root, { withFileTypes: true, recursive: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    // entry.parentPath is the directory the file was discovered in.
    // Strip the root prefix to get the relative path used downstream.
    const parent = entry.parentPath ?? root;
    const rel = parent === root ? entry.name : `${parent.slice(root.length).replace(/^[\/\\]+/, "")}/${entry.name}`;
    // Skip non-knowledge subtrees (specs + plans).
    if (rel.startsWith("superpowers/") || rel.startsWith("superpowers\\")) continue;
    // Normalize backslashes to forward slashes for cross-platform stability.
    results.push(rel.replace(/\\/g, "/"));
  }
  results.sort((a, b) => {
    const ai = WALK_PRIORITY.findIndex((p) => a.startsWith(p));
    const bi = WALK_PRIORITY.findIndex((p) => b.startsWith(p));
    const aRank = ai === -1 ? WALK_PRIORITY.length : ai;
    const bRank = bi === -1 ? WALK_PRIORITY.length : bi;
    if (aRank !== bRank) return aRank - bRank;
    return a.localeCompare(b);
  });
  return results;
}

async function main() {
  const forceAll = process.argv.includes("--force");
  // --force re-ingests every file, and MERGE never removes an edge a doc no
  // longer asserts, so a forced run is also a clean one; otherwise a changed
  // frontmatter list leaves its old edges behind (seen with recipe techniques).
  const cleanFirst = process.argv.includes("--clean") || forceAll;

  const flags = `${forceAll ? " --force" : ""}${cleanFirst ? " --clean" : ""}`;
  console.log(`c64-kb ingest${flags}`);
  console.log(`  docs: ${DOCS_DIR}`);
  log(`START${flags}`);

  const hasOllama = await ollamaAvailable();
  if (!hasOllama) {
    console.warn("  WARNING: Ollama not available. Run: ollama pull mxbai-embed-large");
    console.warn("  Aborting — Phase 1 ingest requires embeddings.");
    process.exit(1);
  }
  console.log(`  embeddings: ${config.ollama.model} via Ollama`);

  const qdrant = new QdrantService();
  await qdrant.ensureCollection();
  console.log("  qdrant: connected");

  const falkor = new FalkorService();
  await falkor.connect();
  await falkor.ensureSchema();
  console.log("  falkordb: connected (schema ensured)");

  if (cleanFirst) {
    await falkor.clean();
    console.log("  falkordb: cleaned per-label nodes (schema + Chip/Region seeds preserved)");
    await qdrant.dropCollection();
    await qdrant.ensureCollection();
    console.log("  qdrant: collection dropped and recreated");
    fs.rmSync(HASH_FILE, { force: true });
    console.log("  ingest-hashes.json removed");
  }

  const files = findMarkdown(DOCS_DIR);
  console.log(`\nFound ${files.length} markdown files`);

  // Build the full corpus first so BM25 vocab is consistent across the
  // run. We fit once over every chunk's section+text from every file,
  // regardless of which files actually get re-ingested this run.
  const fileContents = new Map<string, string>();
  const fullCorpus: string[] = [];
  for (const file of files) {
    const fullPath = path.join(DOCS_DIR, file);
    const content = fs.readFileSync(fullPath, "utf-8");
    fileContents.set(file, content);
    for (const c of chunkMarkdown(content, file)) {
      fullCorpus.push(`${c.section}\n\n${c.text}`);
    }
  }
  const bm25 = loadOrFitBM25(fullCorpus, forceAll);
  console.log(`  bm25: ${forceAll || !fs.existsSync(VOCAB_FILE) ? "fitted" : "loaded"} vocab → ${VOCAB_FILE}`);

  const prevHashes = loadHashes();
  let totalChunks = 0;
  let skipped = 0;
  let totalPitfalls = 0;
  let totalCrashPatterns = 0;
  // Distinct (source, target, kind) requests, so that a doc naming the same
  // trigger twice is not reported as a dropped edge after MERGE folds them.
  const triggeredByRequested = new Set<string>();
  const causedByRequested = new Set<string>();
  const requiresRequested = new Set<string>();
  const mitigatedByRequested = new Set<string>();
  // References whose target name matched no node. Requests can exceed edges
  // legitimately (two spellings of one register), so this is the real signal.
  let triggeredByDropped = 0;
  let causedByDropped = 0;
  // For REQUIRES a drop is a missing technique OR a refused cycle; the
  // [falkor] line above it says which.
  let requiresDropped = 0;
  let mitigatedByDropped = 0;

  // All edge operations are deferred to pass 2 so that every node exists
  // before any edge tries to reference it. This removes the implicit
  // WALK_PRIORITY ordering dependency for edge correctness.
  const pendingEdges: PendingEdge[] = [];

  // --- Pass 1: vectors + node entities ---
  for (const file of files) {
    const content = fileContents.get(file)!;
    const contentHash = createHash("sha256").update(content).digest("hex");

    if (!forceAll && prevHashes[file] === contentHash) {
      skipped++;
      continue;
    }

    prevHashes[file] = contentHash;
    saveHashes(prevHashes);

    const chunks = chunkMarkdown(content, file);
    if (chunks.length === 0) continue;

    const texts = chunks.map((c) => `${c.section}\n\n${c.text}`);
    const vectors = await embedBatch(texts);

    const points = chunks
      .map((c, i) => {
        const vec = vectors[i];
        if (!vec) return null;
        const id = createHash("sha256")
          .update(`${file}:${c.section}:${i}`)
          .digest("hex")
          .slice(0, 32);
        const text = `${c.section}\n\n${c.text}`;
        return {
          id,
          dense: vec,
          sparse: bm25.encode(text),
          payload: {
            source: file,
            section: c.section,
            text,
            embed_model: config.ollama.model,
            ingested_at: new Date().toISOString(),
          },
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    // Point ids are derived from (file, section, index), so a section that
    // was renamed or removed would otherwise stay in the collection for ever
    // and keep being retrieved. Drop the file's old chunks before upserting.
    await qdrant.deleteBySource(file);
    if (points.length > 0) {
      await qdrant.upsertChunks(points);
      totalChunks += points.length;
    }

    // --- Graph entity extraction: nodes in pass 1, edges deferred to pass 2 ---
    const entities = extractGraphEntities(content, file);
    let entityCount = 0;
    for (const e of entities) {
      try {
        if (isNodeEntity(e)) {
          // Pass 1: create node entities only
          switch (e.type) {
            case "register":
              await falkor.addRegister(e.name, e.address, e.chip, e.rw, e.aliases);
              entityCount++;
              break;
            case "kernal_routine":
              await falkor.addKernalRoutine(e.name, e.address, e.description);
              entityCount++;
              break;
            case "memory_region":
              await falkor.addMemoryRegion(e.name, e.start, e.end, e.default_use ?? "", e.bank_switchable ?? false);
              entityCount++;
              break;
            case "tool":
              await falkor.addTool(e);
              entityCount++;
              break;
            case "file_format":
              await falkor.addFileFormat(e.name, e.description);
              entityCount++;
              break;
            case "recipe":
              await falkor.addRecipe(e);
              entityCount++;
              // Defer all Recipe edge links to pass 2
              pendingEdges.push({ kind: "recipe_uses_tool", recipe: e.name, tool: e.toolchain });
              for (const r of e.uses_registers) {
                pendingEdges.push({ kind: "recipe_uses_register", recipe: e.name, register: r });
              }
              for (const k of e.uses_kernal) {
                pendingEdges.push({ kind: "recipe_uses_kernal", recipe: e.name, kernal: k });
              }
              break;
            case "technique":
              await falkor.addTechnique(e);
              entityCount++;
              break;
            case "pitfall":
              await falkor.addPitfall({
                name: e.name,
                title: e.title,
                severity: e.severity,
                region: e.region,
                category: e.category,
              });
              entityCount++;
              totalPitfalls++;
              break;
            case "crash_pattern":
              await falkor.addCrashPattern({
                symptom: e.symptom,
                description: e.description,
                likely_causes: e.likely_causes,
                diagnosis_steps: e.diagnosis_steps,
              });
              entityCount++;
              totalCrashPatterns++;
              break;
          }
        } else {
          // Pass 1: collect edge entities for deferred processing
          switch (e.type) {
            case "belongs_to":
              pendingEdges.push({ kind: "belongs_to", entityType: e.entityType, entityName: e.entityName, chip: e.chip });
              break;
            case "pairs_with":
              pendingEdges.push({ kind: "pairs_with", a: e.a, b: e.b });
              break;
            case "produces":
              pendingEdges.push({ kind: "produces", tool: e.tool, format: e.format });
              break;
            case "consumes":
              pendingEdges.push({ kind: "consumes", tool: e.tool, format: e.format });
              break;
            case "targets":
              pendingEdges.push({ kind: "targets", tool: e.tool, chip: e.chip });
              break;
            case "implements":
              pendingEdges.push({ kind: "implements", recipe: e.recipe, technique: e.technique });
              break;
            case "produces_format":
              pendingEdges.push({ kind: "produces_format", recipe: e.recipe, format: e.format });
              break;
            case "technique_uses_register":
              pendingEdges.push({ kind: "technique_uses_register", technique: e.technique, register: e.register });
              break;
            case "technique_uses_kernal":
              pendingEdges.push({ kind: "technique_uses_kernal", technique: e.technique, kernal: e.kernal });
              break;
            case "technique_requires_region":
              pendingEdges.push({ kind: "technique_requires_region", technique: e.technique, region: e.region });
              break;
            case "technique_belongs_to":
              pendingEdges.push({ kind: "technique_belongs_to", technique: e.technique, chip: e.chip });
              break;
            case "triggered_by":
              pendingEdges.push({ kind: "triggered_by", pitfall: e.pitfall, target: e.target, targetKind: e.targetKind });
              break;
            case "caused_by":
              pendingEdges.push({ kind: "caused_by", symptom: e.symptom, target: e.target, targetKind: e.targetKind });
              break;
            case "recipe_occupies":
              pendingEdges.push({ kind: "recipe_occupies", recipe: e.recipe, start: e.start, end: e.end });
              break;
            case "technique_demands":
              pendingEdges.push({ kind: "technique_demands", technique: e.technique, resource: e.resource, description: e.description });
              break;
            case "technique_requires":
              pendingEdges.push({ kind: "technique_requires", technique: e.technique, requires: e.requires });
              break;
            case "mitigated_by":
              pendingEdges.push({ kind: "mitigated_by", pitfall: e.pitfall, target: e.target });
              break;
          }
        }
      } catch (err) {
        console.warn(`  graph error for ${e.type} in ${file}: ${err}`);
      }
    }

    console.log(`  ${file}: ${points.length} chunks, ${entityCount} graph entities`);
    log(`INGEST ${file} chunks=${points.length} graph=${entityCount}`);
  }

  // --- Pass 2: apply all deferred edge entities ---
  // Connection-class errors trigger an immediate abort; per-row malformation
  // is logged and skipped. Ten consecutive failures also abort (catches the
  // case where FalkorDB drops mid-pass but doesn't emit a socket error).
  const FATAL_PATTERNS = [
    /ECONNREFUSED/i,
    /ECONNRESET/i,
    /Connection is closed/i,
    /Redis connection/i,
  ];
  const FAILURE_THRESHOLD = 10;

  console.log(`\nPass 2: applying ${pendingEdges.length} deferred edges`);
  let edgeFailures = 0;
  let consecutiveFailures = 0;
  let pairsWithSkipped = 0;
  for (const edge of pendingEdges) {
    try {
      switch (edge.kind) {
        case "belongs_to":
          await falkor.linkBelongsTo(edge.entityType, edge.entityName, edge.chip);
          break;
        case "pairs_with": {
          const { linked } = await falkor.linkPairsWith(edge.a, edge.b);
          if (!linked) pairsWithSkipped++;
          break;
        }
        case "produces":
          await falkor.linkProduces(edge.tool, edge.format);
          break;
        case "consumes":
          await falkor.linkConsumes(edge.tool, edge.format);
          break;
        case "targets":
          await falkor.linkTargets(edge.tool, edge.chip);
          break;
        case "implements":
          await falkor.linkRecipeImplements(edge.recipe, edge.technique);
          break;
        case "produces_format":
          await falkor.linkRecipeProducesFormat(edge.recipe, edge.format);
          break;
        case "technique_uses_register":
          await falkor.linkTechniqueUsesRegister(edge.technique, edge.register);
          break;
        case "technique_uses_kernal":
          await falkor.linkTechniqueUsesKernal(edge.technique, edge.kernal);
          break;
        case "technique_requires_region":
          await falkor.linkTechniqueRequiresRegion(edge.technique, edge.region);
          break;
        case "technique_belongs_to":
          await falkor.linkTechniqueBelongsTo(edge.technique, edge.chip);
          break;
        case "recipe_uses_tool":
          await falkor.linkRecipeUsesTool(edge.recipe, edge.tool);
          break;
        case "recipe_uses_register":
          await falkor.linkRecipeUsesRegister(edge.recipe, edge.register);
          break;
        case "recipe_uses_kernal":
          await falkor.linkRecipeUsesKernal(edge.recipe, edge.kernal);
          break;
        case "recipe_occupies":
          await falkor.linkRecipeOccupies(edge.recipe, edge.start, edge.end);
          break;
        case "technique_demands":
          await falkor.linkTechniqueDemands(edge.technique, edge.resource, edge.description);
          break;
        case "triggered_by":
          if (!(await falkor.linkTriggeredBy(edge.pitfall, edge.target, edge.targetKind))) triggeredByDropped++;
          triggeredByRequested.add(`${edge.pitfall}|${edge.targetKind}|${edge.target}`);
          break;
        case "caused_by":
          if (!(await falkor.linkCausedBy(edge.symptom, edge.target, edge.targetKind))) causedByDropped++;
          causedByRequested.add(`${edge.symptom}|${edge.targetKind}|${edge.target}`);
          break;
        case "technique_requires":
          if (!(await falkor.linkTechniqueRequires(edge.technique, edge.requires))) requiresDropped++;
          requiresRequested.add(`${edge.technique}|${edge.requires}`);
          break;
        case "mitigated_by":
          if (!(await falkor.linkMitigatedBy(edge.pitfall, edge.target))) mitigatedByDropped++;
          mitigatedByRequested.add(`${edge.pitfall}|${edge.target}`);
          break;
      }
      consecutiveFailures = 0;
    } catch (err: any) {
      edgeFailures++;
      const isFatal = FATAL_PATTERNS.some(re => re.test(err?.message ?? ""));
      if (isFatal) {
        console.error(`[ingest] FATAL: connection-class error in pass 2: ${err.message}`);
        throw err;
      }
      consecutiveFailures++;
      if (consecutiveFailures >= FAILURE_THRESHOLD) {
        console.error(`[ingest] FATAL: ${consecutiveFailures} consecutive edge failures — aborting`);
        throw new Error(`Pass-2 edge ingest exceeded failure threshold (${FAILURE_THRESHOLD})`, { cause: err });
      }
      console.warn(`[ingest] edge failure (${edgeFailures} total): ${err.message}`);
    }
  }
  if (edgeFailures > 0) {
    console.warn(`\nPass 2: ${edgeFailures} edges failed to land (graph state may be incomplete)`);
    log(`PASS2_FAILURES ${edgeFailures}`);
  }

  // --- P0-2: Stub-Technique scan ---
  // Technique nodes created by linkRecipeImplements MERGE stubs have no title
  // or category — they indicate a typo in a recipe's techniques: array.
  // Address-derived edges: every Register and KERNAL routine into the
  // memory-map region that contains it. Needs all nodes to exist first.
  const inRegion = await falkor.linkAddressesToRegions();
  console.log(`IN_REGION: ${inRegion.registers} registers, ${inRegion.kernal} KERNAL routines placed in memory regions`);

  const stubResult = await falkor.roQuery(
    `MATCH (t:Technique)
     WHERE t.title IS NULL OR t.title = ""
     RETURN t.name AS name
     ORDER BY name`
  );
  const stubTechniques = (stubResult.data as Array<{ name: string }>).map(r => r.name);
  if (stubTechniques.length > 0) {
    console.warn(`[ingest] stub Technique nodes (typo in recipe.techniques array?): ${stubTechniques.join(", ")}`);
    log(`STUB_TECHNIQUES ${stubTechniques.join(", ")}`);
  }

  const qStats = await qdrant.getStats();
  const gStats = await falkor.getStats();
  // Count what actually landed: an edge whose target name matches no node is
  // dropped by the MERGE, and the request counters above cannot see that.
  const countEdges = async (rel: string): Promise<number> => {
    const r = await falkor.roQuery(`MATCH ()-[e:${rel}]->() RETURN count(e) AS n`);
    return Number((r.data?.[0] as { n?: number } | undefined)?.n ?? 0);
  };
  const triggeredByLanded = await countEdges("TRIGGERED_BY");
  const causedByLanded = await countEdges("CAUSED_BY");
  const requiresLanded = await countEdges("REQUIRES");
  const mitigatedByLanded = await countEdges("MITIGATED_BY");
  const totalTriggeredBy = triggeredByRequested.size;
  const totalCausedBy = causedByRequested.size;
  const totalRequires = requiresRequested.size;
  const totalMitigatedBy = mitigatedByRequested.size;
  console.log(`\nQdrant: ${qStats.total_points} vectors`);
  console.log(`FalkorDB: ${gStats.nodes} nodes, ${gStats.edges} edges`);
  console.log(`Ingested ${totalChunks} new chunks. Skipped ${skipped} unchanged files. stub Techniques: ${stubTechniques.length}. pairs_with skipped: ${pairsWithSkipped} (missing KERNAL targets). Pitfalls: ${totalPitfalls}. CrashPatterns: ${totalCrashPatterns}. triggered_by: ${triggeredByLanded} edges in graph, ${totalTriggeredBy} distinct references, ${triggeredByDropped} dropped. caused_by: ${causedByLanded} edges in graph, ${totalCausedBy} distinct references, ${causedByDropped} dropped. requires: ${requiresLanded} edges in graph, ${totalRequires} distinct references, ${requiresDropped} dropped. mitigated_by: ${mitigatedByLanded} edges in graph, ${totalMitigatedBy} distinct references, ${mitigatedByDropped} dropped.`);
  const droppedRefs = triggeredByDropped + causedByDropped + requiresDropped + mitigatedByDropped;
  if (droppedRefs > 0) {
    console.warn(`[ingest] WARNING: ${droppedRefs} trigger/cause/requires/mitigated-by references named no existing node (or would have closed a REQUIRES cycle) and were dropped; see the [falkor] lines above.`);
  }
  log(`DONE chunks=${totalChunks} skipped=${skipped} stub_techniques=${stubTechniques.length} pairs_with_skipped=${pairsWithSkipped} pitfalls=${totalPitfalls} crash_patterns=${totalCrashPatterns} triggered_by=${triggeredByLanded}/${totalTriggeredBy}/dropped=${triggeredByDropped} caused_by=${causedByLanded}/${totalCausedBy}/dropped=${causedByDropped} requires=${requiresLanded}/${totalRequires}/dropped=${requiresDropped} mitigated_by=${mitigatedByLanded}/${totalMitigatedBy}/dropped=${mitigatedByDropped}`);

  await falkor.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Ingest failed:", err);
  process.exit(1);
});
