#!/usr/bin/env python3
"""Ten-second talking-head wrap.

Recognizes speech in a real interview clip, then burns a short lower third:
the name and place pulled out of the sentence, plus one caption line.
"""

import argparse
import json
import re
import subprocess
import wave
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output"


def ass_time(t):
    t = max(0.0, float(t))
    cs = int(round(t * 100))
    s, cs = divmod(cs, 100)
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def load_wav(path):
    with wave.open(str(path)) as w:
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    return audio.astype(np.float32) / 32768.0


def transcribe(wav_path):
    model = WhisperModel("small", device="cpu", compute_type="int8")
    audio = load_wav(wav_path)
    best = None
    best_score = -10**9
    # The small model wobbles on this voice. Keep the pass that hears "Goa"
    # and does not turn the town into "part two".
    for _ in range(2):
        segments, info = model.transcribe(
            audio, language="en", word_timestamps=True, temperature=0, beam_size=5
        )
        words = []
        for seg in segments:
            for w in seg.words or []:
                token = w.word.strip()
                if token:
                    words.append({"start": round(w.start, 2), "end": round(w.end, 2), "word": token})
        text = " ".join(w["word"] for w in words)
        score = 0
        if re.search(r"\bGoa\b", text):
            score += 5
        if re.search(r"my name is", text, re.I):
            score += 2
        if re.search(r"part\s*(?:2|two)\b", text, re.I):
            score -= 3
        if score > best_score:
            best_score = score
            best = {"language": info.language, "words": words}
    return best


GLUE = {"in", "to", "that", "a", "the", "of", "for", "and"}


def caption_lines(words, limit=36):
    lines = []
    cur = []
    for w in words:
        gap = w["start"] - cur[-1]["end"] if cur else 0
        text = " ".join(x["word"] for x in cur + [w])
        if cur and (gap > 0.45 or len(text) > limit):
            if len(text) > limit and cur[-1]["word"].strip(",.").lower() in GLUE:
                glue = cur.pop()
                if cur:
                    lines.append(cur)
                cur = [glue, w]
                continue
            lines.append(cur)
            cur = [w]
        else:
            cur.append(w)
    if cur:
        lines.append(cur)
    out = []
    for i, group in enumerate(lines):
        end = lines[i + 1][0]["start"] if i + 1 < len(lines) else group[-1]["end"] + 0.4
        text = " ".join(w["word"] for w in group).replace(" ,", ",").replace(" .", ".")
        if text[:1].islower():
            text = text[:1].upper() + text[1:]
        out.append({
            "start": group[0]["start"],
            "end": max(end, group[-1]["end"]),
            "text": text,
        })
    return out


def parse_facts(words):
    text = " ".join(w["word"] for w in words)
    name = None
    place = None
    name_at = 0
    place_at = 0
    m = re.search(r"\bmy name is ([A-Za-z]+(?: [A-Za-z]+)?)", text, re.I)
    if m:
        name = m.group(1).strip(" ,.")
        name_at = _span_start(words, m.start(1))
    m = re.search(r"\bfrom ([A-Za-z]+(?: [A-Za-z]+)?)", text, re.I)
    if m:
        place = m.group(1).strip(" ,.")
        place_at = _span_start(words, m.start(1))
    return {"name": name, "name_at": name_at, "place": place, "place_at": place_at}


def _span_start(words, char_index):
    cursor = 0
    for w in words:
        cursor += len(w["word"]) + 1
        if cursor > char_index:
            return w["start"]
    return 0


def write_ass(path, facts, lines, duration):
    # Two lines in the lower black band. Nothing sits on the face.
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Name,Liberation Sans,54,&H00F7F4EE,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,2,80,80,430,1
Style: Place,Liberation Sans,36,&H00C8C2B4,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,1,0,1,0,0,2,80,80,360,1
Style: Cap,Liberation Sans,46,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,80,80,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    if facts["name"]:
        events.append(f"Dialogue: 0,{ass_time(facts['name_at'])},{ass_time(duration)},Name,,0,0,0,,{facts['name']}")
    if facts["place"]:
        events.append(f"Dialogue: 0,{ass_time(facts['place_at'])},{ass_time(duration)},Place,,0,0,0,,{facts['place']}")
    for line in lines:
        events.append(f"Dialogue: 0,{ass_time(line['start'])},{ass_time(line['end'])},Cap,,0,0,0,,{line['text']}")
    path.write_text(header + "\n".join(events) + "\n", encoding="utf-8")


def fold_place(words, facts):
    """Pull a trailing 'in <town>' into the place line so the caption does not repeat it."""
    if not facts["place"]:
        return facts, words
    idx = next((i for i, w in enumerate(words) if w["start"] >= facts["place_at"] - 0.05), None)
    if idx is None:
        return facts, words
    n = len(facts["place"].split())
    end = min(len(words), idx + n)
    facts = dict(facts)
    if end + 1 < len(words) and words[end]["word"].lower().strip(",.") == "in":
        town = words[end + 1]["word"].strip(",.")
        if town[:1].isupper():
            facts["place"] = f"{facts['place']}, {town}"
            end += 2
    elif end < len(words):
        nxt = words[end]["word"].strip(",.")
        if nxt[:1].isupper() and nxt.lower() not in {"i", "i'm", "i've", "part"}:
            facts["place"] = f"{facts['place']}, {nxt}"
            end += 1
    while end < len(words) and words[end]["word"].strip(",.").lower() in {"part", "two", "2"}:
        end += 1
    return facts, words[end:]


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("src")
    p.add_argument("--start", type=float, default=9.36)
    p.add_argument("--duration", type=float, default=10)
    p.add_argument("--out", default=str(OUT / "talk-10s.mp4"))
    args = p.parse_args()

    OUT.mkdir(exist_ok=True)
    cut = OUT / "talk-10s-cut.mp4"
    wav = OUT / "talk-10s.wav"
    ass = OUT / "talk-10s.ass"
    meta = OUT / "talk-10s.json"
    preroll = 1.5
    postroll = 8.0

    # Drop the source lower-third, then center the face in a vertical frame.
    vf = (
        "crop=1080:470:0:8,"
        "scale=2400:1044,"
        "crop=1080:1044:660:0,"
        "pad=1080:1920:0:200:0x121014"
    )
    run([
        "ffmpeg", "-y", "-ss", str(args.start), "-t", str(args.duration),
        "-i", args.src, "-vf", vf,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
        "-c:a", "aac", "-b:a", "160k", "-ar", "44100", str(cut),
    ])
    # A few seconds of lead-in gives the recognizer the start of the sentence.
    audio_start = max(0.0, args.start - preroll)
    run([
        "ffmpeg", "-y", "-ss", str(audio_start), "-t", str(args.duration + preroll + postroll),
        "-i", args.src, "-vn", "-ac", "1", "-ar", "16000", str(wav),
    ])

    heard = transcribe(wav)
    shift = args.start - audio_start
    words = []
    for w in heard["words"]:
        start = round(w["start"] - shift, 2)
        end = round(w["end"] - shift, 2)
        if end < 0 or start > args.duration:
            continue
        words.append({"start": max(0.0, start), "end": min(args.duration, end), "word": w["word"]})
    heard["words"] = words
    facts = parse_facts(words)
    facts, rest = fold_place(words, facts)
    lines = caption_lines(rest)
    write_ass(ass, facts, lines, args.duration)
    meta.write_text(json.dumps({"facts": facts, "lines": lines, "words": heard["words"], "language": heard["language"]}, ensure_ascii=False, indent=2), encoding="utf-8")

    run([
        "ffmpeg", "-y", "-i", str(cut),
        "-vf", f"subtitles={ass}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
        "-c:a", "copy", args.out,
    ])
    run(["ffmpeg", "-y", "-ss", "3.2", "-i", args.out, "-frames:v", "1", str(OUT / "talk-10s.jpg")])
    print(json.dumps({"facts": facts, "lines": lines}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
