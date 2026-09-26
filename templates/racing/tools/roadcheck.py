#!/usr/bin/env python3
"""roadcheck.py: prove every road line shows what the machine's own state says.

    python3 tools/roadcheck.py --x64sc X --asm build/asm.h [--expect pass|fail] PRG PAL.png NTSC.png

The AUTOPILOT build ends on a still (src/verdict.h, photo) that does not
change. For each model this script runs PRG under VICE's binary monitor until
the program has graded itself ($02FF not 0) and a second more, then reads the
machine: the road copy on display (engine.asm: each line's $D016 from the
copy's d016 table, each row's $D018 from the L block above it or the copy's
entry block, each line's colours from the copy's z table plus the camera's
position through the colour tables, as the road's blocks look them up), the
screen and colour RAM, the character sets under I/O and the KERNAL (bank 3),
the VIC-II's registers and the three sprites. From those alone it draws lines
107-202 as the VIC-II would: multicolour characters from the row's set,
shifted right by the line's XSCROLL, over the line's grass, road band and
kerb colours (a register keeps its value until a block stores it: the
badline and the row's second line keep the bands above them), sprites 0-2
in front (a sprite whose Y register is y shows on lines y + 1 to y + 21),
and compares every pixel with the pinned exit screenshot of the same still
(make shot).

A split that landed late, a line that kept the last line's XSCROLL, a pad
that got a sprite's stall wrong, a sheared row whose dynamic glyph was built
from the wrong source: each is a mismatch on the lines it touched.
--expect fail (make mutants, MUTANT=1: the pads ignore the sprites) passes
only when the drawing and the shot disagree.

Geometry and palette: the harness's check.py (c64-kb vice-reference):
screenshot x = VIC X + 8, row = line - 16 (PAL) or - 28 (NTSC).
"""
import argparse
import os
import re
import socket
import struct
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "harness"))
sys.path.insert(0, os.path.join(HERE, "..", "..", "_harness"))
import check  # noqa: E402  (the harness's palettes and geometry)

ROAD_TOP, ROAD_LINES = 107, 96
BANK = 0xC000
SCREENS = (0xC000, 0xC400)
BPOS = 0xFF                             # engine.asm bpos: the camera's position, even
C_SKY = 14


class Vice:
    """VICE with its binary monitor on PORT (as tools/drive.py)."""

    def __init__(self, x64sc, prg, model, port):
        cmd = [x64sc, "-default", "-warp", "+sound", "-autostartprgmode", "1", "-binarymonitor",
               "-binarymonitoraddress", f"ip4://127.0.0.1:{port}"]
        if model == "ntsc":
            cmd += ["-model", "ntsc"]
        self.proc = subprocess.Popen(cmd + ["-autostart", prg],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                self.sock = socket.create_connection(("127.0.0.1", port))
                break
            except OSError:
                time.sleep(0.1)
        else:
            sys.exit("roadcheck: no monitor")
        self.rid = 0

    def _read(self, n):
        b = b""
        while len(b) < n:
            chunk = self.sock.recv(n - len(b))
            if not chunk:
                sys.exit("roadcheck: monitor closed")
            b += chunk
        return b

    def cmd(self, code, body=b""):
        self.rid += 1
        self.sock.sendall(struct.pack("<BBIIB", 2, 2, len(body), self.rid, code) + body)
        while True:
            _, _, n, _, _, rid = struct.unpack("<BBIBBI", self._read(12))
            data = self._read(n)
            if rid == self.rid:
                return data

    def mem(self, addr, n, bank=0):
        """n bytes: bank 0 the CPU's view (I/O in), bank 1 the RAM under everything."""
        return self.cmd(0x01, struct.pack("<BHHBH", 0, addr, addr + n - 1, 0, bank))[2:]

    def run(self, seconds):
        self.cmd(0xAA)
        time.sleep(seconds)

    def close(self):
        self.proc.kill()


def labels(asm_h):
    return {m.group(1): int(m.group(2), 16)
            for m in re.finditer(r"#define ASM_(\w+) (0x[0-9a-f]+)", open(asm_h).read())}


def snapshot(args, model):
    """Run to the still; read what the drawing needs."""
    lab = labels(args.asm)
    port = args.port + (1 if model == "ntsc" else 0)
    vice = Vice(args.x64sc, args.prg, model, port)
    try:
        t0 = time.time()
        while vice.mem(0x02FF, 1)[0] == 0:
            if time.time() - t0 > 240:
                sys.exit(f"roadcheck: {model}: no verdict after 240 s")
            vice.run(0.5)
        vice.run(1.0)                   # the still is up (photo, after the grade)
        front = vice.mem(lab["RB_FRONT"], 1)[0]
        code = lab["ROAD_B"] if front else lab["ROAD_A"]
        off_ly = lab["RC_OFF_LY"]
        # each row's $D018: row 0's from the copy's entry block, the rest
        # from the L block of the row above (its LDY # operand)
        pre = lab["PRE_B"] if front else lab["PRE_A"]
        d018 = [vice.mem(pre + lab["RC_PRE_LY"], 1)[0]]
        for r in range(1, 12):
            d018.append(vice.mem(code + (8 * r - 1) * 64 + off_ly, 1)[0])
        snap = {
            "front": front,
            "d016": vice.mem(lab["D016_A"] + front * ROAD_LINES, ROAD_LINES),
            "zlc": vice.mem(lab["ZLC_A"] + front * (ROAD_LINES + 2), ROAD_LINES + 2),
            "bpos": vice.mem(BPOS, 1)[0],
            "grass_col": vice.mem(lab["GRASS_COL"], 256),
            "road_col": vice.mem(lab["ROAD_COL"], 256),
            "kerb_col": vice.mem(lab["KERB_COL"], 256),
            "d018": d018,
            "screen": vice.mem(SCREENS[front], 1024),
            "colour": vice.mem(0xD800, 1000),
            "vic": vice.mem(0xD000, 0x2F),
            "sets": {},
        }
        for v in set(d018):
            base = BANK + ((v & 0x0E) << 10)
            snap["sets"][v] = vice.mem(base, 2048, bank=1)
        ptrs = snap["screen"][0x3F8:0x3F8 + 3]
        snap["sprites"] = [vice.mem(BANK + p * 64, 63) for p in ptrs]
        snap["result"] = vice.mem(0x02FF, 1)[0]
        return snap
    finally:
        vice.close()


def colours(snap):
    """Per road line, ($D021, $D022, $D023) as the kernel leaves them, following
    each block kind's stores (engine.asm, block layout)."""
    zl, bpos = snap["zlc"], snap["bpos"]
    g, r, k = snap["grass_col"], snap["road_col"], snap["kerb_col"]

    def v(i):
        return (zl[i] + bpos) & 0xFF
    # irq_blank at line 251: sky, and lines 109's and 110's own bands
    bg, road, kerb = C_SKY, r[v(2)], k[v(3)]
    out = []
    for j in range(ROAD_LINES):
        kind = j & 7
        if kind == 0:                   # B: $D016 and $D018 only
            pass
        elif kind == 1:                 # F: its own grass
            bg = g[v(j)]
        else:                           # N, L: grass, and the road band (even) or kerb (odd)
            bg = g[v(j)]
            if j & 1:
                kerb = k[v(j)]
            else:
                road = r[v(j)]
        out.append((bg, road, kerb))
    return out


def draw(snap):
    """{line: [320 colour indices]} for lines 107-202, VIC X 24-343."""
    vic, scr, colram = snap["vic"], snap["screen"], snap["colour"]
    cols = colours(snap)
    out = {}
    for i in range(ROAD_LINES):
        line = ROAD_TOP + i
        bg, bg1, bg2 = cols[i]
        xs = snap["d016"][i] & 7
        row, gl = (line - 51) >> 3, (line - 51) & 7
        cs = snap["sets"][snap["d018"][row - 7]]
        pix = []
        for c in range(40):
            ch = scr[row * 40 + c]
            byte = cs[ch * 8 + gl]
            cr = colram[row * 40 + c] & 15
            for p in range(4):
                pair = (byte >> (6 - 2 * p)) & 3
                v = (bg, bg1, bg2, cr & 7)[pair] if cr & 8 else None
                pix += [v, v]
        pix = [bg] * xs + pix[:320 - xs]
        out[line] = pix
    # sprites 0-2, sprite 0 in front
    en, msb, mc = vic[0x15], vic[0x10], vic[0x1C]
    mc0, mc1 = vic[0x25] & 15, vic[0x26] & 15
    for s in (2, 1, 0):
        if not en & (1 << s):
            continue
        sx = vic[s * 2] | ((msb >> s) & 1) << 8
        sy = vic[s * 2 + 1]
        col = vic[0x27 + s] & 15
        data = snap["sprites"][s]
        for rr in range(21):
            line = sy + 1 + rr
            if line not in out:
                continue
            for b in range(3):
                byte = data[rr * 3 + b]
                for p in range(4):
                    pair = (byte >> (6 - 2 * p)) & 3
                    if not pair:
                        continue
                    v = (None, mc0, col, mc1)[pair] if mc & (1 << s) else col
                    for kk in range(2):
                        x = sx + b * 8 + p * 2 + kk - 24
                        if 0 <= x < 320:
                            out[line][x] = v
    return out


def compare(shot, drawn):
    bad = {}
    for line, pix in drawn.items():
        y = line - shot.g["line_offset"]
        for x in range(320):
            got = shot.index(x + 32, y)
            if got != pix[x]:
                bad.setdefault(line, []).append((x + 24, pix[x], got))
    return bad


def edge_steps(drawn):
    """The largest move of the left road edge between neighbouring lines, in
    pixels, over lines whose edge is inside the window (the acceptance's
    'no visible stair-steps')."""
    xs = {}
    for line, pix in drawn.items():
        bg = pix[0]
        for x in range(1, 320):
            if pix[x] != bg and pix[x] is not None:
                xs[line] = x
                break
    worst = 0
    for line in sorted(xs):
        if line - 1 in xs:
            worst = max(worst, abs(xs[line] - xs[line - 1]))
    return worst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--x64sc", required=True)
    ap.add_argument("--asm", required=True, help="build/asm.h of the same build")
    ap.add_argument("--expect", choices=("pass", "fail"), default="pass")
    ap.add_argument("--port", type=int, default=int(os.environ.get("ROADCHECK_PORT", "6620")))
    ap.add_argument("--models", default="pal,ntsc", help="pal, ntsc or both (default)")
    ap.add_argument("prg")
    ap.add_argument("pal")
    ap.add_argument("ntsc", nargs="?")
    args = ap.parse_args()

    failed = 0
    shots = {"pal": args.pal, "ntsc": args.ntsc}
    for model in args.models.split(","):
        png = shots[model]
        snap = snapshot(args, model)
        drawn = draw(snap)
        bad = compare(check.Shot(png, model), drawn)
        xs = [snap["d016"][i] & 7 for i in range(ROAD_LINES)]
        steps = sum(1 for i in range(1, ROAD_LINES) if xs[i] != xs[i - 1])
        sets = len(set(snap["d018"]))
        if bad:
            failed += 1
            first = sorted(bad)[:4]
            print(f"FAIL {model.upper():5} {len(bad)} of {ROAD_LINES} road lines differ from the machine's state; "
                  f"first: " + "; ".join(f"line {ln} at X {bad[ln][0][0]} drawn {bad[ln][0][1]} shot {bad[ln][0][2]}"
                                          f" ({len(bad[ln])} px)" for ln in first))
        else:
            print(f"PASS {model.upper():5} all {ROAD_LINES} road lines match their $D016, $D018 and band bytes, "
                  f"sprites 0-2 drawn over them ({steps} XSCROLL changes, {sets} character sets, "
                  f"largest left-edge step {edge_steps(drawn)} px)")
    if args.expect == "pass":
        print(f"roadcheck: {'FAIL' if failed else 'PASS'}")
        return 1 if failed else 0
    print(f"roadcheck: {'PASS, the mutant was caught' if failed else 'FAIL, the mutant drew what its state says'}")
    return 0 if failed else 1


if __name__ == "__main__":
    sys.exit(main())
