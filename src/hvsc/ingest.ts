/**
 * AnalyzerWorker: drive the Python sidecar over JSONL-over-stdio.
 *
 * The worker is a long-lived child process. We write one tune path per
 * line to stdin and read one JSONL document per tune from stdout. The
 * worker isolates per-tune failures internally and never crashes from
 * a bad tune — it just emits an ErrorResult and continues.
 *
 * If the worker process does crash, callers should restart it via a
 * new `spawnAnalyzer()` call (no automatic restart at this layer).
 */
import { spawn, ChildProcess } from "node:child_process";
import { createInterface, Interface } from "node:readline";
import { join, resolve } from "node:path";

export type TuneExtract = {
  kind: "extract";
  file_md5: string;
  subtune_index: number;
  meta: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
  instruments: Array<Record<string, unknown>>;
  patches: Array<Record<string, unknown>>;
  filter_curve: Array<Record<string, unknown>>;
  pulsewidth: Array<Record<string, unknown>>;
  vibrato: Array<Record<string, unknown>>;
  structure: Record<string, unknown>;
  driver: Record<string, unknown>;
  pipeline_version: string;
  clustering_params_hash: string;
};

export type ErrorResult = {
  kind: "error";
  file_md5: string;
  subtune_index: number;
  error_kind: string;
  message: string;
};

export type ExtractResult = TuneExtract | ErrorResult;

export interface ExtractRequest {
  sidPath: string;
  subtune: number;
}

export class AnalyzerWorker {
  private proc: ChildProcess;
  private rl: Interface;
  private queue: Array<(line: string) => void> = [];
  private exited = false;

  constructor(proc: ChildProcess) {
    this.proc = proc;
    if (!proc.stdout) throw new Error("Worker stdout missing");
    this.rl = createInterface({ input: proc.stdout });
    this.rl.on("line", (line) => {
      const cb = this.queue.shift();
      if (cb) cb(line);
    });
    proc.on("exit", () => {
      this.exited = true;
      // Drain any pending callers with an error
      while (this.queue.length) {
        const cb = this.queue.shift();
        if (cb)
          cb(
            JSON.stringify({
              kind: "error",
              file_md5: "0".repeat(32),
              subtune_index: 0,
              error_kind: "unknown",
              message: "Analyzer worker exited before responding",
            })
          );
      }
    });
  }

  async extract(req: ExtractRequest): Promise<ExtractResult> {
    if (this.exited) {
      return {
        kind: "error",
        file_md5: "0".repeat(32),
        subtune_index: req.subtune,
        error_kind: "unknown",
        message: "Worker already exited",
      };
    }
    // Resolve to absolute so the Python worker (CWD=analyzer/) finds the file
    // regardless of where the path was constructed.
    const line = `${resolve(req.sidPath)},subtune=${req.subtune}\n`;
    if (!this.proc.stdin) throw new Error("Worker stdin missing");
    const reply = await new Promise<string>((resolve) => {
      this.queue.push(resolve);
      this.proc.stdin!.write(line);
    });
    return JSON.parse(reply) as ExtractResult;
  }

  async shutdown(): Promise<void> {
    if (this.exited) return;
    this.proc.stdin?.end();
    return new Promise((resolve) => {
      this.proc.once("exit", () => resolve());
    });
  }
}

export interface SpawnOpts {
  pythonBin?: string;
  analyzerDir?: string;
}

export async function spawnAnalyzer(opts: SpawnOpts = {}): Promise<AnalyzerWorker> {
  const analyzerDir = opts.analyzerDir ?? join(process.cwd(), "analyzer");
  // Prefer the venv Python if it exists; otherwise fall back to "python3".
  const venvPython = join(analyzerDir, ".venv", "bin", "python");
  const python = opts.pythonBin ?? venvPython;
  const proc = spawn(python, ["pipeline.py", "extract", "--stdio"], {
    cwd: analyzerDir,
    stdio: ["pipe", "pipe", "inherit"],
  });
  return new AnalyzerWorker(proc);
}
