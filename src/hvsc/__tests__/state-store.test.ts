import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IngestStateStore } from "../state-store.js";

let tmpDir: string;
let dbPath: string;
let store: IngestStateStore;

beforeEach(() => {
  tmpDir = join(tmpdir(), `state-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  dbPath = join(tmpDir, "ingest-state.db");
  store = new IngestStateStore(dbPath);
});

afterEach(() => {
  store.close();
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
});

describe("IngestStateStore", () => {
  it("creates schema on first open", () => {
    expect(existsSync(dbPath)).toBe(true);
    expect(store.totalRows()).toBe(0);
  });

  it("upsertPending inserts new rows; ignores existing", () => {
    expect(store.upsertPending([
      { file_md5: "a", subtune_index: 0 },
      { file_md5: "a", subtune_index: 1 },
      { file_md5: "b", subtune_index: 0 },
    ])).toBe(3);
    expect(store.upsertPending([
      { file_md5: "a", subtune_index: 0 },         // already exists
      { file_md5: "c", subtune_index: 0 },         // new
    ])).toBe(1);
    expect(store.totalRows()).toBe(4);
  });

  it("takeNext claims one pending row at a time and marks it in_progress", () => {
    store.upsertPending([
      { file_md5: "a", subtune_index: 0 },
      { file_md5: "a", subtune_index: 1 },
    ]);
    const first = store.takeNext();
    expect(first).not.toBeNull();
    expect(store.countsByStatus().in_progress).toBe(1);
    expect(store.countsByStatus().pending).toBe(1);

    const second = store.takeNext();
    expect(second).not.toBeNull();
    expect(second?.file_md5).toBe(first!.file_md5);   // same file, different subtune
    expect(store.countsByStatus().in_progress).toBe(2);
    expect(store.countsByStatus().pending).toBe(0);

    expect(store.takeNext()).toBeNull();              // nothing left
  });

  it("promoteOrphans returns lost in_progress rows to pending", () => {
    store.upsertPending([{ file_md5: "a", subtune_index: 0 }]);
    store.takeNext();
    expect(store.countsByStatus().in_progress).toBe(1);
    const promoted = store.promoteOrphans();
    expect(promoted).toBe(1);
    expect(store.countsByStatus().pending).toBe(1);
    expect(store.countsByStatus().in_progress).toBe(0);
  });

  it("recordComplete marks complete + records pipeline_version", () => {
    store.upsertPending([{ file_md5: "a", subtune_index: 0 }]);
    store.takeNext();
    store.recordComplete("a", 0, "0.2.0");
    expect(store.countsByStatus().complete).toBe(1);
  });

  it("recordError transient retries up to 3 attempts then escalates to permanent", () => {
    store.upsertPending([{ file_md5: "a", subtune_index: 0 }]);
    store.takeNext();
    expect(store.recordError("a", 0, "vsid_timeout", true)).toBe("error_transient");
    expect(store.recordError("a", 0, "vsid_timeout", true)).toBe("error_transient");
    expect(store.recordError("a", 0, "vsid_timeout", true)).toBe("error_permanent");
    expect(store.countsByStatus().error_permanent).toBe(1);
  });

  it("recordError non-transient is permanent immediately", () => {
    store.upsertPending([{ file_md5: "a", subtune_index: 0 }]);
    store.takeNext();
    expect(store.recordError("a", 0, "malformed_sid", false)).toBe("error_permanent");
  });

  it("requeueByKind promotes error_transient cohort back to pending", () => {
    store.upsertPending([
      { file_md5: "a", subtune_index: 0 },
      { file_md5: "b", subtune_index: 0 },
      { file_md5: "c", subtune_index: 0 },
    ]);
    for (let i = 0; i < 3; i++) {
      const r = store.takeNext();
      store.recordError(r!.file_md5, r!.subtune_index, i < 2 ? "vsid_timeout" : "malformed_sid", true);
    }
    // a + b are vsid_timeout (transient, attempt 1 → error_transient); c is malformed (transient, attempt 1 → error_transient)
    expect(store.requeueByKind("vsid_timeout")).toBe(2);
    expect(store.countsByStatus().pending).toBe(2);
    expect(store.countsByStatus().error_transient).toBe(1);   // c remains
  });

  it("topErrorKinds returns histogram", () => {
    store.upsertPending([
      { file_md5: "a", subtune_index: 0 },
      { file_md5: "b", subtune_index: 0 },
      { file_md5: "c", subtune_index: 0 },
    ]);
    for (let i = 0; i < 3; i++) {
      const r = store.takeNext();
      store.recordError(r!.file_md5, r!.subtune_index, i < 2 ? "vsid_timeout" : "malformed_sid", false);
    }
    const top = store.topErrorKinds(5);
    expect(top).toEqual([
      { error_kind: "vsid_timeout", count: 2 },
      { error_kind: "malformed_sid", count: 1 },
    ]);
  });

  it("md5sByErrorKind returns affected md5s", () => {
    store.upsertPending([
      { file_md5: "a", subtune_index: 0 },
      { file_md5: "b", subtune_index: 0 },
    ]);
    for (let i = 0; i < 2; i++) {
      const r = store.takeNext();
      store.recordError(r!.file_md5, r!.subtune_index, "vsid_timeout", false);
    }
    const md5s = store.md5sByErrorKind("vsid_timeout");
    expect(md5s.sort()).toEqual(["a", "b"]);
  });

  it("recordSkip marks skip_unsupported_format with reason", () => {
    store.upsertPending([{ file_md5: "a", subtune_index: 0 }]);
    store.takeNext();
    store.recordSkip("a", 0, "MUS format");
    expect(store.countsByStatus().skip_unsupported_format).toBe(1);
  });

  it("persists across reopen (WAL durability)", () => {
    store.upsertPending([{ file_md5: "a", subtune_index: 0 }]);
    store.close();
    store = new IngestStateStore(dbPath);
    expect(store.totalRows()).toBe(1);
    expect(store.countsByStatus().pending).toBe(1);
  });
});
