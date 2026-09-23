#!/usr/bin/env python3
"""verdict_codes.py HARNESS_DIR PNG MODEL LETTERS: the verdict's failure letters.

The AUTOPILOT verdict prints one letter per failed test on row 23 from
column 27 (main.c, verdict). Exit 0 when every letter in LETTERS is there.
`make selftest-scan` uses it to see that the SCAN_FLAG=0 build fails on E,
the test that the scan meets the living player exactly once a cave frame.
"""
import sys


def main():
    harness, png, model, want = sys.argv[1:5]
    sys.path.insert(0, harness)
    import check
    got = check.read_text(check.Shot(png, model), check.load_glyphs(), 23, 27, 12).strip()
    missing = [c for c in want if c not in got]
    print(f"verdict_codes: {model.upper()} failure letters '{got}'" +
          (f", missing {''.join(missing)}" if missing else ""))
    sys.exit(1 if missing else 0)


if __name__ == "__main__":
    main()
