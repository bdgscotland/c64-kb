import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";

// The server speaks JSON-RPC on stdout, so one stray console.log corrupts the
// stream. It must also exit when the client closes stdin (MCP spec,
// transports/stdio); before 2026-09-22 nothing listened for that and the
// open FalkorDB socket kept the process alive.
describe("MCP server over stdio", () => {
  it("writes only JSON-RPC to stdout and exits when stdin closes", async () => {
    const p = spawn("node", ["src/cli.ts", "serve"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d: Buffer) => (out += d.toString()));
    const send = (m: object) => p.stdin.write(JSON.stringify(m) + "\n");

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "c64_lookup_register", arguments: { name_or_addr: "D011" } } });

    // Wait for the tool reply, then close stdin.
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (out.includes('"id":2')) {
          clearInterval(t);
          resolve();
        }
      }, 50);
    });
    const exited = new Promise<number | null>((resolve) => p.on("exit", resolve));
    p.stdin.end();
    const code = await Promise.race([exited, new Promise<"hung">((r) => setTimeout(() => r("hung"), 5000))]);
    if (code === "hung") p.kill("SIGKILL");

    expect(code).toBe(0);
    const lines = out.trim().split("\n");
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    const init = JSON.parse(lines[0]!) as { result: { serverInfo: { version: string } } };
    expect(init.result.serverInfo.version).not.toBe("0.1.0");
  });
});
