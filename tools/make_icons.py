import os
from PIL import Image

SRC = "src/assets/sprite/07-甲方说好.png"
OUT_DIR = "icons"
SIZES = {"icon-192.png": 192, "icon-512.png": 512}
BG = (245, 241, 232, 255)


def make_icon(size: int, out_path: str) -> None:
    im = Image.open(SRC).convert("RGBA")
    im = im.resize((int(size * 0.78), int(size * 0.78)), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), BG)
    canvas.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
    canvas.save(out_path, optimize=True)


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, size in SIZES.items():
        make_icon(size, os.path.join(OUT_DIR, name))
        print("wrote", name)
