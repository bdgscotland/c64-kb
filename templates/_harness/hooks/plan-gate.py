#!/usr/bin/env python3
"""plan-gate: no source is written and nothing is built until PLAN.md holds
the c64-kb output the plan was made from.

  plan-gate.py --check PLAN.md [--c64kb DIR] [--cache FILE]
      make's gate: exit 0 when the plan passes (one line says so), 1 when it
      does not.
  plan-gate.py --seed PLAN.md --cache FILE
      marks a starter's shipped plan as passed without the re-run (c64-kb's
      new-project and verify-templates do this), so building a shipped
      example never depends on the live graph. Any edit to the plan, or a
      `make clean`, brings the re-run back.
  plan-gate.py
      Claude Code PreToolUse hook: reads the tool call as JSON on stdin; exit
      2 blocks an Edit, MultiEdit, Write or NotebookEdit under <project>/src/
      while the plan does not pass; exit 0 allows everything else.

The plan passes when:
  - PLAN.md exists and has no "FILL:" placeholder left;
  - it holds check-compatibility's output: a "# Compatibility: a + b" line,
    or the by-phase form "# Compatibility by phase: a + b" (a list with
    "name:phase") or "# Compatibility by phase: Title (`design`)" (--design),
    followed by a "**Verdict:** ..." line;
  - it holds plan-budget's output: a "# Budget plan: ..." line followed by a
    "Techniques: a, b" line and a "## play (" section with its "Range" line;
  - every technique those two outputs name is a row of the "## Techniques"
    table (first cell), and the two outputs name the same techniques. A
    count or a phase on a name ("char_bullets ×14", "x:transition") is read
    and dropped, in the outputs and in the table.
With --c64kb pointing at a c64-kb checkout, `make` also re-runs
check-compatibility and requires the same Verdict line: on the pasted names
for the flat form, on plan-budget's "Techniques:" list (with its phases and
counts) for a by-phase list, and with --design for a design. Before #107
the gate read only the flat form and plain names.
The pass is cached against PLAN.md's contents in --cache, with the
checkout's KB_DATA_VERSION and commit, which the pass line and a refusal
both print. When the checkout or its graph cannot be reached, it warns and
checks the structure only. A verdict can change with no change to the plan:
another session's ingest into a shared live graph, or a new KB version.
Seen 2026-09-23: a plan that passed at 20:03 was refused at 20:28 after
five commits landed in the checkout, and passed again a minute later.

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


def name_of(spec):
    """'char_bullets ×14' / '`x`:transition' -> the technique name."""
    m = re.match(r"`?([a-z0-9_]+)", spec.strip())
    return m.group(1) if m else spec.strip()


def table_names(lines):
    names, inside = set(), False
    for line in lines:
        if re.match(r"^## ", line):
            inside = line.strip().lower() == "## techniques"
            continue
        m = re.match(r"^\|\s*`?([a-z0-9_]+)`?(?:\s*\u00d7\s*\d+(?:-\d+)?|:[a-z]+)*\s*\|", line)
        if inside and m:
            names.add(m.group(1))
    return names


COMPAT_HEAD = re.compile(r"^# Compatibility( by phase)?:(.*)$")


def compat_head(lines):
    """(line index, by phase, names, design) of the check-compatibility output, or None."""
    for i, line in enumerate(lines):
        m = COMPAT_HEAD.match(line)
        if not m:
            continue
        title = m.group(2).strip()
        design = re.search(r"\(`([a-z0-9_]+)`\)$", title) if m.group(1) else None
        if design:
            return i, True, [], design.group(1)
        return i, bool(m.group(1)), [name_of(t) for t in title.split("+") if t.strip()], None
    return None


def parse(text):
    """(problems, compat names, pasted verdict, the arguments that re-run check-compatibility)."""
    lines = text.splitlines()
    problems = []
    n = sum("FILL:" in line for line in lines)
    if n:
        problems.append(f"{n} FILL: placeholder(s) left")
    compat, verdict, budget, specs, rerun = [], None, [], [], []
    head = compat_head(lines)
    if head is None:
        problems.append("no check-compatibility output (a line starting '# Compatibility:' "
                        "or '# Compatibility by phase:')")
    else:
        ci, by_phase, compat, design = head
        rerun = ["--design", design] if design else (None if by_phase else compat)
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
            specs = [t.strip() for t in lines[ti].split(":", 1)[1].split(",") if t.strip()]
            budget = [name_of(t) for t in specs]
    table = table_names(lines)
    for t in compat + budget:
        if t not in table:
            problems.append(f"technique '{t}' is in the pasted output but not in the Techniques table")
    if compat and budget and set(compat) != set(budget):
        problems.append("check-compatibility and plan-budget were run on different techniques")
    # A by-phase list is re-run on plan-budget's list, which keeps the phases and counts.
    return problems, compat, verdict, specs if rerun is None else rerun


def rerun_verdict(c64kb, args):
    """The Verdict line check-compatibility prints now, or None when it cannot run."""
    if not c64kb or not os.path.isfile(os.path.join(c64kb, "src", "cli.ts")):
        return None
    try:
        r = subprocess.run(["npx", "tsx", "src/cli.ts", "check-compatibility", *args],
                           cwd=c64kb, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(r"^\*\*Verdict:\*\*.*$", r.stdout, re.M)
    return m.group(0).strip() if (r.returncode == 0 and m) else None


def kb_version(c64kb):
    """'KB data 777, commit abc1234' for the checkout, as far as it can be read."""
    parts = []
    try:
        m = re.search(r"^KB_DATA_VERSION=(\S+)", open(os.path.join(c64kb, "VERSION")).read(), re.M)
        parts.append(f"KB data {m.group(1)}" if m else "no KB_DATA_VERSION")
    except OSError:
        parts.append("no VERSION file")
    try:
        r = subprocess.run(["git", "-C", c64kb, "rev-parse", "--short", "HEAD"],
                           capture_output=True, text=True, timeout=10)
        if r.returncode == 0:
            parts.append(f"commit {r.stdout.strip()}")
    except (OSError, subprocess.TimeoutExpired):
        pass
    return ", ".join(parts)


def read_cache(cache):
    try:
        return json.load(open(cache))
    except (OSError, ValueError):
        return {}


def write_cache(cache, digest, how, verdict):
    os.makedirs(os.path.dirname(cache) or ".", exist_ok=True)
    with open(cache, "w") as f:
        json.dump({"plan_sha256": digest, "checked": how, "verdict": verdict}, f)
        f.write("\n")


def short(verdict):
    """'**Verdict:** WARNINGS — ...' or '**Verdict:** WARNINGS, the worst ...' -> 'WARNINGS'."""
    m = re.match(r"[A-Z_]+", (verdict or "").replace("**Verdict:**", "").strip())
    return m.group(0) if m else ""


def check(plan, c64kb=None, cache=None):
    """(problems, the one line to print on a pass or a warning, or None)."""
    if not os.path.isfile(plan):
        return [f"{plan} does not exist: copy it from the harness's PLAN.md.template"], None
    text = open(plan).read()
    problems, _, verdict, rerun = parse(text)
    if problems or not c64kb:
        return problems, None
    digest = hashlib.sha256(text.encode()).hexdigest()
    seen = read_cache(cache) if cache else {}
    if seen.get("plan_sha256") == digest:
        return [], f"plan-gate: {plan} passes (unchanged; {seen.get('checked')}: {short(seen.get('verdict'))})"
    now = rerun_verdict(c64kb, rerun)
    if now is None:
        return [], (f"plan-gate: warning: could not re-run check-compatibility in {c64kb} "
                    "(no checkout, or its graph is down); checked the plan's structure only")
    kb = kb_version(c64kb)
    if now != verdict:
        return [f"the KB's answer changed: {plan} pastes '{verdict}', but check-compatibility on "
                f"{c64kb} ({kb}) now prints '{now}'. Re-run check-compatibility and plan-budget "
                "and re-paste both. A shared checkout whose graph another session is re-ingesting "
                "can flip a verdict with no change to the plan; run it again if the checkout is busy."], None
    how = f"check-compatibility re-run on {kb}"
    if cache:
        write_cache(cache, digest, how, now)
    return [], f"plan-gate: {plan} passes ({how}: {short(now)})"


def seed(plan, cache):
    """Mark a starter's shipped plan as passed, without the re-run."""
    text = open(plan).read()
    problems, _, verdict, _ = parse(text)
    if problems:
        return problems
    write_cache(cache, hashlib.sha256(text.encode()).hexdigest(),
                "the starter's shipped plan, check-compatibility not re-run", verdict)
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
    problems, _ = check(os.path.join(root, "PLAN.md"))
    if not problems:
        return 0
    print("BLOCKED: writes under src/ wait until PLAN.md passes the plan gate.", file=sys.stderr)
    for p in problems:
        print(f"  {p}", file=sys.stderr)
    print(HOW_TO, file=sys.stderr)
    return 2


def main():
    if "--seed" in sys.argv:
        problems = seed(arg("--seed") or "PLAN.md", arg("--cache") or "build/.plan-gate")
        for p in problems:
            print(f"plan-gate: not seeded: {p}")
        return 1 if problems else 0
    if "--check" not in sys.argv:
        return hook()
    plan = arg("--check") or "PLAN.md"
    problems, line = check(plan, arg("--c64kb"), arg("--cache"))
    if line:
        print(line)
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
