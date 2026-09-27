#!/usr/bin/env python3
"""mkweapons.py: FIREBASE's weapon sprites (the bullet, the grenade in three
sizes, the blast in two frames), generated from this file alone.
Deterministic: no clock, no randomness.

    python3 tools/mkweapons.py                        # writes src/gen/weapon_sprites.bin and .h
    python3 tools/mkweapons.py --preview build/preview   # also weapons.png (needs PIL)

They sit at the top of the sprite area, $BE00-$BFFF (blocks 248-255 of VIC
bank 2), apart from tools/mkassets.py's sprites.bin, which grows up from
$A000 with the enemies. main.c places weapon_sprites.bin there.

Multicolour, like every sprite here (kernel.asm sets $D01C = $FF):
    00 clear   01 $D025 black   10 the slot's colour   11 $D026 light red
Each sprite is drawn on the 12 x 21 multicolour grid; hires pixel x is 2 * column.

Reference points, in hires sprite pixels (weapons.c converts with them):
    bullet   its 4 x 4 dot covers x 10-13, y 8-11; the bullet's point is (12, 10)
    grenade  centred on (12, 10); small 4 x 3, medium 8 x 5, large 12 x 9 (outline included)
    blast    centred on (12, 10), inside x 0-23, y 0-20
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "..", "src", "gen")

BASE_BLOCK = 120        # block offset from SPR_BLOCK (128): $A000 + 120 * 64 = $BE00
CLR, BLK, COL, RED = 0, 1, 2, 3


def grid():
    return [[CLR] * 12 for _ in range(21)]


def pack(g):
    block = bytearray(64)
    for y in range(21):
        for b in range(3):
            v = 0
            for k in range(4):
                v = (v << 2) | g[y][b * 4 + k]
            block[y * 3 + b] = v
    return block


def bullet():
    g = grid()
    # MC columns 5-6 are hires x 10-13; rows 8-11. A light-red core in a
    # rim of the slot's colour, no outline: the box is exactly the dot.
    for y, c in ((8, COL), (9, RED), (10, RED), (11, COL)):
        g[y][5] = g[y][6] = c
    return g


def ellipse(g, cx, cy, rx, ry, colour):
    """Fill MC cells whose centre (hires x = 2 * col + 1) is inside the ellipse."""
    for y in range(21):
        for c in range(12):
            dx = (2 * c + 1 - cx) / rx
            dy = (y + 0.5 - cy) / ry
            if dx * dx + dy * dy <= 1.0:
                g[y][c] = colour


def outline(g):
    out = [row[:] for row in g]
    for y in range(21):
        for c in range(12):
            if g[y][c] != CLR:
                continue
            for dc, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nc, ny = c + dc, y + dy
                if 0 <= nc < 12 and 0 <= ny < 21 and g[ny][nc] in (COL, RED):
                    out[y][c] = BLK
                    break
    return out


def grenade(size):
    """size 0 small, 1 medium, 2 large: the grenade seen nearer as it rises."""
    g = grid()
    rx, ry = ((1.6, 1.3), (3.2, 2.2), (5.0, 3.6))[size]
    ellipse(g, 12.0, 10.5, rx, ry, COL)
    g = outline(g)
    if size > 0:                     # a light-red fuse spark on the top left
        for y in range(21):
            if COL in g[y]:
                g[y][g[y].index(COL)] = RED
                break
    return g


def blast(frame):
    """A ragged burst: a light-red core, a ring of the slot's colour with
    spikes, black specks at the tips. frame 1 turns the spikes half a step."""
    g = grid()
    spikes = 7
    turn = (0.5 if frame else 0.0) * 2 * math.pi / spikes
    for y in range(21):
        for c in range(12):
            dx, dy = 2 * c + 1 - 12.0, y + 0.5 - 10.5
            r = math.hypot(dx, dy / 0.95)
            a = math.atan2(dy, dx) + turn
            edge = 7.0 + 3.6 * max(0.0, math.cos(spikes * a)) ** 3 + (0.8 if frame else 0.0)
            if r <= 3.2 + frame:
                g[y][c] = RED
            elif r <= edge:
                g[y][c] = COL
            elif r <= edge + 1.3 and (c + y + frame) % 3 == 0:
                g[y][c] = BLK
    return g


def make():
    sprites = [bullet(), grenade(0), grenade(1), grenade(2), blast(0), blast(1)]
    data = bytearray()
    for s in sprites:
        data += pack(s)
    data += bytearray(64 * (8 - len(sprites)))          # 8 blocks, the last two spare
    return data, sprites


def write_header(path):
    lines = [
        "// weapon_sprites.h: written by tools/mkweapons.py. Do not edit; change the tool and re-run it.",
        "#ifndef WEAPON_SPRITES_H",
        "#define WEAPON_SPRITES_H",
        f"#define SPR_W_BULLET   {BASE_BLOCK}   // block offsets from SPR_BLOCK ($BE00 = block 248)",
        f"#define SPR_W_GRENADE  {BASE_BLOCK + 1}   // 3 sizes: small, medium, large",
        f"#define SPR_W_BLAST    {BASE_BLOCK + 4}   // 2 frames",
        "#define W_SPR_BYTES    512",
        "#endif",
        "",
    ]
    open(path, "w").write("\n".join(lines))


def preview(outdir, sprites):
    from PIL import Image
    pal = {CLR: (0x70, 0x50, 0x20), BLK: (0, 0, 0), COL: (0xff, 0xff, 0x55), RED: (0xff, 0x77, 0x77)}
    img = Image.new("RGB", (len(sprites) * 26, 21))
    px = img.load()
    for i, g in enumerate(sprites):
        for y in range(21):
            for c in range(12):
                px[i * 26 + 2 * c, y] = pal[g[y][c]]
                px[i * 26 + 2 * c + 1, y] = pal[g[y][c]]
    os.makedirs(outdir, exist_ok=True)
    img.resize((img.width * 6, img.height * 6), Image.NEAREST).save(os.path.join(outdir, "weapons.png"))


def main():
    data, sprites = make()
    os.makedirs(GEN, exist_ok=True)
    open(os.path.join(GEN, "weapon_sprites.bin"), "wb").write(data)
    write_header(os.path.join(GEN, "weapon_sprites.h"))
    if "--preview" in sys.argv:
        preview(sys.argv[sys.argv.index("--preview") + 1], sprites)
    print(f"mkweapons: {len(data) // 64} sprite blocks at $BE00")


if __name__ == "__main__":
    main()
