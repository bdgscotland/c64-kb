#!/usr/bin/env python3
"""disk_check.py HARNESS_DIR hiscore.seq save.png load.png [pal|ntsc]: grade `make disktest`.

  hiscore.seq  the file c1541 read back from the D64 after the save run
  save.png     the autopilot build's exit screenshot, true-drive 1541
  load.png     a cold VICE that booted the release PRG from the same D64

The file must hold the 38-byte table with ABE 158 in row 4; the save
picture must show the verdict and "SAVED TO DISK (00)"; the load picture
must show the title screen with that row and "SCORES FROM DISK (00)",
which the program prints only when its start-up read of the file
succeeded (hiscore.c, HI_LOADED).
"""
import os
import struct
import sys


def main():
    harness, seq, save_png, load_png = sys.argv[1:5]
    model = sys.argv[5] if len(sys.argv) > 5 else "pal"
    sys.path.insert(0, harness)
    import check

    fails = []
    data = open(seq, "rb").read()
    rows = []
    if len(data) != 38:
        fails.append(f"hiscore file is {len(data)} bytes, want 38")
    else:
        for r in range(5):
            name = data[3 + 7 * r:6 + 7 * r]
            score = struct.unpack("<I", data[6 + 7 * r:10 + 7 * r])[0]
            rows.append(("".join(chr(64 + c) for c in name), score))
        print(f"disk_check: file version {data[2]}, rows {rows}")
        if data[2] != 1 or rows[3] != ("ABE", 158) or rows[4] != ("MUD", 100):
            fails.append("the file's rows are not the table the autopilot saved")

    glyphs = check.load_glyphs()
    want = {
        save_png: [(None, "verdict"), (23, 0, "RESULT 01 PASS"), (14, 13, "4. ABE 000158"),
                   (17, 9, "SAVED TO DISK     (00)")],
        load_png: [(2, 15, "CAVE RUN"), (12, 13, "4. ABE 000158"), (13, 13, "5. MUD 000100"),
                   (16, 9, "SCORES FROM DISK  (00)")],
    }
    for png, items in want.items():
        shot = check.Shot(png, model)
        for item in items:
            if item[0] is None:
                ok = shot.index(*check.BORDER_SAMPLE) == 5
                print(f"{'PASS' if ok else 'FAIL'} {os.path.basename(png)} border green")
            else:
                row, col, text = item
                got = check.read_text(shot, glyphs, row, col, len(text))
                ok = got == text
                print(f"{'PASS' if ok else 'FAIL'} {os.path.basename(png)} row {row} col {col}: '{got}'")
            if not ok:
                fails.append(f"{png}: {item}")
    print("disk_check: PASS" if not fails else f"disk_check: {len(fails)} FAILED")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
