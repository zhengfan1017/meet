#!/usr/bin/env python3
"""把实物照片里的 Trae宝 抠出来，做成 PWA 桌面图标。

照片里的机器人是饱和的绿色，背景是浅灰渐变，中间还垫着一个透明亚克力底座。
做法：
1. 用「绿色 + 深色（黑色屏幕）」两张掩膜取并集，把机器人整体框出来
2. 连通域只留最大的一块，丢掉底座、阴影这些零散区域
3. 填掉屏幕那块空洞，做软边（抗锯齿）
4. 抠成透明底，再贴到 App 的米色底上出 192 / 512 两张图标
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage

SRC = "/workspace/.uploads/c12098b3-a6fb-4790-af44-1ea47b06d346_hailuo_1793452602.jpeg"
ICON_DIR = "/workspace/traebao-pwa/icons"

# App 的米色纸底，和 app.css / manifest 的主题色一致
APP_BG = (245, 241, 232)


def load():
    return Image.open(SRC).convert("RGB")


def robot_mask(arr):
    """返回机器人的布尔掩膜（含绿色外壳和黑色屏幕）。"""
    r = arr[:, :, 0].astype(int)
    g = arr[:, :, 1].astype(int)
    b = arr[:, :, 2].astype(int)

    # 绿色外壳：绿通道明显高于红蓝
    green = (g > 100) & (g - r > 50) & (g - b > 25)
    # 黑色屏幕：三个通道都很低
    dark = arr.max(axis=2) < 115

    mask = green | dark
    # 亚克力底座和地面阴影有零星的暗色/偏绿像素，先按绿色分量做一次连通域，
    # 只保留与绿色主体相连的部分，底座自然被切掉
    lab, n = ndimage.label(green)
    if n:
        sizes = ndimage.sum(green, lab, range(1, n + 1))
        body = (lab == (np.argmax(sizes) + 1))
        # 屏幕在绿色框内部，是独立的一团暗色，但被绿色包着 —— 用填洞补回来
        filled = ndimage.binary_fill_holes(body)
        mask = filled | dark
        lab2, n2 = ndimage.label(mask)
        if n2:
            sizes2 = ndimage.sum(mask, lab2, range(1, n2 + 1))
            mask = lab2 == (np.argmax(sizes2) + 1)
    return mask


def cutout(img):
    """抠出带透明通道的机器人（软边）。"""
    arr = np.asarray(img).astype(int)
    mask = robot_mask(arr)
    if not mask.any():
        raise SystemExit("没抠到机器人")

    ys, xs = np.where(mask)
    # 裁剪范围往外多留一点，别切到手脚
    pad = 6
    x0 = max(0, xs.min() - pad)
    x1 = min(img.width, xs.max() + pad + 1)
    y0 = max(0, ys.min() - pad)
    y1 = min(img.height, ys.max() + pad + 1)

    sub = np.asarray(img.crop((x0, y0, x1, y1))).copy()
    sub_mask = mask[y0:y1, x0:x1]

    # 边缘一圈的背景像素会被缩放时带成灰边，先用邻近的主体色替换掉
    rgb = sub.astype(float)
    if sub_mask.any():
        fill = np.median(rgb[sub_mask], axis=0)
    else:
        fill = np.array(APP_BG, dtype=float)
    # 距离主体 1~3 像素的环带，颜色往主体色靠
    ring = ndimage.binary_dilation(sub_mask, iterations=3) & ~sub_mask
    if ring.any():
        near = ndimage.distance_transform_edt(~sub_mask)
        weight = np.clip(1.0 - near[ring] / 3.0, 0, 1)[:, None]
        rgb[ring] = rgb[ring] * (1 - weight) + fill * weight

    alpha = ndimage.distance_transform_edt(sub_mask)
    # 边缘 1.5 像素内做渐变，得到软边
    alpha = np.clip(alpha / 1.5, 0, 1) * 255

    out = np.dstack([rgb, alpha]).astype(np.uint8)
    return Image.fromarray(out, "RGBA"), (x0, y0, x1, y1)


def make_icon(cut, size, bg=APP_BG, pad_ratio=0.04):
    """把抠好的机器人居中放进正方形米色底。"""
    w, h = cut.size
    side = int(max(w, h) * (1 + pad_ratio * 2))
    canvas = Image.new("RGBA", (side, side), bg + (255,))
    canvas.paste(cut, ((side - w) // 2, (side - h) // 2), cut)
    canvas = canvas.convert("RGB").resize((size, size), Image.LANCZOS)
    out_path = os.path.join(ICON_DIR, f"icon-{size}.png")
    canvas.save(out_path, "PNG")
    print("写出", out_path, canvas.size)


def main():
    img = load()
    cut, box = cutout(img)
    print("抠图范围", box, cut.size)

    # 透明底立绘（存一份大图）
    cut_path = os.path.join(ICON_DIR, "trae-robot-green.png")
    cut.resize((1024, 1024), Image.LANCZOS).save(cut_path, "PNG")
    print("写出", cut_path)

    make_icon(cut, 192)
    make_icon(cut, 512)


if __name__ == "__main__":
    main()
