#!/usr/bin/env python3
"""zp-used.py: the zero-page addresses an Oscar64 program's code touches.

usage: zp-used.py build/NAME.asm [--claim '$02-$52']

Reads the listing Oscar64 writes beside the PRG. Every instruction there is
a line "addr : b0 b1 b2 MNEMONIC operand"; one whose third byte is "__" is
two bytes long, and a two-byte instruction that is not immediate ("#") and
not a branch addresses zero page through its second byte (zp, zp,x, zp,y,
(zp,x), (zp),y). The BASIC stub at $0801-$080C decodes as instructions and
is skipped.

Why a measurement and not a constant: Oscar64 places its fixed registers at
$02-$26 and each function's temporaries from $43 up by that function's temp
count (oscar64/MachineTypes.cpp and InterCode.cpp, read); temps past
BC_REG_TMP_SAVED ($53) are saved and restored around calls, but they are
still zero page. So the top of the range grows with the largest function,
and only the program's own listing says where it is.

It sees the compiled C and inline __asm only: bytes embedded from a
KickAssembler blob are data in the listing (BYT lines), so a blob's zero
page is whatever its own source uses.

$00 and $01 are the 6510's own port (direction and data), not work bytes;
they are listed on their own line and never judged against a claim. The
startup's zero-page clear is a store indexed from $00, which is why $00
shows up in every build.

With --claim, exits 1 when the program touches an address from $02 up
outside the claimed ranges (comma-separated $lo-$hi or $addr), and names
them.
"""
import re
import sys

LINE = re.compile(r"^\s*([0-9a-f]{4}) : ([0-9a-f]{2}) ([0-9a-f]{2}|__) (__|[0-9a-f]{2}) ([A-Z]{3})\b\s*(.*)$")
BRANCHES = {"BPL", "BMI", "BVC", "BVS", "BCC", "BCS", "BNE", "BEQ"}
STUB_END = 0x080D


def used(path):
    out = {}
    for line in open(path, encoding="latin-1"):
        m = LINE.match(line)
        if not m:
            continue
        addr, _op, b1, b2, mnem, operand = m.groups()
        if int(addr, 16) < STUB_END or b2 != "__" or b1 == "__":
            continue
        if mnem in BRANCHES or operand.startswith("#"):
            continue
        out.setdefault(int(b1, 16), mnem)
    return out


def ranges(addrs):
    rs, start, prev = [], None, None
    for a in sorted(addrs):
        if start is None:
            start = prev = a
        elif a == prev + 1:
            prev = a
        else:
            rs.append((start, prev))
            start = prev = a
    if start is not None:
        rs.append((start, prev))
    return rs


def parse_claim(text):
    claimed = set()
    for part in text.split(","):
        part = part.strip().replace("$", "")
        if not part:
            continue
        lo, _, hi = part.partition("-")
        claimed.update(range(int(lo, 16), int(hi or lo, 16) + 1))
    return claimed


def main(argv):
    if not argv:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    found = used(argv[0])
    port = sorted(a for a in found if a < 2)
    addrs = {a: m for a, m in found.items() if a >= 2}
    text = ", ".join(f"${a:02X}" if a == b else f"${a:02X}-${b:02X}" for a, b in ranges(addrs))
    print(f"zero page used by the code in {argv[0]}: {text or '(none)'}")
    if port:
        print("6510 port (not judged): " + ", ".join(f"${a:02X} ({found[a]})" for a in port))
    if "--claim" in argv:
        claim = argv[argv.index("--claim") + 1]
        outside = sorted(set(addrs) - parse_claim(claim))
        if outside:
            print("outside the claim " + claim + ": " + ", ".join(f"${a:02X} ({addrs[a]})" for a in outside))
            return 1
        print(f"all inside the claim {claim}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
