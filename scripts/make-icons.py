#!/usr/bin/env python3
"""Generate the Band Tracker app icons (icons/icon-*.png).

Pure-stdlib PNG writer — no Pillow/ImageMagick needed, so the icons are
reproducible anywhere. Design: a white beamed pair of eighth notes on the
app's primary-blue gradient, sized inside the maskable safe zone so the same
files work for Android maskable icons, iOS touch icons and favicons.

Usage:  python3 scripts/make-icons.py     (writes into icons/ at repo root)
"""

import math, os, struct, zlib

MASTER = 2048           # supersampled master; downsampled for anti-aliasing
SIZES  = [32, 180, 192, 512]

TOP    = (0x25, 0x63, 0xEB)   # --primary
BOTTOM = (0x1D, 0x4E, 0xD8)   # --primary-dark
WHITE  = (0xFF, 0xFF, 0xFF)

# Glyph geometry in unit coordinates (kept within the central ~60% so the
# icon survives Android's maskable crop). Noteheads are tilted ellipses like
# engraved notes; each stem sits flush with its head's right edge and runs
# into the head, and the beam spans exactly the two stems (no overhang).

TILT   = math.radians(22)          # notehead tilt, rising to the right
HEAD_R = (0.094, 0.066)            # notehead semi-axes (rx, ry)
HEADS  = [(0.362, 0.690), (0.642, 0.648)]   # notehead centres
STEM_W = 0.044
BEAM_T = 0.092                     # beam thickness (vertical)
BEAM_TOP = (0.285, 0.243)          # beam top edge y at left / right stem


def _head_xext():
    rx, ry = HEAD_R
    return math.sqrt((rx * math.cos(TILT)) ** 2 + (ry * math.sin(TILT)) ** 2)


# Stem right edges tuck just inside each head's rightmost point.
STEMS = []
for cx, cy in HEADS:
    x1 = cx + _head_xext() - 0.004
    STEMS.append((x1 - STEM_W, x1, cy))   # x0, x1, bottom y
BEAM_X0, BEAM_X1 = STEMS[0][0], STEMS[1][1]


def beam_top(x):
    t = (x - BEAM_X0) / (BEAM_X1 - BEAM_X0)
    return BEAM_TOP[0] + t * (BEAM_TOP[1] - BEAM_TOP[0])


def in_glyph(x, y):
    rx, ry = HEAD_R
    c, s = math.cos(TILT), math.sin(TILT)
    for cx, cy in HEADS:
        dx, dy = x - cx, y - cy
        u = dx * c - dy * s      # along the tilted major axis
        v = dx * s + dy * c
        if (u / rx) ** 2 + (v / ry) ** 2 <= 1.0:
            return True
    for x0, x1, y1 in STEMS:
        if x0 <= x <= x1 and beam_top(x) <= y <= y1:
            return True
    if BEAM_X0 <= x <= BEAM_X1:
        top = beam_top(x)
        if top <= y <= top + BEAM_T:
            return True
    return False


def render_master(n):
    rows = []
    for j in range(n):
        y = (j + 0.5) / n
        t = y
        bg = tuple(round(TOP[k] + (BOTTOM[k] - TOP[k]) * t) for k in range(3))
        row = bytearray()
        for i in range(n):
            x = (i + 0.5) / n
            row.extend(WHITE if in_glyph(x, y) else bg)
        rows.append(bytes(row))
    return rows


def resample(rows, n, size):
    """Box-average the n×n master down to size×size."""
    out = []
    step = n / size
    for oj in range(size):
        j0, j1 = int(oj * step), max(int((oj + 1) * step), int(oj * step) + 1)
        row = bytearray()
        for oi in range(size):
            i0, i1 = int(oi * step), max(int((oi + 1) * step), int(oi * step) + 1)
            acc = [0, 0, 0]
            cnt = 0
            for j in range(j0, j1):
                r = rows[j]
                for i in range(i0, i1):
                    p = i * 3
                    acc[0] += r[p]; acc[1] += r[p + 1]; acc[2] += r[p + 2]
                    cnt += 1
            row.extend(c // cnt for c in acc)
        out.append(bytes(row))
    return out


def write_png(path, rows, size):
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c))
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    raw = b''.join(b'\x00' + r for r in rows)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', ihdr))
        f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        f.write(chunk(b'IEND', b''))


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    outdir = os.path.join(root, 'icons')
    os.makedirs(outdir, exist_ok=True)
    print(f'rendering {MASTER}x{MASTER} master…')
    master = render_master(MASTER)
    for size in SIZES:
        path = os.path.join(outdir, f'icon-{size}.png')
        write_png(path, resample(master, MASTER, size), size)
        print(f'  wrote icons/icon-{size}.png')


if __name__ == '__main__':
    main()
