/**
 * Connection, read and write plumbing for FalkorService. Every write goes
 * through `write`; node upserts and edge merges through `upsertNode`,
 * `setNode` and `mergeEdge`, so the Cypher shape of each lives in one place.
 */

import { FalkorDB } from "falkordb";
import type { z } from "zod";
import { config } from "../../config.ts";
import { toQueryParams, type QueryParams } from "./params.ts";
import type { NodeLabel, NamedLabel } from "./schema.ts";

/**
 * One end of an edge. `{ register }` matches a Register by canonical name,
 * hex address or alias, so docs can say "D011", "$D011" or "SCROLY".
 */
export type EdgeEnd =
  | { label: NamedLabel; name: string; create?: boolean }
  | { label: "CrashPattern"; symptom: string }
  | { register: string };

export interface EdgeSpec {
  from: EdgeEnd;
  rel: string;
  to: EdgeEnd;
}

function matchEnd(alias: "a" | "b", end: EdgeEnd): { clause: string; params: QueryParams } {
  if ("register" in end) {
    return {
      clause: `MATCH (${alias}:Register) WHERE ${alias}.name = $${alias} OR ${alias}.address = $${alias}Addr OR $${alias} IN ${alias}.aliases`,
      params: { [alias]: end.register, [`${alias}Addr`]: `$${end.register}` },
    };
  }
  if ("symptom" in end) {
    return { clause: `MATCH (${alias}:CrashPattern {symptom: $${alias}})`, params: { [alias]: end.symptom } };
  }
  const verb = end.create ? "MERGE" : "MATCH";
  return { clause: `${verb} (${alias}:${end.label} {name: $${alias}})`, params: { [alias]: end.name } };
}

export class FalkorBase {
  private db: FalkorDB | null = null;
  private readonly graphName = config.falkor.graphName;

  async connect(host: string = config.falkor.host, port: number = config.falkor.port): Promise<void> {
    this.db = await FalkorDB.connect({ socket: { host, port } });
    // The client re-emits socket errors as 'error' events. With no listener
    // Node throws them, so a FalkorDB restart would kill a long-lived MCP
    // server; the client reconnects on its own once the socket returns.
    this.db.on("error", (err: unknown) => {
      console.error("[falkor] connection error:", err instanceof Error ? err.message : err);
    });
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  protected graph() {
    if (!this.db) throw new Error("Not connected to FalkorDB");
    return this.db.selectGraph(this.graphName);
  }

  /** Run a write query; returns the result rows (empty when it returns none). */
  protected async write(cypher: string, params?: QueryParams): Promise<unknown[]> {
    const result = await this.graph().query(cypher, params ? { params } : undefined);
    return result.data ?? [];
  }

  /**
   * Read-only Cypher passthrough, used by tools and tests. Rows are
   * `unknown` unless a zod schema is passed, which checks each row and
   * types the result.
   */
  async roQuery(cypher: string, params?: Record<string, unknown>): Promise<{ data: unknown[] }>;
  async roQuery<S extends z.ZodType>(
    cypher: string,
    params: Record<string, unknown> | undefined,
    schema: S,
  ): Promise<{ data: z.output<S>[] }>;
  async roQuery(
    cypher: string,
    params?: Record<string, unknown>,
    schema?: z.ZodType,
  ): Promise<{ data: unknown[] }> {
    const options = params ? { params: toQueryParams(params) } : undefined;
    const result = await this.graph().roQuery(cypher, options);
    const rows = result.data ?? [];
    return { data: schema ? rows.map((r) => schema.parse(r)) : rows };
  }

  /**
   * MERGE on the key, then `+=` the properties, stamping created_at or
   * updated_at. `clear` names properties to set to NULL, so a value the page
   * dropped does not outlive it.
   */
  protected async upsertNode(opts: {
    label: NamedLabel;
    name: string;
    props: QueryParams;
    clear?: readonly string[];
  }): Promise<void> {
    const clear = opts.clear ?? [];
    const clearClause = clear.length > 0 ? `SET ${clear.map((p) => `n.${p} = NULL`).join(", ")}` : "";
    await this.write(
      `MERGE (n:${opts.label} {name: $name})
       ON CREATE SET n += $props, n.created_at = timestamp()
       ON MATCH SET n += $props, n.updated_at = timestamp()
       ${clearClause}`,
      { name: opts.name, props: opts.props },
    );
  }

  /** MERGE on the key and overwrite the given properties, with no timestamps. */
  protected async setNode(
    label: NodeLabel,
    key: { name: string } | { symptom: string },
    props: QueryParams,
  ): Promise<void> {
    const [prop, value] = "name" in key ? ["name", key.name] : ["symptom", key.symptom];
    await this.write(`MERGE (n:${label} {${prop}: $key}) SET n += $props`, { key: value, props });
  }

  /** MERGE one edge between two ends. Returns whether it landed (both ends found). */
  protected async mergeEdge(spec: EdgeSpec): Promise<boolean> {
    const a = matchEnd("a", spec.from);
    const b = matchEnd("b", spec.to);
    const rows = await this.write(
      `${a.clause}
       ${b.clause}
       MERGE (a)-[:${spec.rel}]->(b)
       RETURN 1`,
      { ...a.params, ...b.params },
    );
    return rows.length > 0;
  }
}
