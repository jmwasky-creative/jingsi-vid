"""Synthesize narration clips with Kokoro (hexgrad/Kokoro-82M-v1.1-zh) and
write their durations into the CLIPS block of index.html."""
import json
import re
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KModel, KPipeline

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "narration"
REPO = "hexgrad/Kokoro-82M-v1.1-zh"
VOICE = "zm_031"
SR = 24000

POEM = ["床前明月光", "疑是地上霜", "举头望明月", "低头思故乡"]
POEM_SPEED = 0.62

# Short isolated lines come out garbled, so p1–p4 are cut from one slow reading of the whole poem.
CLIPS = [
    ("c0", "公元七二六年，深秋。扬州城外的一间旅舍里，二十六岁的李白，独在异乡，夜不能寐。", 0.9),
    ("n1", "月光穿过窗棂，悄无声息地，铺满了床前。", 0.9),
    ("n2", "那一片清辉，白得发冷。恍惚之间，他竟以为，是地上结了一层秋霜。", 0.9),
    ("n3", "他抬起头。一轮明月，高悬天际。千里之外的故乡，此刻，也被这同一轮月光照着。", 0.9),
    ("n4", "低下头，思绪便飞回了故乡。那里的炊烟，那里的灯火，还有那些，等他回家的人。", 0.9),
    ("n5", "二十个字，一轮明月，照亮了一千三百年的乡愁。", 0.88),
]
ORDER = ["c0", "p1", "n1", "p2", "n2", "p3", "n3", "p4", "n4", "p5", "n5"]


def trim(a, thr=0.01, pad=0.08):
    idx = np.where(np.abs(a) > thr)[0]
    if not len(idx):
        return a
    s, e = max(0, idx[0] - int(pad * SR)), min(len(a), idx[-1] + int(pad * SR))
    return a[s:e]


def split_points(a, n=3, frame=0.02):
    """Midpoints of the n longest pauses in a."""
    fr = int(frame * SR)
    quiet = [np.sqrt((a[i:i + fr] ** 2).mean()) < 0.01 for i in range(0, len(a) - fr, fr)]
    runs, start = [], None
    for i, q in enumerate(quiet + [False]):
        if q and start is None:
            start = i
        elif not q and start is not None:
            runs.append((i - start, (start + i) // 2 * fr))
            start = None
    return sorted(p for _, p in sorted(runs, reverse=True)[:n])


def main():
    OUT.mkdir(exist_ok=True)
    model = KModel(repo_id=REPO).eval()
    en = KPipeline(lang_code="a", repo_id=REPO, model=False)
    zh = KPipeline(lang_code="z", repo_id=REPO, model=model,
                   en_callable=lambda t: next(en(t)).phonemes)
    say = lambda text, speed: np.concatenate([r.audio.numpy() for r in zh(text, voice=VOICE, speed=speed)])
    clips = {cid: (text, trim(say(text, speed))) for cid, text, speed in CLIPS}

    full = trim(say(f"{POEM[0]}，{POEM[1]}。{POEM[2]}，{POEM[3]}。", POEM_SPEED))
    clips["p5"] = ("，".join(POEM[:2]) + "。" + "，".join(POEM[2:]) + "。", full)
    for i, (s, e) in enumerate(zip([0] + (cuts := split_points(full)), cuts + [len(full)])):
        clips[f"p{i + 1}"] = (POEM[i] + "。", trim(full[s:e]))

    meta = []
    for cid in ORDER:
        text, audio = clips[cid]
        audio = audio / max(1e-6, np.abs(audio).max()) * 0.9
        sf.write(OUT / f"{cid}.wav", audio, SR, subtype="PCM_16")
        meta.append({"id": cid, "text": text, "dur": round(len(audio) / SR, 3)})
        print(cid, meta[-1]["dur"], text)
    (OUT / "clips.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    html = ROOT / "index.html"
    src = html.read_text()
    block = "/*CLIPS*/" + json.dumps(meta, ensure_ascii=False, separators=(",", ":")) + "/*END*/"
    html.write_text(re.sub(r"/\*CLIPS\*/.*?/\*END\*/", lambda _: block, src, flags=re.S))


if __name__ == "__main__":
    main()
