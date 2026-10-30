"""从透明底 PNG 重新导出透明底 GIF。

原 GIF 在量化时把 alpha 通道丢掉了，透明区域变成不透明黑底，
浏览器里角色会显示成黑框。这里重新量化并保留一个透明索引。
"""

import glob
import os
import sys

from PIL import Image

TRANSPARENT_INDEX = 255
ALPHA_CUTOFF = 128


def png_to_transparent_gif(src: str, dst: str) -> None:
    im = Image.open(src).convert("RGBA")
    alpha = im.getchannel("A")

    # 只量化不透明像素的颜色，透明区统一放到 255 号索引
    opaque = Image.new("RGB", im.size, (0, 0, 0))
    opaque.paste(im.convert("RGB"), mask=alpha.point(lambda a: 255 if a >= ALPHA_CUTOFF else 0))
    pal = opaque.quantize(colors=TRANSPARENT_INDEX, method=Image.FASTOCTREE)

    mask = alpha.point(lambda a: 255 if a < ALPHA_CUTOFF else 0)
    pal.paste(TRANSPARENT_INDEX, mask)

    pal.save(dst, format="GIF", transparency=TRANSPARENT_INDEX, disposal=2, optimize=True)


def main(root: str) -> None:
    count = 0
    for png in sorted(glob.glob(os.path.join(root, "*.png"))):
        gif = os.path.splitext(png)[0] + ".gif"
        if not os.path.exists(gif):
            continue
        png_to_transparent_gif(png, gif)
        count += 1
    print(f"重导出 {count} 个 GIF")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "src/assets/sprite")
