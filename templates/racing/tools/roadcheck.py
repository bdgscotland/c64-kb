#!/usr/bin/env python3
"""roadcheck.py: prove every road line shows what its raster split says.

    python3 tools/roadcheck.py --x64sc X --asm build/asm.h [--expect pass|fail] PRG PAL.png NTSC.png

The AUTOPILOT build ends on a still (src/verdict.h, photo) that does not
change. For each model this script runs PRG under VICE's binary monitor until
the program has graded itself ($02FF not 0) and a second more, then reads the
machine: the road copy on display (engine.asm's road_a or road_b: each road
line's block holds the $D016 and $D021 bytes it stores), the screen and
colour RAM, the character set, the VIC-II's registers and the three sprites.
From those alone it draws lines 107-202 as the VIC-II would, multicolour
characters shifted right by each line's XSCROLL over each line's background
colour, a badline keeping the colour of the line above, sprites 0-2 in front
(a sprite whose Y register is y shows on lines y + 1 to y + 21), and compares
every pixel with the pinned exit screenshot of the same still (make shot).

A split that landed late, a line that kept the last line's XSCROLL, a pad
that got a sprite's stall wrong: each is a mismatch on the lines it touched.
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
SCREENS = (0xC000, 0xC400)
CHARSET = 0xE000


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

    def mem(self, addr, n):
        """n bytes from the CPU's view (I/O in: $D000 is the VIC-II, $D800 colour RAM)."""
        return self.cmd(0x01, struct.pack("<BHHBH", 0, addr, addr + n - 1, 0, 0))[2:]

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
        snap = {
            "front": front,
            "code": vice.mem(code, ROAD_LINES * 64),
            "screen": vice.mem(SCREENS[front], 1024),
            "colour": vice.mem(0xD800, 1000),
            "charset": vice.mem(CHARSET, 2048),
            "vic": vice.mem(0xD000, 0x2F),
        }
        ptrs = snap["screen"][0x3F8:0x3F8 + 3]
        snap["sprites"] = [vice.mem((0xC000 + p * 64), 63) for p in ptrs]
        snap["result"] = vice.mem(0x02FF, 1)[0]
        return snap
    finally:
        vice.close()


def draw(snap):
    """{line: [320 colour indices]} for lines 107-202, VIC X 24-343."""
    vic, code, scr, colram, cs = snap["vic"], snap["code"], snap["screen"], snap["colour"], snap["charset"]
    bg1, bg2 = vic[0x22] & 15, vic[0x23] & 15
    out = {}
    colour = 14                         # $D021 above the road: irq_blank's sky
    for i in range(ROAD_LINES):
        line = ROAD_TOP + i
        blk = code[i * 64:(i + 1) * 64]
        d016 = blk[1]
        if (line & 7) != 3:             # a normal line stores its colour; a badline keeps the last
            colour = blk[6]
        xs = d016 & 7
        row, g = (line - 51) >> 3, (line - 51) & 7
        pix = []
        for c in range(40):
            ch = scr[row * 40 + c]
            byte = cs[ch * 8 + g]
            cr = colram[row * 40 + c] & 15
            for p in range(4):
                pair = (byte >> (6 - 2 * p)) & 3
                v = (colour, bg1, bg2, cr & 7)[pair] if cr & 8 else None
                pix += [v, v]
        pix = [colour] * xs + pix[:320 - xs]
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
        for r in range(21):
            line = sy + 1 + r
            if line not in out:
                continue
            for b in range(3):
                byte = data[r * 3 + b]
                for p in range(4):
                    pair = (byte >> (6 - 2 * p)) & 3
                    if not pair:
                        continue
                    v = (None, mc0, col, mc1)[pair] if mc & (1 << s) else col
                    for k in range(2):
                        x = sx + b * 8 + p * 2 + k - 24
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
        xs = [snap["code"][i * 64 + 1] & 7 for i in range(ROAD_LINES)]
        steps = sum(1 for i in range(1, ROAD_LINES) if xs[i] != xs[i - 1] and (ROAD_TOP + i) & 7 != 3)
        if bad:
            failed += 1
            first = sorted(bad)[:4]
            print(f"FAIL {model.upper():5} {len(bad)} of {ROAD_LINES} road lines differ from their splits; "
                  f"first: " + "; ".join(f"line {ln} at X {bad[ln][0][0]} drawn {bad[ln][0][1]} shot {bad[ln][0][2]}"
                                          f" ({len(bad[ln])} px)" for ln in first))
        else:
            print(f"PASS {model.upper():5} all {ROAD_LINES} road lines match their $D016 and $D021 bytes, "
                  f"sprites 0-2 drawn over them ({steps} XSCROLL changes inside rows)")
    if args.expect == "pass":
        print(f"roadcheck: {'FAIL' if failed else 'PASS'}")
        return 1 if failed else 0
    print(f"roadcheck: {'PASS, the mutant was caught' if failed else 'FAIL, the mutant drew what its splits say'}")
    return 0 if failed else 1


if __name__ == "__main__":
    sys.exit(main())
