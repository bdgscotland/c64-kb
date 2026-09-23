/**
 * Shared service context for both CLI and MCP server.
 * Lazy-initializes connections to Qdrant, FalkorDB, and Analytics.
 *
 * The promise is cached, not the finished service: two calls that arrive
 * before the first connection completes share it. Caching the service let
 * `Promise.all([search(), findTechniquesByKeyword()])` on a cold server open
 * two FalkorDB connections and run ensureSchema twice.
 */

import { QdrantService } from "./services/qdrant.ts";
import { FalkorService } from "./services/falkor.ts";
import { AnalyticsService } from "./services/analytics.ts";

let qdrant: Promise<QdrantService> | null = null;
let falkor: Promise<FalkorService> | null = null;
let analytics: AnalyticsService | null = null;

export function getQdrant(): Promise<QdrantService> {
  qdrant ??= (async () => {
    const q = new QdrantService();
    await q.ensureCollection();
    return q;
  })().catch((err: unknown) => {
    qdrant = null; // let the next call retry instead of caching the failure
    throw err;
  });
  return qdrant;
}

export function getFalkor(): Promise<FalkorService> {
  falkor ??= (async () => {
    const f = new FalkorService();
    await f.connect();
    await f.ensureSchema();
    return f;
  })().catch((err: unknown) => {
    falkor = null;
    throw err;
  });
  return falkor;
}

export function getAnalytics(): AnalyticsService {
  analytics ??= new AnalyticsService();
  return analytics;
}

/** Close whatever was opened. Safe to call more than once. */
export async function closeAll(): Promise<void> {
  const f = falkor;
  const a = analytics;
  falkor = null;
  qdrant = null;
  analytics = null;
  await Promise.allSettled([f?.then((s) => s.close())]);
  a?.close();
}
