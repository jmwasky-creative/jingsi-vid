#!/usr/bin/env python3
"""Motion-design studies drawn on the real talking-head frames.

Five stills and one GIF. The interview frame stays the base. Type, cards,
and the incoming vertical picture land in the band under the face.
"""

import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "styles"
FRAMES = ROOT / "output" / "frames" / "base"
PLATE_PATH = Path("/opt/cursor/artifacts/assets/tech-plate.jpg")

W, H = 1080, 1920
BG = (7, 9, 12)
MINT = (125, 255, 195)
INK = (244, 246, 248)
MUTED = (176, 184, 192)
CN = "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"
MONO = "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Regular.ttf"
MONO_B = "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Bold.ttf"


def cn(size):
    return ImageFont.truetype(CN, size, index=0)


def mono(size, bold=False):
    return ImageFont.truetype(MONO_B if bold else MONO, size)


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def frame(index):
    return Image.open(FRAMES / f"{index:04d}.png").convert("RGBA")


def cover(im, w, h):
    scale = max(w / im.width, h / im.height)
    nw, nh = int(im.width * scale), int(im.height * scale)
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = max(0, (nw - w) // 2)
    top = max(0, (nh - h) // 2)
    return resized.crop((left, top, left + w, top + h)).convert("RGBA")


def rounded(im, radius):
    im = im.convert("RGBA")
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=radius, fill=255)
    im.putalpha(mask)
    return im


def picture_card(plate, w, h):
    card = rounded(cover(plate, w, h), 28)
    shell = Image.new("RGBA", (w + 6, h + 6), (0, 0, 0, 0))
    ImageDraw.Draw(shell).rounded_rectangle((1, 1, w + 4, h + 4), radius=32, outline=(*MINT, 220), width=3)
    shell.alpha_composite(card, (3, 3))
    return shell


def blit(base, im, xy):
    base.alpha_composite(im, xy)


def kicker(d, y, label):
    d.text((72, y), label, font=mono(26, True), fill=MINT)


def person_board(base):
    im = base.copy()
    d = ImageDraw.Draw(im)
    kicker(d, 1320, "01   PERSON")
    d.text((72, 1388), "人物介绍", font=cn(78), fill=INK)
    d.rectangle((72, 1516, 188, 1520), fill=MINT)
    d.text((72, 1552), "Frania Pereira", font=mono(40, True), fill=INK)
    d.text((72, 1624), "Goa University", font=cn(34), fill=MUTED)
    return im


def text_board(base):
    im = base.copy()
    d = ImageDraw.Draw(im)
    kicker(d, 1310, "02   TEXT")
    d.text((72, 1380), "把一句", font=cn(92), fill=INK)
    d.text((72, 1500), "说完", font=cn(92), fill=MINT)
    d.text((72, 1660), "大字只占下沿，人留在上面。", font=cn(34), fill=MUTED)
    return im


def points_board(base):
    im = base.copy()
    d = ImageDraw.Draw(im)
    kicker(d, 1288, "04   POINTS")
    rows = [
        ("01", "人物", "名字和学校"),
        ("02", "文字", "当前这一句"),
        ("03", "画面", "竖图从下方来"),
    ]
    y = 1360
    for num, title, desc in rows:
        card = Image.new("RGBA", (936, 132), (0, 0, 0, 0))
        cd = ImageDraw.Draw(card)
        cd.rounded_rectangle((0, 0, 935, 131), radius=20, fill=(8, 10, 14, 210), outline=(255, 255, 255, 36), width=2)
        cd.text((28, 42), num, font=mono(30, True), fill=MINT)
        cd.text((130, 28), title, font=cn(36), fill=INK)
        cd.text((130, 74), desc, font=cn(28), fill=MUTED)
        blit(im, card, (72, y))
        y += 152
    return im


def quote_board(base):
    im = base.copy()
    d = ImageDraw.Draw(im)
    kicker(d, 1320, "05   LINE")
    d.text((72, 1400), "先让人站稳", font=cn(72), fill=INK)
    d.text((72, 1508), "再把字放进来", font=cn(72), fill=MINT)
    d.text((72, 1668), "金句贴在口播下面", font=cn(32), fill=MUTED)
    return im


def inflow_frame(base, plate, p, text_n=0):
    """A portrait still rises into the lower band, then the line types on."""
    im = base.copy()
    p = ease(p)
    card_w, card_h = 430, 560
    x = 590
    y = int(H - (card_h + 80) * p)
    if p > 0.02:
        blit(im, picture_card(plate, card_w, card_h), (x, y))
    d = ImageDraw.Draw(im)
    if p < 0.15:
        d.rounded_rectangle((48, 1288, 1032, 1848), radius=28, outline=MINT, width=2)
        d.text((72, 1330), "口播下沿", font=cn(32), fill=MUTED)
    if text_n > 0:
        lines = ["画面流入", "竖图先到位", "字在左侧"]
        shown = "".join(lines)[:text_n]
        cursor = 0
        yy = 1360
        for line, size, color in zip(lines, (60, 36, 30), (INK, INK, MUTED)):
            take = shown[cursor:cursor + len(line)]
            cursor += len(line)
            if take:
                d.text((72, yy), take, font=cn(size), fill=color)
            yy += size + 22
    return im


def save_rgb(im, path):
    im.convert("RGB").save(path, quality=92)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    plate = Image.open(PLATE_PATH).convert("RGB")
    stills = {
        "01-person.png": person_board(frame(90)),
        "02-text.png": text_board(frame(120)),
        "03-inflow.png": inflow_frame(frame(150), plate, 1, text_n=99),
        "04-points.png": points_board(frame(180)),
        "05-quote.png": quote_board(frame(210)),
    }
    for name, im in stills.items():
        save_rgb(im, OUT / name)

    tmp = OUT / "gif-frames"
    tmp.mkdir(exist_ok=True)
    words = "画面流入竖图先到位字在左侧"
    seq = [(0.0, 0)] * 8
    seq += [(i / 15, 0) for i in range(16)]
    seq += [(1.0, i + 1) for i in range(len(words))]
    seq += [(1.0, len(words))] * 8
    for i, (p, n) in enumerate(seq):
        src = frame(70 + i * 2)
        shot = inflow_frame(src, plate, p, n)
        shot.resize((540, 960), Image.Resampling.LANCZOS).convert("RGB").save(tmp / f"{i:03d}.jpg", quality=88)

    palette = tmp / "palette.png"
    gif = OUT / "inflow.gif"
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-framerate", "12", "-i", str(tmp / "%03d.jpg"),
        "-vf", "palettegen=max_colors=128", str(palette),
    ], check=True)
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-framerate", "12", "-i", str(tmp / "%03d.jpg"),
        "-i", str(palette), "-lavfi", "paletteuse=dither=bayer:bayer_scale=3", "-loop", "0", str(gif),
    ], check=True)
    print(f"wrote {OUT} ({len(seq)} frames)")


if __name__ == "__main__":
    main()
