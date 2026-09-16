import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFeedback, loadFeedback, type FeedbackRecord } from "../feedback.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let dir: string;
let db: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fb-")); db = join(dir, "fb.jsonl"); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const rec = (over: Partial<FeedbackRecord> = {}): FeedbackRecord => ({
  id: "x1", ts: "2026-05-21T00:00:00Z", composer: "Rob Hubbard", method: "ai",
  title: "t", verdict: "decent", ...over,
});

describe("feedback store", () => {
  it("loads [] when the file does not exist yet", () => {
    expect(loadFeedback(db)).toEqual([]);
  });

  it("appends records and loads them back in order", () => {
    appendFeedback(rec({ id: "a", verdict: "not good" }), db);
    appendFeedback(rec({ id: "b", verdict: "best-yet", composer: "Reyn Ouwehand" }), db);
    const rows = loadFeedback(db);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[1].verdict).toBe("best-yet");
    expect(rows[1].composer).toBe("Reyn Ouwehand");
  });

  it("round-trips metrics + notes", () => {
    appendFeedback(rec({ id: "m", metrics: { consonance_pct: 96.8, in_style_pct: 40.4 }, notes: "octave bass" }), db);
    const r = loadFeedback(db)[0];
    expect(r.metrics?.consonance_pct).toBe(96.8);
    expect(r.notes).toBe("octave bass");
  });

  it("skips blank/corrupt lines without throwing", () => {
    appendFeedback(rec({ id: "ok" }), db);
    // simulate a partial write
    require("node:fs").appendFileSync(db, "\n{ not json\n");
    const rows = loadFeedback(db);
    expect(rows.map((r) => r.id)).toEqual(["ok"]);
  });
});
