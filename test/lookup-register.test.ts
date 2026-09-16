import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.js";
import { lookupRegister } from "../src/tools/query.js";

// These tests seed just the two registers they need so they are isolated
// from corpus state. Other test files call clean() which would wipe live data.

let f: FalkorService;

beforeAll(async () => {
  f = new FalkorService();
  await f.connect();
  await f.clean();
  await f.ensureSchema();
  // Seed minimal register data for the decimal-address tests.
  await f.addRegister("SCROLY", "$D011", "VIC-II", "RW", ["D011"]);
  await f.linkBelongsTo("Register", "SCROLY", "VIC-II");
  await f.addRegister("FRELO1", "$D400", "SID", "RW", ["D400"]);
  await f.linkBelongsTo("Register", "FRELO1", "SID");
});

afterAll(async () => {
  await f.close();
});

describe("lookupRegister decimal addresses", () => {
  it("resolves $D011 from decimal 53265", async () => {
    const r = await lookupRegister("53265");
    expect(r.structured.found).toBe(true);
    expect(r.structured.address).toBe("$D011");
  });

  it("resolves $D400 from decimal 54272", async () => {
    const r = await lookupRegister("54272");
    expect(r.structured.found).toBe(true);
    expect(r.structured.address).toBe("$D400");
  });

  it("returns guard message for single-character lookups", async () => {
    const r = await lookupRegister("A");
    expect(r.structured.found).toBe(false);
    expect(r.text).toMatch(/at least 2 characters/);
  });
});
