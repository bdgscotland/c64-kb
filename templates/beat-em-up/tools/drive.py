#!/usr/bin/env python3
"""drive.py PRG STEP...: play the `make joy` build headless over VICE's binary monitor.

    python3 tools/drive.py build/beat-em-up-joy.prg "until:PRESS FIRE" tap:fire \
        "until:LIVES 3" "until:GAME OVER" "until:PRESS FIRE" tap:fire "until:LIVES 3" print

Taken from templates/platformer/tools/drive.py unchanged but for this
paragraph: this game's text is also on a HUD page at $C800, rows 21-24. The joy
build reads its port byte from $02FE (JOY_SOURCE) instead of $DC00, because
the windowless VICE's joyport commands never reach $DC00. Steps:
  hold:DIR     hold up, down, left, right or fire (DIR+DIR for two); hold:none releases
  tap:DIR      press for 0.05 s of run time, then release for 0.1 s
  run:SECONDS  let the machine run (warp) that long in real time
  until:TEXT   run until TEXT is on the HUD (300 s limit)
  print        print the HUD's non-blank rows
"""
import os
import socket
import struct
import subprocess
import sys
import time

X64SC = os.environ.get("X64SC", os.path.expanduser("~/Developer/c64/vice-headless/bin/x64sc"))
PORT = int(os.environ.get("DRIVE_PORT", "6581"))
HUD = 0xC800                                          # src/game.h HUDPAGE
BITS = {"none": 0, "up": 1, "down": 2, "left": 4, "right": 8, "fire": 16}


class Vice:
    def __init__(self, prg):
        self.proc = subprocess.Popen(
            [X64SC, "-default", "-warp", "+sound", "-autostartprgmode", "1", "-binarymonitor",
             "-binarymonitoraddress", f"ip4://127.0.0.1:{PORT}", "-autostart", prg],
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

    def joy(self, bits):                                  # active low, as $DC00 reads
        self.cmd(0x02, struct.pack("<BHHBH", 0, 0x02fe, 0x02fe, 0, 0) + bytes([0xff & ~bits]))

    def run(self, seconds):
        self.cmd(0xaa)                                    # exit the monitor: the machine runs
        time.sleep(seconds)

    def screen(self):
        d = self.cmd(0x01, struct.pack("<BHHBH", 0, HUD + 21 * 40, HUD + 1000 - 1, 0, 0))[2:]
        text = lambda c: chr(c + 64) if 1 <= c <= 26 else (chr(c) if 32 <= c < 64 else "~")
        return ["".join(text(c & 0x7f) for c in d[r * 40:r * 40 + 40]) for r in range(4)]


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
                while not any(arg in row for row in vice.screen()):
                    if time.time() - t0 > 300:
                        sys.exit(f"drive: '{arg}' never appeared")
                    vice.run(0.1)
                print(f"drive: '{arg}' on screen")
            elif name == "print":
                for row in vice.screen():
                    if row.strip():
                        print("|" + row + "|")
    finally:
        vice.proc.kill()


if __name__ == "__main__":
    main()
