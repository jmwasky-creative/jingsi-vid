# 静夜思 · 古诗动画视频

李白《静夜思》的 48 秒古诗动画：月夜山水、月光、地上霜、举头望月、故乡灯火，诗句以书法字体从右至左逐字“晕墨”浮现，配白话释义与五声音阶古筝风配乐，结尾落款钤印。

画面与音乐全部由代码生成（Canvas 2D + Web Audio），没有使用任何外部素材。

- `output/jingyesi.mp4`：成片，1920×1080，30fps，H.264 + AAC
- `output/cover.jpg`：封面图
- `index.html`：同一段动画的网页播放版（自带配乐，点击播放）

## 本地预览

```bash
npm run preview      # http://localhost:47219
```

## 重新渲染视频

需要 Node 18+、ffmpeg 和 Chrome（默认路径 `/usr/local/bin/google-chrome`，可用 `CHROME=` 覆盖）。

```bash
npm install
npm run stills       # 导出几张关键帧到 output/ 方便检查
npm run render       # 逐帧导出并合成 output/jingyesi.mp4
```

渲染脚本 `scripts/render.mjs` 用无头 Chrome 打开 `index.html?render`，逐帧调用 `renderFrame(t)` 导出画面，用 `OfflineAudioContext` 离线渲染配乐，最后交给 ffmpeg 合成。

## 时间线

| 时间 | 内容 |
| --- | --- |
| 0–6s | 夜幕、明月升起，标题与作者 |
| 6–14s | 床前明月光：月光洒落 |
| 14–22s | 疑是地上霜：水面与岸边泛起霜光 |
| 22–30s | 举头望明月：镜头上摇，明月变大 |
| 30–38s | 低头思故乡：镜头回落，村庄与小屋亮起暖灯 |
| 38–48s | 全诗呈现，钤印，淡出 |

字体：[马善政楷书 Ma Shan Zheng](https://fonts.google.com/specimen/Ma+Shan+Zheng)（SIL Open Font License）。
