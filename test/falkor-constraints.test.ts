import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";

let svc: FalkorService;

beforeAll(async () => {
  svc = new FalkorService();
  await svc.connect();
  // Full graph drop so ensureSchema always creates constraints from scratch.
  // clean() only deletes nodes — it leaves constraints intact, which means
  // stale constraints from before a primary-key rename survive and cause
  // false-passes. dropGraph() removes everything including constraints.
  await svc.dropGraph();
  await svc.ensureSchema();
});

afterAll(async () => {
  await svc.close();
});

describe("FalkorService unique constraints", () => {
  it("declares unique constraints on every node label's primary key", async () => {
    const result = await svc.roQuery(
      `CALL db.constraints() YIELD label, properties, type, status RETURN label, properties, type, status`,
    );
    const constraints = result.data.map(
      (r) => r as { label: string; properties: string[]; type: string; status: string },
    );
    const uniqueByLabel = new Map<string, string[]>();
    for (const c of constraints) {
      if (c.type === "UNIQUE") {
        uniqueByLabel.set(c.label, c.properties);
      }
    }
    expect(uniqueByLabel.get("Register")).toEqual(["name"]);
    expect(uniqueByLabel.get("KernalRoutine")).toEqual(["name"]);
    expect(uniqueByLabel.get("MemoryRegion")).toEqual(["name"]);
    expect(uniqueByLabel.get("Chip")).toEqual(["name"]);
    expect(uniqueByLabel.get("Region")).toEqual(["name"]);
    expect(uniqueByLabel.get("Tool")).toEqual(["name"]);
    expect(uniqueByLabel.get("Recipe")).toEqual(["name"]);
    expect(uniqueByLabel.get("FileFormat")).toEqual(["name"]);
    expect(uniqueByLabel.get("Technique")).toEqual(["name"]);
    expect(uniqueByLabel.get("Pitfall")).toEqual(["name"]);
    expect(uniqueByLabel.get("CrashPattern")).toEqual(["symptom"]);
  });
});
