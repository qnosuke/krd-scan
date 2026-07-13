#!/usr/bin/env python3
"""PWA用アイコンを標準ライブラリだけで生成する（体組成計モチーフ）。"""
import os
import struct
import zlib

BG = (15, 23, 42)        # --bg
BODY = (56, 189, 248)    # --accent
DISPLAY = (15, 23, 42)
SEG = (56, 189, 248)
PAD = (2, 132, 199)      # --accent-dark


def make_icon(size):
    px = [[BG for _ in range(size)] for _ in range(size)]

    def rounded_rect(x0, y0, x1, y1, r, color):
        for y in range(int(y0), int(y1)):
            for x in range(int(x0), int(x1)):
                # 角の丸み判定
                dx = max(x0 + r - x, x - (x1 - 1 - r), 0)
                dy = max(y0 + r - y, y - (y1 - 1 - r), 0)
                if dx * dx + dy * dy <= r * r:
                    px[y][x] = color

    s = size
    # 本体（丸角スクエアの体組成計）
    rounded_rect(s * 0.14, s * 0.14, s * 0.86, s * 0.86, s * 0.12, BODY)
    # 液晶
    rounded_rect(s * 0.26, s * 0.24, s * 0.74, s * 0.46, s * 0.03, DISPLAY)
    # 液晶内の7セグ風の数字バー
    rounded_rect(s * 0.31, s * 0.31, s * 0.42, s * 0.39, s * 0.008, SEG)
    rounded_rect(s * 0.45, s * 0.31, s * 0.56, s * 0.39, s * 0.008, SEG)
    rounded_rect(s * 0.61, s * 0.35, s * 0.66, s * 0.39, s * 0.008, SEG)
    # 足を乗せる電極パッド
    rounded_rect(s * 0.22, s * 0.56, s * 0.44, s * 0.78, s * 0.04, PAD)
    rounded_rect(s * 0.56, s * 0.56, s * 0.78, s * 0.78, s * 0.04, PAD)
    return px


def write_png(path, px):
    h = len(px)
    w = len(px[0])
    raw = b''.join(
        b'\x00' + b''.join(struct.pack('BBB', *p) for p in row) for row in px
    )

    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c))

    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b'')
    )
    with open(path, 'wb') as f:
        f.write(png)
    print(f'wrote {path} ({w}x{h})')


if __name__ == '__main__':
    out = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
    os.makedirs(out, exist_ok=True)
    for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
        write_png(os.path.join(out, name), make_icon(size))
