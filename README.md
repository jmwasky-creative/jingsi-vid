# 静夜思 · 16-bit 像素 RPG

李白《静夜思》的竖屏短片，1080×1920。画面按 16-bit 像素 RPG 的语法来讲：原生 180×320，最近邻放大六倍，有限色板，对话框即字幕，芯片音乐。

旅人李白走到扬州城外的旅舍门前，打开存档。四句诗是四条存档，选中一条就闪回那一晚：

| 场景 | 画面 | 转场 |
| --- | --- | --- |
| 标题 | 夜空、明月、标题「静夜思」，闪烁的「开始」 | 色板逐级亮起 |
| 旅舍门外 | 他走向门口。旁白交代开元十四年、扬州、二十六岁 | 马赛克进入 |
| 床前明月光 | 侧视客房，窗棂、床榻，月光以 50% 棋盘格铺到床前 | 马赛克 |
| 疑是地上霜 | 同一间房，暖色收成霜蓝色，光斑里长出冰晶，他跪下去看 | 马赛克，色板在切换中途换掉 |
| 举头望明月 | 镜头按整数像素抬起，穿过窗棂，停在同一轮金月上 | 马赛克 |
| 低头思故乡 | 暖色满屏。故乡的屋檐、灯笼和门口等他的人。他走过去，低下头 | 马赛克 |
| 存档 | 回到旅舍门前。四条存档随全诗逐条点亮，光标停在「思故乡」，不另建新档 | 马赛克，菜单滑入再滑出 |

明月的金色和衣袍的紫色不参与换色，两个时代里都还是同一个人、同一轮月。片头片尾用四档色板淡入淡出，不用透明度。

- `output/jingyesi.mp4`：成片，1080×1920，24fps。本地渲染，不纳入版本库。
- `output/cover.jpg`：存档画面封面
- `index.html`：同一支片子的网页播放版
- `narration/`：旁白

像素字是 [Fusion Pixel 12px](https://github.com/TakWolf/fusion-pixel-font)（SIL Open Font License，见 `fonts/OFL.txt`）。

## 口播试片

10 秒真人出镜。口播先拆成一帧一张底图，再按她说出的词，在脸下面的黑带里画解说：名字写出来，学校和地名跟着出现，当前这句往外推，说到 two 时右侧冒出两张卡片，Bibinka 和 Golba 分别写入。

```bash
python3 scripts/wrap_talk.py media/interview.webm --start 9.36 --duration 10
python3 scripts/wrap_frames.py
```

成片在 `output/talk-10s.mp4`，不纳入版本库。这一段用的是 Wikimedia Commons 上 Subhashish Panigrahi 拍摄的 Frania Pereira 访谈（CC BY-SA 3.0）。识别结果按模型听到的拼写保留。

另外五套动效可以直接在画面上拖：人物、文字、竖图流入、要点、金句。打开 `output/styles/index.html`，按住文字拖到新位置。动效例子在 `output/styles/inflow.gif`。

```bash
python3 scripts/style_boards.py
```

## 本地预览

```bash
npm run preview      # http://localhost:47219
```

通过本地服务器打开时，网页版会播放 `narration/` 里的旁白。直接打开 HTML 文件时，读不到录音，就改用浏览器的中文语音。

## 重新生成

需要 Node 18+、ffmpeg 和 Chrome（默认 `/usr/local/bin/google-chrome`，可用 `CHROME=` 覆盖）。

```bash
npm install
python3 scripts/tts.py   # 可选：重新合成旁白，并把时长写回 index.html
npm run stills           # 导出关键帧到 output/
npm run render           # 逐帧导出、混音，合成 output/jingyesi.mp4
```

旁白使用 [Kokoro-82M-v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh)（男声 `zm_031`）。全片时间线按旁白时长排在 `index.html` 的 `TL` 里。
