#!/usr/bin/env python3
"""从源渲染图生成 Trae宝 的 PWA 桌面图标。

源图：icons/source/robot-cute.jpg（3D 搪胶质感的可爱机器人：黑屏脸 + 腮红 + 招手）

要解决的两个麻烦：
1. 生成工具在右下角留了「AI生成」水印 —— 整块裁掉，不做修补，避免留下矩形色块
2. 脚下有地面投影阴影 —— 用「绿度」特征抠主体，阴影和背景的绿度是负值，天然分得开

产出：
  icons/icon-192.png           桌面图标 192×192
  icons/icon-512.png           桌面图标 512×512
  icons/icon-maskable-512.png  可遮罩图标（Android 自适应裁切用）
  icons/trae-robot-green.png   透明底立绘 1024×1024
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "icons/source/robot-cute.jpg")
OUT = os.path.join(ROOT, "icons")

# App 的米色纸底，和 app.css / manifest 的主题色一致
APP_BG = (245, 241, 232)

# 生成工具的水印位于右下角，这块整块裁掉
CROP = (105, 0, 1825, 1720)


def cutout():
    """抠出带透明通道的机器人立绘。"""
    im = Image.open(SRC).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    a = a[CROP[1]:CROP[3], CROP[0]:CROP[2]]

    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    # 绿度：绿色外壳为正，背景和投影阴影为负
    greenness = g - np.maximum(r, b)

    # 主体 = 绿色外壳；黑色屏幕脸被绿框完全包住，填洞后一并纳入
    subject = greenness > 14
    subject = ndimage.binary_closing(subject, structure=np.ones((9, 9)))
    subject = ndimage.binary_fill_holes(subject)

    lab, n = ndimage.label(subject)
    sizes = ndimage.sum(subject, lab, range(1, n + 1))
    subject = lab == (1 + int(np.argmax(sizes)))   # 只保留最大连通域 = 机器人

    # 连续绿度做边缘羽化，避免硬边毛刺
    alpha = np.clip((greenness + 2) / 12, 0, 1)
    alpha = np.where(subject, np.maximum(alpha, 1.0), alpha)
    # 主体外的杂散绿度（阴影反光）抹掉
    alpha = alpha * ndimage.binary_dilation(subject, structure=np.ones((5, 5)))
    alpha = ndimage.gaussian_filter(alpha, 0.6)

    rgba = np.dstack([a, alpha * 255]).astype(np.uint8)
    cut = Image.fromarray(rgba, "RGBA")
    bbox = cut.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return cut.crop(bbox)


def compose(robot, size, ratio):
    """把立绘居中放进正方形米色底，主体占画面 ratio。"""
    sc = size * ratio / robot.height
    r = robot.resize((int(robot.width * sc), int(robot.height * sc)), Image.LANCZOS)
    canvas = Image.new("RGB", (size, size), APP_BG)
    canvas.paste(r, ((size - r.width) // 2, (size - r.height) // 2), r)
    return canvas


def main():
    robot = cutout()
    print("抠图结果", robot.size)

    # 透明底立绘：主体占画布 92%
    S = 1024
    sc = S * 0.92 / robot.height
    big = robot.resize((int(robot.width * sc), int(robot.height * sc)), Image.LANCZOS)
    master = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    master.paste(big, ((S - big.width) // 2, (S - big.height) // 2), big)
    master.save(os.path.join(OUT, "trae-robot-green.png"))
    print("写出 icons/trae-robot-green.png")

    compose(robot, 192, 0.82).save(os.path.join(OUT, "icon-192.png"))
    compose(robot, 512, 0.82).save(os.path.join(OUT, "icon-512.png"))
    # 可遮罩：主体缩到 60%，落在 80% 安全圈内
    compose(robot, 512, 0.60).save(os.path.join(OUT, "icon-maskable-512.png"))
    print("写出 icon-192 / icon-512 / icon-maskable-512")


if __name__ == "__main__":
    main()
