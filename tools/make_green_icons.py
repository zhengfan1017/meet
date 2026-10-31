#!/usr/bin/env python3
"""把 seedream 生成的绿色机器人图处理成 PWA 图标规格。

两件事：
1. 按背景色抠出机器人，裁掉四周多余留白，再缩放成 192 / 512 的方图图标
2. 把"抠图版"的近白背景换成真透明，输出一份可任意叠放的 PNG
"""
import os
from PIL import Image

ICON_DIR = "/workspace/traebao-pwa/icons"
SRC_APP = os.path.join(ICON_DIR, "trae-robot-green.jpg")
SRC_CUT = os.path.join(ICON_DIR, "trae-robot-green-cutout.jpg")


def near(pixel, target, tol=26):
    return all(abs(a - b) <= tol for a, b in zip(pixel[:3], target[:3]))


def robot_bbox(img, bg):
    """找出机器人外接框：背景像素一律不算。"""
    w, h = img.size
    px = img.load()
    # 先按行采样找上下界，再按列找左右界，省时间
    def col_has_robot(x):
        for y in range(0, h, 4):
            if not near(px[x, y], bg):
                return True
        return False

    def row_has_robot(y):
        for x in range(0, w, 4):
            if not near(px[x, y], bg):
                return True
        return False

    xs = [x for x in range(w) if col_has_robot(x)]
    ys = [y for y in range(h) if row_has_robot(y)]
    if not xs or not ys:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def make_icon(src, out_path, size, bg, pad_ratio=0.06):
    img = Image.open(src).convert("RGB")
    box = robot_bbox(img, bg)
    if box is None:
        raise SystemExit("没找到机器人")
    x0, y0, x1, y1 = box
    # 居中裁成正方形，再留一点边距
    side = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    half = int(side * (1 + pad_ratio * 2) / 2)
    left = max(0, cx - half)
    top = max(0, cy - half)
    right = min(img.width, left + half * 2)
    bottom = min(img.height, top + half * 2)
    # 贴到纯色底上，保证输出尺寸正好是 size x size
    canvas = Image.new("RGB", (right - left, bottom - top), bg)
    canvas.paste(img.crop((left, top, right, bottom)))
    canvas = canvas.resize((size, size), Image.LANCZOS)
    canvas.save(out_path, "PNG")
    print("写出", out_path, canvas.size)


def make_transparent(src, out_path):
    """近白背景抠成透明。用边缘泛洪，避免误伤机器人身上的浅色高光。"""
    img = Image.open(src).convert("RGB")
    w, h = img.size
    px = img.load()
    bg = px[2, 2]
    visited = [[False] * w for _ in range(h)]
    stack = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)]
    stack += [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h or visited[y][x]:
            continue
        if not near(px[x, y], bg, 30):
            continue
        visited[y][x] = True
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]

    out = img.convert("RGBA")
    op = out.load()
    for y in range(h):
        for x in range(w):
            if visited[y][x]:
                op[x, y] = (255, 255, 255, 0)
            elif near(px[x, y], bg, 12):
                # 边缘一圈半透明的过渡，避免抠完有白边
                op[x, y] = (255, 255, 255, 0)
    out.save(out_path, "PNG")
    print("写出", out_path, out.size)


if __name__ == "__main__":
    app_bg = Image.open(SRC_APP).convert("RGB").getpixel((5, 5))
    make_icon(SRC_APP, os.path.join(ICON_DIR, "icon-192.png"), 192, app_bg)
    make_icon(SRC_APP, os.path.join(ICON_DIR, "icon-512.png"), 512, app_bg)
    make_transparent(SRC_CUT, os.path.join(ICON_DIR, "trae-robot-green.png"))
