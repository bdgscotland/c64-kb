#!/usr/bin/env python3
"""plan-gate: no source is written and nothing is built until PLAN.md holds
the c64-kb output the plan was made from.

  plan-gate.py --check PLAN.md [--c64kb DIR] [--cache FILE]
      make's gate: exit 0 when the plan passes, 1 when it does not.
  plan-gate.py
      Claude Code PreToolUse hook: reads the tool call as JSON on stdin; exit
      2 blocks an Edit, MultiEdit, Write or NotebookEdit under <project>/src/
      while the plan does not pass; exit 0 allows everything else.

The plan passes when:
  - PLAN.md exists and has no "FILL:" placeholder left;
  - it holds check-compatibility's output: a "# Compatibility: a + b" line
    followed by a "**Verdict:** ..." line;
  - it holds plan-budget's output: a "# Budget plan: ..." line followed by a
    "Techniques: a, b" line and a "## play (" section with its "Range" line;
  - every technique those two outputs name is a row of the "## Techniques"
    table (first cell), and the two outputs name the same techniques.
With --c64kb pointing at a c64-kb checkout, `make` also re-runs
check-compatibility on the pasted names and requires the same Verdict line
(the result is cached against PLAN.md's contents in --cache). When the
checkout or its graph cannot be reached, it says so and checks the
structure only.

What it cannot catch: a plan whose outputs were edited by hand into the
right shape with the right verdict, and writes to src/ made through a Bash
command (the hook sees Edit, MultiEdit, Write and NotebookEdit only).
"""
import hashlib
import json
import os
import re
import subprocess
import sys

HOW_TO = """Fill PLAN.md from the c64-kb tools before writing code (in the c64-kb checkout):
  npx tsx src/cli.ts game-briefing "<concept>" --archetype <name>
  npx tsx src/cli.ts check-compatibility <technique> <technique> ...
  npx tsx src/cli.ts plan-budget <technique> <technique:transition> ... --region both
Paste each output, whole, into its section of PLAN.md, list every technique in the
Techniques table, and replace every FILL: line."""


def section_after(lines, start, pattern, stop=r"^# "):
    """Index of the first line after `start` matching `pattern`, before a line matching `stop`."""
    for i in range(start + 1, len(lines)):
        if re.match(stop, lines[i]):
            return None
        if re.match(pattern, lines[i]):
            return i
    return None


def table_names(lines):
    names, inside = set(), False
    for line in lines:
        if re.match(r"^## ", line):
            inside = line.strip().lower() == "## techniques"
            continue
        m = re.match(r"^\|\s*`?([a-z0-9_]+)`?\s*\|", line)
        if inside and m:
            names.add(m.group(1))
    return names


def parse(text):
    """(problems, compat names, pasted verdict)."""
    lines = text.splitlines()
    problems = []
    n = sum("FILL:" in line for line in lines)
    if n:
        problems.append(f"{n} FILL: placeholder(s) left")
    compat, verdict, budget = [], None, []
    ci = next((i for i, line in enumerate(lines) if line.startswith("# Compatibility:")), None)
    if ci is None:
        problems.append("no check-compatibility output (a line starting '# Compatibility:')")
    else:
        compat = [t.strip() for t in lines[ci].split(":", 1)[1].split("+") if t.strip()]
        vi = section_after(lines, ci, r"^\*\*Verdict:\*\*")
        if vi is None:
            problems.append("the check-compatibility output has no '**Verdict:**' line")
        else:
            verdict = lines[vi].strip()
    bi = next((i for i, line in enumerate(lines) if line.startswith("# Budget plan:")), None)
    if bi is None:
        problems.append("no plan-budget output (a line starting '# Budget plan:')")
    else:
        ti = section_after(lines, bi, r"^Techniques: ")
        pi = section_after(lines, bi, r"^## play \(", stop=r"^# (?!Budget)")
        if ti is None or pi is None or section_after(lines, pi, r"^Range ", stop=r"^#") is None:
            problems.append("the plan-budget output is not whole (no 'Techniques:', '## play (' or 'Range' line)")
        else:
            budget = [t.strip().split(":")[0] for t in lines[ti].split(":", 1)[1].split(",") if t.strip()]
    table = table_names(lines)
    for t in compat + budget:
        if t not in table:
            problems.append(f"technique '{t}' is in the pasted output but not in the Techniques table")
    if compat and budget and set(compat) != set(budget):
        problems.append("check-compatibility and plan-budget were run on different techniques")
    return problems, compat, verdict


def rerun_verdict(c64kb, names):
    """The Verdict line check-compatibility prints now, or None when it cannot run."""
    if not c64kb or not os.path.isfile(os.path.join(c64kb, "src", "cli.ts")):
        return None
    try:
        r = subprocess.run(["npx", "tsx", "src/cli.ts", "check-compatibility", *names],
                           cwd=c64kb, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(r"^\*\*Verdict:\*\*.*$", r.stdout, re.M)
    return m.group(0).strip() if (r.returncode == 0 and m) else None


def check(plan, c64kb=None, cache=None):
    if not os.path.isfile(plan):
        return [f"{plan} does not exist: copy it from the harness's PLAN.md.template"]
    text = open(plan).read()
    problems, compat, verdict = parse(text)
    if problems or not c64kb:
        return problems
    digest = hashlib.sha256(text.encode()).hexdigest()
    if cache and os.path.isfile(cache) and open(cache).read().strip() == digest:
        return []
    now = rerun_verdict(c64kb, compat)
    if now is None:
        print(f"plan-gate: could not re-run check-compatibility in {c64kb}; checked the plan's structure only")
        return []
    if now != verdict:
        return [f"the pasted verdict is '{verdict}', but check-compatibility now prints '{now}': re-run and paste"]
    if cache:
        os.makedirs(os.path.dirname(cache) or ".", exist_ok=True)
        with open(cache, "w") as f:
            f.write(digest + "\n")
    return []


def arg(name):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv[:-1] else None


def hook():
    root = os.path.realpath(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
    try:
        call = json.load(sys.stdin)
    except ValueError:
        return 0
    if call.get("tool_name") not in ("Edit", "MultiEdit", "Write", "NotebookEdit"):
        return 0
    params = call.get("tool_input") or {}
    path = params.get("file_path") or params.get("notebook_path") or ""
    if not path:
        return 0
    path = os.path.realpath(os.path.join(root, path))
    if not path.startswith(os.path.join(root, "src") + os.sep):
        return 0
    problems = check(os.path.join(root, "PLAN.md"))
    if not problems:
        return 0
    print("BLOCKED: writes under src/ wait until PLAN.md passes the plan gate.", file=sys.stderr)
    for p in problems:
        print(f"  {p}", file=sys.stderr)
    print(HOW_TO, file=sys.stderr)
    return 2


def main():
    if "--check" not in sys.argv:
        return hook()
    plan = arg("--check") or "PLAN.md"
    problems = check(plan, arg("--c64kb"), arg("--cache"))
    if not problems:
        return 0
    print("plan-gate: the plan does not pass, so nothing is built.")
    for p in problems:
        print(f"  {p}")
    print(HOW_TO)
    print("(Deliberate override: make PLAN_GATE=off, with the reason in PLAN.md.)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
