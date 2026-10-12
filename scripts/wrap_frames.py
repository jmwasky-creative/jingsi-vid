#!/usr/bin/env python3
"""Draw the talking-head wrap on top of extracted frames.

The cropped interview is split into one still per frame. Motion is painted
into the black band under the face, timed to the words already recognized
in output/talk-10s.json. Frames stay out of git; the finished film is
output/talk-10s.mp4.
"""

import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output"
CUT = OUT / "talk-10s-cut.mp4"
META = OUT / "talk-10s.json"
BASE = OUT / "frames" / "base"
COMP = OUT / "frames" / "comp"
FILM = OUT / "talk-10s.mp4"

W, H = 1080, 1920
FPS = 25
INK = (244, 241, 234)
MUTED = (201, 195, 182)
WHITE = (255, 255, 255)

FONT_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def word_start(words, token, nth=0):
    seen = 0
    key = token.lower()
    for w in words:
        if w["word"].lower().strip(",.") == key:
            if seen == nth:
                return w["start"]
            seen += 1
    raise SystemExit(f"missing word: {token}")


def reveal(text, t, start, dur):
    if t < start or not text:
        return ""
    n = int(round(ease((t - start) / dur) * len(text)))
    return text[:n]


def text_sprite(text, font, fill, alpha=255):
    box = font.getbbox(text)
    w = max(1, box[2] - box[0] + 2)
    h = max(1, box[3] - box[1] + 2)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((-box[0] + 1, -box[1] + 1), text, font=font, fill=(*fill, alpha))
    return im


def blit(base, sprite, x, y):
    if sprite is None:
        return
    base.alpha_composite(sprite, (int(x), int(y)))


def growing_line(base, x, y, full, t, start, dur, alpha=255):
    width = int(full * ease((t - start) / dur)) if t >= start else 0
    if width < 2 or alpha <= 0:
        return
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rectangle((x, y, x + width, y + 3), fill=(*INK, alpha))
    base.alpha_composite(layer)


def card_sprite(label, font):
    w, h = 188, 112
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((2, 2, w - 3, h - 3), radius=16, outline=(*INK, 255), width=2)
    if label:
        sp = text_sprite(label, font, INK)
        im.alpha_composite(sp, ((w - sp.width) // 2, (h - sp.height) // 2 - 2))
    return im


def paste_pop(base, sprite, cx, cy, t, start, dur=0.28):
    if t < start:
        return
    p = ease((t - start) / dur)
    scale = 0.72 + 0.28 * p
    alpha = int(255 * min(1.0, p * 1.4))
    nw = max(1, int(sprite.width * scale))
    nh = max(1, int(sprite.height * scale))
    resized = sprite.resize((nw, nh), Image.Resampling.LANCZOS)
    if alpha < 255:
        band = resized.getchannel("A").point(lambda a: a * alpha // 255)
        resized.putalpha(band)
    lift = int((1 - p) * 18)
    base.alpha_composite(resized, (int(cx - nw / 2), int(cy - nh / 2 + lift)))


def phrase(words, t, alpha):
    """Words spoken so far, the newest one still sliding into place."""
    shown = [w for w in words if t >= w[0]]
    if not shown or alpha <= 0:
        return None, 0
    parts = []
    slide = 0
    for i, (start, text) in enumerate(shown):
        if i == len(shown) - 1:
            slide = int((1 - ease((t - start) / 0.18)) * 22)
        parts.append(text)
    return " ".join(parts), slide


def build_cues(meta):
    words = meta["words"]
    place = meta["facts"]["place"]
    school, _, town = place.partition(",")
    return {
        "name": meta["facts"]["name"],
        "name_at": meta["facts"]["name_at"],
        "school": school.strip(),
        "school_at": word_start(words, "Goa"),
        "town": town.strip(),
        "town_at": word_start(words, "Patu"),
        "line_a": [
            (word_start(words, "and"), "And"),
            (word_start(words, "I've"), "I've"),
            (word_start(words, "been"), "been"),
            (word_start(words, "contributing"), "contributing"),
        ],
        "line_b": [
            (word_start(words, "Wikipedia"), "Wikipedia"),
            (word_start(words, "for"), "for"),
            (word_start(words, "two"), "two"),
            (word_start(words, "articles"), "articles"),
        ],
        "cards_at": word_start(words, "two"),
        "bibinka_at": word_start(words, "Bibinka"),
        "golba_at": word_start(words, "Golba"),
    }


def paint(frame, t, cues, fonts):
    name_f, place_f, cap_f, card_f = fonts
    im = frame.convert("RGBA")

    name = reveal(cues["name"], t, cues["name_at"], 0.72)
    if name:
        blit(im, text_sprite(name, name_f, INK), 80, 1348)

    growing_line(im, 80, 1436, 360, t, cues["school_at"], 0.32)

    school = reveal(cues["school"], t, cues["school_at"] + 0.08, 0.5)
    town = reveal(", " + cues["town"], t, cues["town_at"], 0.32)
    place = school + town
    if place:
        blit(im, text_sprite(place, place_f, MUTED), 80, 1456)

    # The contributing line leaves as Wikipedia takes its place.
    fade_out = ease((t - 6.05) / 0.22) if t >= 6.05 else 0
    a_alpha = int(255 * (1 - fade_out))
    text_a, slide_a = phrase(cues["line_a"], t, a_alpha)
    if text_a:
        blit(im, text_sprite(text_a, cap_f, WHITE, a_alpha), 80 + slide_a, 1708)

    text_b, slide_b = phrase(cues["line_b"], t, 255 if t >= cues["line_b"][0][0] else 0)
    if text_b:
        blit(im, text_sprite(text_b, cap_f, WHITE), 80 + slide_b, 1708)

    if t >= cues["cards_at"]:
        b1 = reveal("Bibinka", t, cues["bibinka_at"], 0.36)
        b2 = reveal("Golba", t, cues["golba_at"], 0.3)
        paste_pop(im, card_sprite(b1, card_f), 742, 1524, t, cues["cards_at"])
        paste_pop(im, card_sprite(b2, card_f), 950, 1524, t, cues["cards_at"])

    return im.convert("RGB")


def run(cmd):
    subprocess.run(cmd, check=True)


def main():
    meta = json.loads(META.read_text(encoding="utf-8"))
    cues = build_cues(meta)
    fonts = (
        ImageFont.truetype(FONT_BOLD, 58),
        ImageFont.truetype(FONT_REG, 34),
        ImageFont.truetype(FONT_REG, 42),
        ImageFont.truetype(FONT_BOLD, 28),
    )
    BASE.mkdir(parents=True, exist_ok=True)
    COMP.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(CUT), str(BASE / "%04d.png")])

    frames = sorted(BASE.glob("*.png"))
    if len(frames) != 250:
        raise SystemExit(f"expected 250 frames, got {len(frames)}")
    for i, path in enumerate(frames):
        t = i / FPS
        paint(Image.open(path), t, cues, fonts).save(COMP / path.name)

    run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-framerate", str(FPS), "-i", str(COMP / "%04d.png"),
        "-i", str(CUT),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
        "-c:a", "copy", "-shortest", str(FILM),
    ])
    run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "9.9", "-i", str(FILM), "-frames:v", "1", str(OUT / "talk-10s.jpg")])
    print(f"wrote {FILM}")


if __name__ == "__main__":
    main()
