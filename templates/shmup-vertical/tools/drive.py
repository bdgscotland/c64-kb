#!/usr/bin/env python3
"""drive.py PRG STEP...: play the `make joy` build headless over VICE's binary monitor.

    python3 tools/drive.py build/shmup-vertical-joy.prg "until:PUSH FIRE" tap:fire \
        "until:SCORE" hold:fire "until:GAME OVER" "until:PUSH FIRE" print

Taken from templates/platformer/tools/drive.py; only the screens it reads
differ: this game's text is on the two playfield screens ($8000, $8400,
rows 0-20) and the panel ($8800, rows 21-23). The joy build reads its port
byte from $02FE (JOY_SOURCE) instead of $DC00, because the windowless
VICE's joyport commands never reach $DC00. Steps:
  hold:DIR     hold up, down, left, right or fire (DIR+DIR for two); hold:none releases
  tap:DIR      press for 0.05 s of run time, then release for 0.1 s
  run:SECONDS  let the machine run (warp) that long in real time
  until:TEXT   run until TEXT is on a playfield screen or the panel (300 s limit)
  print        print the panel's rows and the non-blank text rows of the screen on display
The machine is left with the monitor's quit command, so the drive's writes reach the .d64.
Set DRIVE_DISK to a .d64 to attach it as drive 8.
"""
import os
import socket
import struct
import subprocess
import sys
import time

X64SC = os.environ.get("X64SC", os.path.expanduser("~/Developer/c64/vice-headless/bin/x64sc"))
PORT = int(os.environ.get("DRIVE_PORT", "6581"))
SCREENS = (0x8000, 0x8400)                            # src/game.h PF0, PF1
PANEL = 0x8800
BITS = {"none": 0, "up": 1, "down": 2, "left": 4, "right": 8, "fire": 16}


def text(c):
    c &= 0x7f
    return chr(c + 64) if 1 <= c <= 26 else (chr(c) if 32 <= c < 64 else "~")


class Vice:
    def __init__(self, prg):
        disk = os.environ.get("DRIVE_DISK")
        self.proc = subprocess.Popen(
            [X64SC, "-default", "-warp", "+sound", "-autostartprgmode", "1", "-binarymonitor",
             "-binarymonitoraddress", f"ip4://127.0.0.1:{PORT}"]
            + (["-8", disk] if disk else []) + ["-autostart", prg],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                self.sock = socket.create_connection(("127.0.0.1", PORT))
                break
            except OSError:
                time.sleep(0.1)
        else:
            sys.exit("drive: no monitor")
        self.rid = 0

    def _read(self, n):
        b = b""
        while len(b) < n:
            b += self.sock.recv(n - len(b)) or sys.exit("drive: monitor closed")
        return b

    def cmd(self, code, body=b""):
        """One binary-monitor command (it stops the machine); returns the reply's body."""
        self.rid += 1
        self.sock.sendall(struct.pack("<BBIIB", 2, 2, len(body), self.rid, code) + body)
        while True:
            _, _, n, _, _, rid = struct.unpack("<BBIBBI", self._read(12))
            data = self._read(n)
            if rid == self.rid:
                return data

    def mem(self, start, n):
        return self.cmd(0x01, struct.pack("<BHHBH", 0, start, start + n - 1, 0, 0))[2:]

    def joy(self, bits):                                  # active low, as $DC00 reads
        self.cmd(0x02, struct.pack("<BHHBH", 0, 0x02fe, 0x02fe, 0, 0) + bytes([0xff & ~bits]))

    def run(self, seconds):
        self.cmd(0xaa)                                    # exit the monitor: the machine runs
        time.sleep(seconds)

    def rows(self):
        """Panel rows 21-23 and rows 0-20 of both playfield screens, as text."""
        out = []
        for base in SCREENS:
            d = self.mem(base, 21 * 40)
            out += ["".join(text(c) for c in d[r * 40:r * 40 + 40]) for r in range(21)]
        d = self.mem(PANEL + 21 * 40, 3 * 40)
        out += ["".join(text(c) for c in d[r * 40:r * 40 + 40]) for r in range(3)]
        return out

    def quit(self):
        try:
            self.cmd(0xbb)                                # quit: VICE flushes the disk image
            self.proc.wait(10)
        except Exception:
            self.proc.kill()


def main():
    vice = Vice(sys.argv[1])
    try:
        vice.joy(0)
        for step in sys.argv[2:]:
            name, _, arg = step.partition(":")
            if name in ("hold", "tap"):
                vice.joy(sum(BITS[d] for d in arg.split("+")))
                if name == "tap":
                    vice.run(0.05)
                    vice.joy(0)
                    vice.run(0.1)
            elif name == "run":
                vice.run(float(arg))
            elif name == "until":
                t0 = time.time()
                while not any(arg in row for row in vice.rows()):
                    if time.time() - t0 > 300:
                        sys.exit(f"drive: '{arg}' never appeared")
                    vice.run(0.1)
                print(f"drive: '{arg}' on screen")
            elif name == "print":
                rows = vice.rows()
                front = 1 if vice.mem(0x0881, 1)[0] == 0x1e else 0   # kernel.asm pf_d018
                for row in rows[front * 21:front * 21 + 21] + rows[42:]:
                    if row.strip("~ "):
                        print("|" + row + "|")
    finally:
        vice.quit()


if __name__ == "__main__":
    main()
