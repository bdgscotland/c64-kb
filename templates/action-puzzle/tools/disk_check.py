#!/usr/bin/env python3
"""disk_check.py HARNESS_DIR BUILD_DIR [pal|ntsc]: grade `make disktest`.

Reads from BUILD_DIR hiscore-1.seq and hiscore-2.seq (the file c1541 read
back after each save run) and disktest-dir.txt (the directory at the end),
and from shots/ the pictures disk-save.png, disk-save2.png and disk-load.png.

  save 1  no file yet: the default table plus ABE 158 in row 4, SAVED (00)
  save 2  the saved table loaded, ABE 158 again, a tie, so row 5: the file is
          replaced (scratch, then write), SAVED (00), one HISCORE entry
  load    the release PRG booted from the D64 shows the second table and
          "SCORES FROM DISK (00)", which it prints only when its start-up
          read of the file succeeded (hiscore.c, HI_LOADED)
"""
import os
import struct
import sys


def rows_of(path, fails):
    data = open(path, "rb").read()
    if len(data) != 38 or data[:3] != bytes([0x43, 0x52, 1]):
        fails.append(f"{path}: {len(data)} bytes, header {data[:3].hex()}, want 38 bytes, 435201")
        return []
    rows = []
    for r in range(5):
        name = "".join(chr(64 + c) for c in data[3 + 7 * r:6 + 7 * r])
        rows.append((name, struct.unpack("<I", data[6 + 7 * r:10 + 7 * r])[0]))
    print(f"disk_check: {os.path.basename(path)}: {rows}")
    return rows


def main():
    harness, build = sys.argv[1:3]
    model = sys.argv[3] if len(sys.argv) > 3 else "pal"
    sys.path.insert(0, harness)
    import check

    fails = []
    head = [("DIG", 400), ("ROX", 300), ("GEM", 200), ("ABE", 158)]
    if rows_of(os.path.join(build, "hiscore-1.seq"), fails) != head + [("MUD", 100)]:
        fails.append("save 1: the file is not the default table with ABE 158 in row 4")
    if rows_of(os.path.join(build, "hiscore-2.seq"), fails) != head + [("ABE", 158)]:
        fails.append("save 2: the file was not replaced by the table with ABE 158 in rows 4 and 5")
    listing = open(os.path.join(build, "disktest-dir.txt")).read()
    n = sum('"hiscore"' in line for line in listing.splitlines())
    print(f"disk_check: {n} HISCORE entry in the directory")
    if n != 1:
        fails.append(f"the directory holds {n} HISCORE entries, want 1")

    glyphs = check.load_glyphs()
    want = {
        "disk-save": [(None, 5), (23, 0, "RESULT 01 PASS"), (14, 13, "4. ABE 000158"),
                      (17, 9, "SAVED TO DISK     (00)")],
        "disk-save2": [(15, 13, "5. ABE 000158"), (17, 9, "SAVED TO DISK     (00)")],
        "disk-load": [(2, 15, "CAVE RUN"), (12, 13, "4. ABE 000158"), (13, 13, "5. ABE 000158"),
                      (16, 9, "SCORES FROM DISK  (00)")],
    }
    for pic, items in want.items():
        shot = check.Shot(os.path.join("shots", pic + ".png"), model)
        for item in items:
            if item[0] is None:
                ok = shot.index(*check.BORDER_SAMPLE) == item[1]
                print(f"{'PASS' if ok else 'FAIL'} {pic} border green")
            else:
                row, col, text = item
                got = check.read_text(shot, glyphs, row, col, len(text))
                ok = got == text
                print(f"{'PASS' if ok else 'FAIL'} {pic} row {row} col {col}: '{got}'")
            if not ok:
                fails.append(f"{pic}: {item}")
    print("disk_check: PASS" if not fails else f"disk_check: {len(fails)} FAILED: {fails}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
