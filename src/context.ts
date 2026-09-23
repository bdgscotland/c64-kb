/**
 * Shared service context for both CLI and MCP server.
 * Lazy-initializes connections to Qdrant, FalkorDB, and Analytics.
 */

import { QdrantService } from "./services/qdrant.ts";
import { FalkorService } from "./services/falkor.ts";
import { AnalyticsService } from "./services/analytics.ts";

let qdrant: QdrantService | null = null;
let falkor: FalkorService | null = null;
let analytics: AnalyticsService | null = null;

export async function getQdrant(): Promise<QdrantService> {
  if (!qdrant) {
    qdrant = new QdrantService();
    await qdrant.ensureCollection();
  }
  return qdrant;
}

export async function getFalkor(): Promise<FalkorService> {
  if (!falkor) {
    falkor = new FalkorService();
    await falkor.connect();
    await falkor.ensureSchema();
  }
  return falkor;
}

export function getAnalytics(): AnalyticsService {
  if (!analytics) {
    analytics = new AnalyticsService();
  }
  return analytics;
}
