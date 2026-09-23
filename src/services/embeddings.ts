/**
 * Embedding service using Ollama's mxbai-embed-large model.
 *
 * Requires: ollama running locally with `ollama pull mxbai-embed-large`
 * Dimension: 1024 (matches Qdrant collection config)
 * Fallback: if Ollama is unavailable, returns null and callers
 *           should fall back to keyword search.
 */

import { config } from "../config.ts";

const OLLAMA_URL = config.ollama.url;
const MODEL = config.ollama.model;

export async function embed(text: string): Promise<number[] | null> {
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt: text }),
    });

    if (!resp.ok) return null;

    const data = (await resp.json()) as { embedding?: number[] };
    return data.embedding ?? null;
  } catch {
    return null;
  }
}

export async function embedBatch(texts: string[]): Promise<Array<number[] | null>> {
  // Ollama doesn't have a native batch endpoint, so we parallelize
  // with a concurrency limit to avoid overwhelming it
  const CONCURRENCY = config.ollama.concurrency;
  const results: Array<number[] | null> = new Array(texts.length).fill(null);

  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const batch = texts.slice(i, i + CONCURRENCY);
    const promises = batch.map((t) => embed(t));
    const batchResults = await Promise.all(promises);
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
  }

  return results;
}

export async function isAvailable(): Promise<boolean> {
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!resp.ok) return false;
    const data = (await resp.json()) as { models?: Array<{ name: string }> };
    return data.models?.some((m) => m.name.startsWith(MODEL)) ?? false;
  } catch {
    return false;
  }
}
