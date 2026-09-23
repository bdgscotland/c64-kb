#!/usr/bin/env python3
"""disk_check.py HARNESS_DIR BUILD_DIR [pal|ntsc]: grade `make disktest`.
disk_check.py --make-bad BUILD_DIR: write the three bad saves the test loads.

What each part must show comes from tools/gen.py's model, not from here:

  the file    build/savegame.seq, read back by c1541 after the DISKTEST=1 run,
              equals the record the model makes at the script's SAVE, byte for
              byte; the directory holds one SAVEGAME
  disk-save   DISKTEST=1: its own verdict (green), the window ends with
              GAME SAVED (00), the status bar is the saved room, score, turns
  disk-load   DISKTEST=2, after a cold start on the same disk: it typed LOAD
              first, so its green verdict and the ending on screen need the
              saved state back
  disk-boot   the release PRG booted from the D64 with LOAD"*",8,1, then
              RETURN, LOAD, SCORE and I typed into the keyboard queue: every
              window line and the status bar as the model prints them
  bad-fold    the release PRG LOADs the good save with one byte changed:
              refused as damaged, the game still at the start
  bad-room    a save with a valid fold that names room 200: refused as damaged
              (save.c's range check; without it the fold would let it in)
  bad-world   a save with a valid fold made by another world (its version
              bytes differ): refused as from another version
  no-disk     the release PRG types SAVE to a drive with no disk: the drive's
              own words, "DISK ERROR: 74,DRIVE NOT READY."
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gen  # noqa: E402

BOOT_KEYS = ["LOAD", "SCORE", "I"]      # the Makefile's -keybuf, after the title's RETURN


def window(lines):
    """The window's 14 rows at the end, as check.read_text reads them."""
    rows = [gen.row_text(r) for r in lines[-14:]]
    return [" " * 40] * (14 - len(rows)) + rows


def status(g):
    name = gen.MSGS[gen.ROOM_NAME[gen.ROOM_KEYS[g.room - 1]]] if g.lit() else gen.W.MESSAGES["DARKNAME"]
    return (" " + name).ljust(20) + "SCORE" + str(g.score).rjust(4) + "  TURNS" + str(g.turns).rjust(4)


def refold(rec):
    return rec[:-1] + bytes([gen.fold8(rec[:-1])])


def make_bad(build):
    good = open(os.path.join(build, "savegame.seq"), "rb").read()
    bad_fold = bytearray(good)
    bad_fold[10] ^= 0x01                        # one item's place, the fold left as it was
    bad_room = bytearray(good)
    bad_room[4] = 200                           # a room this world does not have
    bad_world = bytearray(good)
    bad_world[2] ^= 0xFF                        # another world's version
    for name, rec in (("bad-fold", bytes(bad_fold)), ("bad-room", refold(bytes(bad_room))),
                      ("bad-world", refold(bytes(bad_world)))):
        open(os.path.join(build, name + ".seq"), "wb").write(rec)
        print(f"disk_check: {name}.seq {rec.hex()}")


def main():
    if sys.argv[1] == "--make-bad":
        make_bad(sys.argv[2])
        return
    harness, build = sys.argv[1:3]
    model = sys.argv[3] if len(sys.argv) > 3 else "pal"
    sys.path.insert(0, harness)
    import check

    fails = []
    split = gen.W.SCRIPT.index("SAVE")
    part1 = gen.play(gen.W.SCRIPT[:split + 1], stop_after="SAVE")
    part2 = gen.play(gen.W.SCRIPT[gen.W.SCRIPT.index("LOAD"):], disk_saved=part1[4])
    boot = gen.play(BOOT_KEYS, disk_saved=part1[4])
    start = gen.play([])[0]                     # a new game: where a refused LOAD leaves it

    got = open(os.path.join(build, "savegame.seq"), "rb").read()
    print(f"disk_check: SAVEGAME {len(got)} bytes, the model's record {len(part1[4])}")
    if got != part1[4]:
        fails.append(f"SAVEGAME is {got.hex()}, the model says {part1[4].hex()}")
    listing = open(os.path.join(build, "disktest-dir.txt")).read()
    n = sum('"savegame"' in line for line in listing.splitlines())
    print(f"disk_check: {n} SAVEGAME entry in the directory")
    if n != 1:
        fails.append(f"the directory holds {n} SAVEGAME entries, want 1")

    glyphs = check.load_glyphs()
    damaged = gen.W.MESSAGES["BADSAVE"] + "(00)."
    want = {
        "disk-save": (True, [(7, status(part1[0]))] + rows_at(window(part1[1])[-1:])),
        "disk-load": (True, [(7, status(part2[0]))] + rows_at(window(part2[1])[-4:])),
        "disk-boot": (False, [(7, status(boot[0]))] + rows_at(window(boot[1]))),
        "bad-fold": (False, [(7, status(start)), (20, ">LOAD"), (21, damaged)]),
        "bad-room": (False, [(7, status(start)), (20, ">LOAD"), (21, damaged)]),
        "bad-world": (False, [(7, status(start)), (20, ">LOAD"),
                              (21, gen.W.MESSAGES["OLDSAVE"] + "(00).")]),
        "no-disk": (False, [(20, ">SAVE"), (21, "DISK ERROR: 74,DRIVE NOT READY.")]),
    }
    for pic, (graded, items) in want.items():
        shot = check.Shot(os.path.join("shots", pic + ".png"), model)
        if graded:
            ok = shot.index(*check.BORDER_SAMPLE) == 5
            print(f"{'PASS' if ok else 'FAIL'} {pic} border green (its own verdict)")
            if not ok:
                fails.append(f"{pic}: border not green")
        for row, text in items:
            text = text.rstrip() or " "
            read = check.read_text(shot, glyphs, row, 0, len(text))
            ok = read == text
            print(f"{'PASS' if ok else 'FAIL'} {pic} row {row:2}: '{read}'")
            if not ok:
                fails.append(f"{pic} row {row}: '{read}', want '{text}'")
    print("disk_check: PASS" if not fails else f"disk_check: {len(fails)} FAILED: {fails}")
    sys.exit(1 if fails else 0)


def rows_at(rows):
    """Window rows ending at row 21."""
    return [(22 - len(rows) + k, r) for k, r in enumerate(rows)]


if __name__ == "__main__":
    main()
