/**
 * Embedding service using Ollama's mxbai-embed-large model.
 *
 * Requires: ollama running locally with `ollama pull mxbai-embed-large`
 * Dimension: 1024 (matches Qdrant collection config)
 * Fallback: if Ollama is unavailable, returns null and callers
 *           should fall back to keyword search.
 */

import { z } from "zod";
import { config } from "../config.ts";

const EmbeddingReply = z.object({ embedding: z.array(z.number()).optional() });
const TagsReply = z.object({ models: z.array(z.object({ name: z.string() })).optional() });

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

    const data = EmbeddingReply.parse(await resp.json());
    return data.embedding ?? null;
  } catch (err) {
    // Ollama unreachable or a malformed reply: the caller falls back to keyword search.
    console.error(`[embeddings] embed failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  // Ollama doesn't have a native batch endpoint, so we parallelize
  // with a concurrency limit to avoid overwhelming it
  const CONCURRENCY = config.ollama.concurrency;
  const results: (number[] | null)[] = [];

  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const batch = texts.slice(i, i + CONCURRENCY);
    const promises = batch.map((t) => embed(t));
    results.push(...(await Promise.all(promises)));
  }

  return results;
}

export async function isAvailable(): Promise<boolean> {
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!resp.ok) return false;
    const data = TagsReply.parse(await resp.json());
    return data.models?.some((m) => m.name.startsWith(MODEL)) ?? false;
  } catch {
    // This is the probe: an unreachable Ollama is the answer "not available", not an error.
    return false;
  }
}
