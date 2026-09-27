/**
 * A monitor log bigger than its cap: the tool returns without a crash and
 * names the cut in `unknowns` (issue #134). The stand-in x64sc writes a log
 * past the cap in bursts, so runBatch's poll sees it and stops the run; the
 * tool must then say the trace stopped early. Before the fix neither
 * re-irq-chain nor a session pass passed any cap on these paths and nothing
 * reported a cut.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionSchema, sessionScript, type Session } from "../src/re/session.ts";
import { reIrqChain } from "../src/tools/re.ts";
import { sessionPass, type Staged } from "../src/tools/re-session.ts";

const made: string[] = [];
const dir = (): string => {
  const d = mkdtempSync(join(tmpdir(), "re-log-cap-"));
  made.push(d);
  return d;
};
afterEach(() => {
  while (made.length) rmSync(made.pop() ?? "", { recursive: true, force: true });
  delete process.env.X64SC_BIN;
});

/**
 * A stand-in x64sc: it writes a monitor log far past any small cap in
 * bursts (each burst, then a short sleep, so the 100 ms size poll in
 * src/services/vice-batch.ts sees the cap and stops the run), then exits
 * the way a -limitcycles run does (status 1). Bounded either way: a run
 * that is never capped still ends and leaks no process.
 */
function fakeX64sc(): string {
  const d = dir();
  const bin = join(d, "x64sc");
  const head = "#1 (Trace store 0400)  0/$000,  0/$00";
  const line = ".C:0819  86 FB       STX $FB        - A:FF X:12 Y:00 SP:f6 ..-..I..    3049325";
  writeFileSync(
    bin,
    `#!/bin/sh
while [ $# -gt 0 ]; do [ "$1" = "-monlogname" ] && log="$2"; shift; done
i=0
while [ $i -lt 8 ]; do
  awk 'BEGIN { for (n = 0; n < 5000; n++) { print "${head}"; print "${line}" } }' >> "$log"
  sleep 0.2
  i=$((i + 1))
done
exit 1
`,
    { mode: 0o755 },
  );
  process.env.X64SC_BIN = bin;
  return d;
}

/** A PRG the tool may run: a 4-byte stub with no SYS, so no entry is needed. */
function dummyPrg(): string {
  const d = dir();
  const prg = join(d, "p.prg");
  writeFileSync(prg, Buffer.from([0x01, 0x08, 0x00, 0x00]));
  return prg;
}

const session: Session = SessionSchema.parse({
  image: { sha1: "0".repeat(40), kind: "prg", title: "cap test" },
  machine: { model: "pal" },
  inject: [],
  in_play: { check: "exec", pc: "$0819", after_clock: 0 },
  limitcycles: 100_000,
});

const CUT = /reached its size cap/;

describe("a log larger than maxLogBytes", () => {
  it("c64_re_irq_chain returns and names the cut in unknowns", async () => {
    fakeX64sc();
    const r = await reIrqChain({ prg_path: dummyPrg() }, { maxLogBytes: 200_000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.unknowns.join("\n")).toMatch(CUT);
  }, 30_000);

  it("a session pass returns, says it was truncated, and names the cut in unknowns", async () => {
    fakeX64sc();
    const prg = dummyPrg();
    const staged: Staged = {
      prg,
      image: { sha1: session.image.sha1, kind: "prg", fileSha1: session.image.sha1 },
    };
    const p = await sessionPass(staged, session, sessionScript(session), {
      screenshot: join(dir(), "s.png"),
      maxLogBytes: 200_000,
    });
    expect(p.truncated).toBe(true);
    expect(p.unknowns.join("\n")).toMatch(CUT);
  }, 30_000);
});
