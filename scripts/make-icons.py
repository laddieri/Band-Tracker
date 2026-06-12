#!/usr/bin/env python3
"""Generate the Band Tracker app icons (icons/icon-*.png).

Pure-stdlib PNG writer — no Pillow/ImageMagick needed, so the icons are
reproducible anywhere. Design: white beamed eighth notes on the app's
primary-blue gradient, sized inside the maskable safe zone so the same
files work for Android maskable icons, iOS touch icons and favicons.

Usage:  python3 scripts/make-icons.py     (writes into icons/ at repo root)
"""

import os, struct, zlib

MASTER = 2048           # supersampled master; downsampled for anti-aliasing
SIZES  = [32, 180, 192, 512]

TOP    = (0x25, 0x63, 0xEB)   # --primary
BOTTOM = (0x1D, 0x4E, 0xD8)   # --primary-dark
WHITE  = (0xFF, 0xFF, 0xFF)

# Glyph geometry in unit coordinates (kept within the central ~60% so the
# icon survives Android's maskable crop).
HEAD1 = (0.355, 0.660, 0.085, 0.064)   # cx, cy, rx, ry
HEAD2 = (0.645, 0.625, 0.085, 0.064)
STEM1 = (0.418, 0.458, 0.310, 0.660)   # x0, x1, y0, y1
STEM2 = (0.708, 0.748, 0.275, 0.625)
BEAM_X0, BEAM_X1 = STEM1[0], STEM2[1]
BEAM_Y0, BEAM_Y1 = 0.310, 0.275        # top edge slants up left→right
BEAM_T = 0.085


def in_glyph(x, y):
    for cx, cy, rx, ry in (HEAD1, HEAD2):
        dx, dy = (x - cx) / rx, (y - cy) / ry
        if dx * dx + dy * dy <= 1.0:
            return True
    for x0, x1, y0, y1 in (STEM1, STEM2):
        if x0 <= x <= x1 and y0 <= y <= y1:
            return True
    if BEAM_X0 <= x <= BEAM_X1:
        t = (x - BEAM_X0) / (BEAM_X1 - BEAM_X0)
        top = BEAM_Y0 + t * (BEAM_Y1 - BEAM_Y0)
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
