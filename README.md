# 静夜思 · 古诗动画视频

本分支还提供真人口播的透明动画包装：保留原视频和原声，按字幕时间叠加科技风信息卡，默认输出 1080×1920、15fps。使用方法见 [口播包装说明](voiceover/README.md)。

李白《静夜思》的竖屏古诗动画，1080×1920，约 85 秒，带男声旁白、诗句朗诵、配乐和字幕。四句诗各有一个独立场景：

| 场景 | 画面 | 转场 |
| --- | --- | --- |
| 序 | 墨色在黑暗中晕开，一道光环画出明月，标题浮现；旁白交代扬州旅舍、二十六岁的李白 | — |
| 床前明月光 | 旅舍内景：月光穿过窗棂，在床前投下格子光影，光柱里浮尘飘动，灯盏残烟袅袅 | 水墨晕染 |
| 疑是地上霜 | 俯视地板上的月光，冰晶从光斑里生长、蔓延，雪花与霜光闪烁，画面转冷 | 推镜入光斑 |
| 举头望明月 | 镜头上摇：银河、云层向两侧散开，巨大的明月与月晕，诗人站在栏杆前仰望，檐角风铃轻摆 | 仰摇 |
| 低头思故乡 | 水中月影，一滴水落下，涟漪荡开后化作故乡：暖色暮光、炊烟、灯火、孔明灯、门口提灯等候的人 | 水墨晕染 + 涟漪 |
| 合 | 宣纸上水墨远山、淡月，全诗逐字书写，旁白收尾，钤印「李白」 | 白光 |

画面和音乐全部由代码生成（Canvas 2D + Web Audio），没有使用外部图片素材。

- `output/jingyesi.mp4`：成片，1080×1920，30fps，H.264 + AAC。这个文件在本地渲染生成，不纳入版本库。
- `output/cover.jpg`：封面图
- `index.html`：同一段动画的网页播放版
- `narration/`：旁白音频与时长（`clips.json`）

## 本地预览

```bash
npm run preview      # http://localhost:47219
```

通过本地服务器打开时，网页版会播放 `narration/` 里的旁白录音；如果直接双击打开 HTML 文件（读不到录音），会改用浏览器自带的中文语音朗读。

## 重新生成

需要 Node 18+、ffmpeg 和 Chrome（默认 `/usr/local/bin/google-chrome`，可用 `CHROME=` 覆盖）。

```bash
npm install
python3 scripts/tts.py   # 可选：重新合成旁白，并把时长写回 index.html
npm run stills           # 导出每个场景的关键帧到 output/
npm run render           # 逐帧导出、混音，合成 output/jingyesi.mp4
```

旁白使用开源语音模型 [Kokoro-82M-v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh)（男声 `zm_031`），需要 `pip install torch kokoro "misaki[zh]" soundfile`。四句诗的单句朗读是从整首慢读中按停顿切出来的，单独合成的短句容易吞字。

全片时间线根据旁白时长自动排布（见 `index.html` 里的 `TL`），改了旁白文案后重新跑 `tts.py` 即可。

字体：[马善政楷书 Ma Shan Zheng](https://fonts.google.com/specimen/Ma+Shan+Zheng)（SIL Open Font License）。
