#!/usr/bin/env python3
"""drive.py PRG STEP...: play the release build headless over VICE's binary monitor.

    python3 tools/drive.py build/adventure.prg "until:PRESS RETURN" key:RETURN \\
        "until:EXITS" "type:GO NORTH" "until:GARDEN" print

The keys go into the KERNAL keyboard queue (the monitor's keyboard feed),
the same bytes SCNKEY puts there for a real key, so the release build needs
no change. Steps:
  type:TEXT    type TEXT and RETURN, then let the machine run until the queue is empty
  key:RETURN   one RETURN (key:DEL for one DEL)
  fire         press and release fire on port 2 (the `make joy` build only)
  run:SECONDS  let the machine run (warp) that long in real time
  until:TEXT   run until TEXT is on screen (screen RAM read as text; 300 s limit)
  print        print the screen's non-blank rows
It reads screen RAM, not a picture: the windowless build's monitor
screenshots came back stale while a program ran (templates/action-puzzle).
"""
import os
import socket
import struct
import subprocess
import sys
import time

X64SC = os.environ.get("X64SC", os.path.expanduser("~/Developer/c64/vice-headless/bin/x64sc"))
PORT = int(os.environ.get("DRIVE_PORT", "6582"))
KEYS = {"RETURN": b"\r", "DEL": b"\x14"}


class Vice:
    def __init__(self, prg, disk):
        args = [X64SC, "-default", "-warp", "+sound", "-autostartprgmode", "1", "-binarymonitor",
                "-binarymonitoraddress", f"ip4://127.0.0.1:{PORT}"]
        if disk:
            args += ["-8", disk, "-drive8truedrive"]
        self.proc = subprocess.Popen(args + ["-autostart", prg],
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

    def mem(self, lo, hi):
        return self.cmd(0x01, struct.pack("<BHHBH", 0, lo, hi, 0, 0))[2:]

    def feed(self, petscii):                              # the keyboard feed: into $0277
        self.cmd(0x72, bytes([len(petscii)]) + petscii)

    def run(self, seconds):
        self.cmd(0xaa)                                    # exit the monitor: the machine runs
        time.sleep(seconds)

    def screen(self):
        d = self.mem(0x0400, 0x07e7)
        text = lambda c: chr(c + 64) if 1 <= c <= 26 else (chr(c) if 32 <= c < 64 else "~")
        return ["".join(text(c & 0x7f) for c in d[r * 40:r * 40 + 40]) for r in range(25)]


def main():
    disk = os.environ.get("DRIVE_D64")
    vice = Vice(sys.argv[1], disk)
    try:
        for step in sys.argv[2:]:
            name, _, arg = step.partition(":")
            if name == "type":
                for k in range(0, len(arg) + 1, 9):       # the queue holds ten
                    part = arg[k:k + 9].encode("ascii") + (b"\r" if k + 9 > len(arg) else b"")
                    vice.feed(part)
                    while vice.mem(0xc6, 0xc6)[0]:
                        vice.run(0.05)
            elif name == "key":
                vice.feed(KEYS[arg])
                vice.run(0.1)
            elif name == "fire":                          # make joy's build: $02FE, active low
                vice.cmd(0x02, struct.pack("<BHHBH", 0, 0x02fe, 0x02fe, 0, 0) + b"\xef")
                vice.run(0.1)
                vice.cmd(0x02, struct.pack("<BHHBH", 0, 0x02fe, 0x02fe, 0, 0) + b"\xff")
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
