import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { claimsWatch, ClaimsWatchInput, recipePage } from "../src/tools/claims-watch.ts";
import { ClaimsWatchOutput, claimsWatchReply } from "../src/server/tools-claims.ts";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { findToolchains } from "../scripts/lib/toolchains.ts";

// c64_claims_watch (#22 step 8): the MCP face of scripts/claims-watch.ts.
const docs = join(import.meta.dirname, "..", "docs");
const args = (over: Record<string, unknown>) => z.object(ClaimsWatchInput).parse({ prg_path: "", ...over });

describe("c64_claims_watch: inputs", () => {
  it("resolves a recipe by name or by page, and nothing outside docs/recipes", () => {
    const byName = recipePage(docs, "kickassembler-sine-scroller");
    expect(byName).toMatch(/docs\/recipes\/kickassembler\/sine-scroller\.md$/);
    expect(recipePage(docs, "recipes/kickassembler/sine-scroller.md")).toBe(byName);
    expect(recipePage(docs, "docs/recipes/kickassembler/sine-scroller.md")).toBe(byName);
    expect(recipePage(docs, "kickassembler-no-such-recipe")).toBeNull();
    expect(recipePage(docs, "kickassembler-../../README")).toBeNull();
    expect(recipePage(docs, "../package.json")).toBeNull();
  });

  it("refuses a PRG outside the repo and the temp directory, and an unknown recipe", async () => {
    const outside = await claimsWatch(args({ prg_path: "/etc/hosts" }), docs);
    expect(outside).toMatchObject({ ok: false, reason: "path" });
    const reply = claimsWatchReply(outside);
    expect(reply.isError).toBe(true);
    expect(reply.structured).toBeUndefined();
  });
});

const x64sc = resolveX64sc();
const tools = findToolchains();
const canRun = x64sc !== null && !x64sc.windowed && tools.kickass !== null && tools.java !== null;
if (!canRun)
  console.warn("claims-watch-tool.test: no windowless x64sc or no KickAssembler; the VICE run is skipped");

describe.skipIf(!canRun)("c64_claims_watch in VICE", () => {
  const ASM = [
    "BasicUpstart2(start)",
    "start:",
    "    sei",
    "    lda #$01",
    "    sta $d015          // sprite 0: declared",
    "    lda #$21",
    "    sta $d40b          // voice 2 control: not declared",
    "    sta $fb            // zero page: not declared",
    "loop: jmp loop",
  ].join("\n");
  let work = "";
  let prg = "";
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "claims-watch-tool-"));
    writeFileSync(join(work, "t.asm"), ASM);
    const asm = spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], {
      cwd: work,
      encoding: "utf8",
    });
    expect(asm.status).toBe(0);
    prg = join(work, "t.prg");
  });
  afterAll(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it("fails on the undeclared voice and byte, with a structured result the schema accepts", async () => {
    const r = await claimsWatch(args({ prg_path: prg, cycles: 4_000_000, claims: "sprite_0" }), docs);
    expect(r.ok).toBe(true);
    const reply = claimsWatchReply(r);
    const parsed = z.object(ClaimsWatchOutput).safeParse(reply.structured);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.verdict).toBe("fail");
    expect(parsed.data?.violations.map((v) => [v.target, v.addresses])).toEqual(
      expect.arrayContaining([
        ["sid_voice_2", ["$D40B"]],
        ["zero page", ["$FB"]],
      ]),
    );
    expect(reply.text).toMatch(/^FAIL: 2 stores in 2 violation groups$/m);
  }, 120_000);

  it("passes when they are declared", async () => {
    const r = await claimsWatch(
      args({ prg_path: prg, cycles: 4_000_000, claims: "sprite_0, sid_voice_2, zero_page $FB" }),
      docs,
    );
    expect(r.ok && r.result.verdict).toBe("pass");
  }, 120_000);
});
