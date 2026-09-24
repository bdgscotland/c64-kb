#!/usr/bin/env python3
"""drive.py PRG STEP...: play a program headless over VICE's binary monitor,
with the joystick pressed on the real $DC00.

    python3 harness/drive.py build/game.prg "until:PRESS FIRE" tap:fire \\
        "until:LIVES 3" hold:right "until:GAME OVER" print

Control port 2 is VICE's "Joyport I/O simulation" device
(-controlport2device 37), whose lines the monitor's joyport command (0xa2)
sets. The default device, a joystick, ignores that command, which is why an
earlier version of this harness said the windowless VICE's joyport commands
never reach $DC00 and had each game read its port byte from RAM (JOY_SOURCE).

Time is counted in frames of the emulated machine, not in wall-clock
seconds: every wait stops the machine at raster line 0 through a checkpoint,
so the same steps give the same run every time (a fire press at the same
cycle, the same screen at the end). The run starts when the script is
connected: it releases the port, power-cycles the machine and autostarts the
program through the monitor. Started from the command line instead, the
machine had run for as long as the connection took, and the title came 180,
185 or 190 frames in (six runs of the platformer starter); started this way,
190 in six of six. -initbreak does not help: with no client connected yet it
opens the text monitor, which reads end of input and lets the machine run.

Steps:
  hold:DIR     hold up, down, left, right or fire (DIR+DIR for two); hold:none releases
  tap:DIR      press for 3 frames, then release for 6
  wait:FRAMES  let the machine run that many frames
  run:SECONDS  the same, in seconds of emulated time (50 frames PAL, 60 NTSC)
  until:TEXT   run until TEXT is in the screen text, checked every 5 frames
               (DRIVE_LIMIT frames, default 18,000); exit 1 when it never comes
  type:TEXT    TEXT and RETURN into the KERNAL keyboard queue, then run until it is empty
  key:NAME     one RETURN or DEL into the keyboard queue, then 5 frames
  peek:ADDR    print the byte at hex ADDR (ADDR,ADDR for several)
  print        print the screen text's non-blank rows
The screen text is screen RAM read as screen codes, never a picture: the
windowless build's monitor screenshots came back stale while a game ran.

Environment:
  DRIVE_SCREEN  where the text is: BASE[:FIRST-LAST] regions in hex, comma
                separated (default 0400:0-24). "8000:0-20,8400:0-20,8800:21-23"
                reads rows 0-20 of two playfield screens and rows 21-23 of a panel.
  DRIVE_MODEL   pal (default) or ntsc
  DRIVE_DISK    a .d64 to attach as drive 8; VICE writes the program's saves into it
  DRIVE_PORT    the monitor port (default: a free one, so two drives do not collide)
  DRIVE_LIMIT   the frame limit of an until: step
  DRIVE_SOUND   off (default, +sound), dump or wav: the SID sink, as harness.mk's
                SOUND_SINK ($D41B and $D41C read right only with dump or wav)
  X64SC         the emulator (default: the windowless build)
It is also a module: Vice(prg).joy(bits), .frames(n), .mem(addr, n), .rows(),
.quit(); tools/joytest.py in the shmup-vertical starter uses it that way.
"""
import os
import socket
import struct
import subprocess
import sys

X64SC = os.environ.get("X64SC", os.path.expanduser("~/Developer/c64/vice-headless/bin/x64sc"))
BITS = {"none": 0, "up": 1, "down": 2, "left": 4, "right": 8, "fire": 16}
KEYS = {"RETURN": b"\r", "DEL": b"\x14"}
JOYPORT_2 = 1                    # VICE's index for control port 2 (JOYPORT_1 is 0)
IO_SIMULATION = "37"             # -controlport2device: Joyport I/O simulation
STOPPED = 0x62                   # the monitor's "machine stopped" event


class Fail(Exception):
    pass


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def parse_screen(spec):
    """'0400:0-24,8800:21-23' -> [(0x0400, 0, 24), (0x8800, 21, 23)]."""
    out = []
    for part in spec.split(","):
        base, _, rows = part.strip().partition(":")
        first, _, last = (rows or "0-24").partition("-")
        out.append((int(base, 16), int(first), int(last or first)))
    return out


def text(c):
    c &= 0x7f
    return chr(c + 64) if 1 <= c <= 26 else (chr(c) if 32 <= c < 64 else "~")


class Vice:
    def __init__(self, prg, disk=None, model=None, screen=None):
        disk = disk or os.environ.get("DRIVE_DISK")
        self.model = model or os.environ.get("DRIVE_MODEL", "pal")
        self.screen = parse_screen(screen or os.environ.get("DRIVE_SCREEN", "0400:0-24"))
        port = int(os.environ.get("DRIVE_PORT") or free_port())
        sink = os.environ.get("DRIVE_SOUND", "off")
        sound = ["+sound"] if sink == "off" else ["-sound", "-sounddev", sink, "-soundarg", os.devnull]
        args = [X64SC, "-default", "-warp", *sound, "+autostart-delay-random", "-autostartprgmode", "1",
                "-controlport2device", IO_SIMULATION,
                "-binarymonitor", "-binarymonitoraddress", f"ip4://127.0.0.1:{port}"]
        args += ["-model", "ntsc"] if self.model == "ntsc" else []
        args += ["-8", disk] if disk else []
        self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.sock = self._connect(port)
        self.rid = 0
        self.joy(0)                                       # the device starts with every line low
        self.cmd(0xcc, b"\x01")                           # power cycle
        name = os.path.abspath(prg).encode()
        self.cmd(0xdd, struct.pack("<BHB", 1, 0, len(name)) + name)
        self.line0, self.mid = self._checkpoint("RL == $00"), self._checkpoint("RL == $80")

    def _connect(self, port):
        import time
        for _ in range(200):
            try:
                s = socket.create_connection(("127.0.0.1", port))
                s.settimeout(120)
                return s
            except OSError:
                time.sleep(0.05)
        self.proc.kill()
        raise Fail("no binary monitor: is X64SC a VICE 3.5 or later?")

    def _read(self, n):
        b = b""
        while len(b) < n:
            chunk = self.sock.recv(n - len(b))
            if not chunk:
                raise Fail("the monitor closed (VICE exited)")
            b += chunk
        return b

    def _reply(self):
        _, _, n, kind, err, rid = struct.unpack("<BBIBBI", self._read(12))
        return kind, err, rid, self._read(n)

    def cmd(self, code, body=b""):
        """One binary-monitor command (the machine is stopped); returns the reply's body."""
        self.rid += 1
        self.sock.sendall(struct.pack("<BBIIB", 2, 2, len(body), self.rid, code) + body)
        while True:
            _, err, rid, data = self._reply()
            if rid == self.rid:
                if err:
                    raise Fail(f"monitor command 0x{code:02x} failed with error 0x{err:02x}")
                return data

    def _checkpoint(self, condition):
        """A disabled exec checkpoint over all memory that stops when `condition` holds."""
        n = struct.unpack_from("<I", self.cmd(0x12, struct.pack("<HHBBBB", 0, 0xffff, 1, 0, 4, 0)))[0]
        cond = condition.encode()
        self.cmd(0x22, struct.pack("<IB", n, len(cond)) + cond)
        return n

    def _run_to(self, on, off):
        self.cmd(0x15, struct.pack("<IB", off, 0))
        self.cmd(0x15, struct.pack("<IB", on, 1))
        self.cmd(0xaa)                                    # exit the monitor: the machine runs
        while self._reply()[0] != STOPPED:
            pass

    def frames(self, n):
        """Run to the start of raster line 0, n times: n frames."""
        for _ in range(n):
            self._run_to(self.mid, self.line0)
            self._run_to(self.line0, self.mid)

    def run(self, seconds):
        self.frames(round(seconds * (60 if self.model == "ntsc" else 50)))

    def joy(self, bits):
        """Port 2 lines, active low as $DC00 reads them: bits 0-4 up, down, left, right, fire."""
        self.cmd(0xa2, struct.pack("<HH", JOYPORT_2, 0xff & ~bits))

    def feed(self, petscii):                              # the keyboard feed: into $0277
        self.cmd(0x72, bytes([len(petscii)]) + petscii)

    def mem(self, start, n):
        return self.cmd(0x01, struct.pack("<BHHBH", 0, start, start + n - 1, 0, 0))[2:]

    def rows(self):
        out = []
        for base, first, last in self.screen:
            d = self.mem(base + 40 * first, 40 * (last - first + 1))
            out += ["".join(text(c) for c in d[r * 40:r * 40 + 40]) for r in range(last - first + 1)]
        return out

    def until(self, want, limit=None):
        limit = limit or int(os.environ.get("DRIVE_LIMIT", "18000"))
        for waited in range(0, limit + 1, 5):
            if any(want in row for row in self.rows()):
                return waited
            self.frames(5)
        raise Fail(f"'{want}' never appeared in {limit} frames")

    def quit(self):
        try:
            self.cmd(0xbb)                                # quit: VICE flushes the disk image
            self.proc.wait(10)
        except Exception:
            self.proc.kill()


def step(vice, name, arg):
    if name in ("hold", "tap"):
        vice.joy(sum(BITS[d] for d in arg.split("+")))
        if name == "tap":
            vice.frames(3)
            vice.joy(0)
            vice.frames(6)
    elif name == "wait":
        vice.frames(int(arg))
    elif name == "run":
        vice.run(float(arg))
    elif name == "until":
        print(f"drive: '{arg}' on screen after {vice.until(arg)} frames")
    elif name == "type":
        for k in range(0, len(arg) + 1, 9):               # the queue holds ten
            vice.feed(arg[k:k + 9].encode("ascii") + (b"\r" if k + 9 > len(arg) else b""))
            while vice.mem(0xc6, 1)[0]:
                vice.frames(3)
    elif name == "key":
        vice.feed(KEYS[arg])
        vice.frames(5)
    elif name == "peek":
        for a in arg.split(","):
            print(f"peek {a}: {vice.mem(int(a, 16), 1)[0]}")
    elif name == "print":
        for row in vice.rows():
            if row.strip("~ "):
                print("|" + row + "|")
    else:
        raise Fail(f"unknown step '{name}'")


def main():
    if len(sys.argv) < 2:
        print(__doc__.split("\n\n")[0], file=sys.stderr)
        return 2
    vice = Vice(sys.argv[1])
    try:
        for s in sys.argv[2:]:
            name, _, arg = s.partition(":")
            step(vice, name, arg)
    except Fail as e:
        print(f"drive: FAIL, {e}")
        return 1
    finally:
        vice.quit()
    return 0


if __name__ == "__main__":
    sys.exit(main())
