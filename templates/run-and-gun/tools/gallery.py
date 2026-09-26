#!/usr/bin/env python3
"""gallery.py PRG STEP...: harness/drive.py with one more step, for make gallery.

    throw   port-1 fire for 3 frames, then 6 released: FIREBASE's throw
            (JOY_THROW, main.c port_read). Control port 1 is VICE's Joyport
            I/O simulation device too (-controlport1device 37, after
            -default, which resets it), set through the monitor's joyport
            command on port 0, as PLAN.md "Weapons" measured it.

Every other step, and the environment, is drive.py's.
"""
import os
import struct
import sys

sys.path.insert(0, os.environ.get("HARNESS_DIR", os.path.join(os.path.dirname(__file__), "..", "harness")))
import drive  # noqa: E402

_popen = drive.subprocess.Popen


def _popen_port1(args, **kw):
    i = args.index("-default") + 1                        # after it: -default resets the ports
    return _popen([*args[:i], "-controlport1device", drive.IO_SIMULATION, *args[i:]], **kw)


drive.subprocess.Popen = _popen_port1
_step = drive.step
PORT1_IDLE, PORT1_FIRE = 0x1F, 0x0F   # the device's five lines, active low. 0xFF read
                                      # back as $00 on $DC01 (bit 4 low: the throw
                                      # held from power-on), measured through the monitor
_ready = []


def step(vice, name, arg):
    if not _ready:
        vice.cmd(0xa2, struct.pack("<HH", 0, PORT1_IDLE))
        _ready.append(1)
    if name != "throw":
        return _step(vice, name, arg)
    vice.cmd(0xa2, struct.pack("<HH", 0, PORT1_FIRE))
    vice.frames(3)
    vice.cmd(0xa2, struct.pack("<HH", 0, PORT1_IDLE))
    vice.frames(6)
    return None


drive.step = step

if __name__ == "__main__":
    sys.exit(drive.main())
