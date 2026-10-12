# 口播视频科技感包装

这套渲染流程在口播人物持续播放的基础上，用 Canvas 绘制科技感信息层，由 Puppeteer 逐帧截图，再由 FFmpeg 合成为 1080×1920、15fps 的 H.264 + AAC 竖屏视频。源视频的原声和已经烧录在画面里的字幕都会保留；不会另外合成旁白或重排字幕。

时间线配置见 `voiceover/project.json`。六个提示卡根据 SRT 的语义和时间出现，不采用字幕里无法确认的产品名。`setup` 卡片里的“安装 → 配置 → 运行”只是对技术门槛的概念说明，不表示源视频提到的任何产品已经实现这些步骤。

## 环境

- Node.js 18+
- Chrome 或 Chromium
- FFmpeg（命令行可直接运行 `ffmpeg`）

先安装仓库依赖：

```bash
npm install
```

如果 Chrome 不在脚本的默认位置，可在运行前通过 `CHROME` 环境变量指定可执行文件。

## 渲染

所有路径都建议加引号，以兼容空格和中文：

```bash
node scripts/render-voiceover.mjs \
  --video "/path/to/input.mov" \
  --subtitles "/path/to/input.srt" \
  --project "voiceover/project.json" \
  --out "output/voiceover"
```

也可以通过 npm 脚本传入同样的参数：

```bash
npm run voiceover -- \
  --video "/path/to/input.mov" \
  --subtitles "/path/to/input.srt" \
  --project "voiceover/project.json" \
  --out "output/voiceover"
```

加上 `--stills` 会导出关键帧预览，适合在完整编码前检查卡片、人物和字幕是否互相遮挡：

```bash
npm run voiceover:stills -- \
  --video "/path/to/input.mov" \
  --subtitles "/path/to/input.srt" \
  --project "voiceover/project.json" \
  --out "output/voiceover"
```

`--out` 接收输出目录，成片固定写为该目录下的 `voiceover.mp4`。默认项目配置是 `voiceover/project.json`，默认输出目录是 `output/voiceover`，因此默认成片为 `output/voiceover/voiceover.mp4`。渲染结果和关键帧是本地生成物，放在 `output/` 下并排除在版本控制之外。

## 画面与声音

源视频会按完整显示的方式等比放大到 1080×1920，未覆盖的边缘使用背景填充，不裁切人物画面。480×854 的源素材接近同一竖屏比例，因此留边很小。放大不会增加人物画面的真实细节，清晰度上限仍由源素材决定；Canvas 绘制的文字和线条会保持输出分辨率的锐度。

信息面板位于画布底部约 `y=1580–1830`。源字幕大约出现在 `y=1480`，这一区域是人工设定的安全区，不是自动字幕避让。更换素材、字体或字幕位置后，应先用 `--stills` 手动检查。

## 拖动调整位置

```bash
npm run voiceover:edit -- \
  --video "/path/to/input.mov" \
  --subtitles "/path/to/input.srt"
```

打开终端显示的本机地址（默认 `http://127.0.0.1:47220/`）。选择一段动画后，在真人画面上拖动卡片，拖右下角手柄等比缩放，也可以直接输入 X/Y 坐标。每段分别调整，或将当前布局应用到全部动画；“重置”只恢复当前段。

点击“保存”将位置写入 `voiceover/project.json`，或使用 `--project` 指定其他项目。每段的 `layout` 保存 `{x, y, scale}`，坐标基于 1080×1920；未设置时采用原位置 `{x:64, y:1580, scale:1}`。缩放范围为35%–110%，调整时卡片保持在画面内。播放预览按视频时间更新动画，原字幕来自视频本身。

保存配置会影响下一次渲染，已经导出的 MP4 需重新运行 `npm run voiceover` 才会更新。编辑器也可导出 JSON，指定 `--project` 后用于后续渲染。快捷键：方向键移动1像素、Shift+方向键移动10像素、Cmd/Ctrl+S保存。

15fps 可以把约 43.7 秒视频的逐帧渲染量降到 30fps 的一半，适合以口播和轻量界面动效为主的包装；代价是快速手势、人物移动和高频动画不如 30fps 顺滑。FFmpeg 会优先原样复制兼容的 AAC 音轨；源音轨不适合直接封装时，才重新编码为 AAC。

## 可复现性

固定同一份源视频、SRT、`project.json`、Node 依赖和 Chrome/FFmpeg 版本后，运行上述命令即可重复生成相同时间线的成片。SRT 只用于校验和定位提示卡语义；画面中实际显示的原字幕来自源视频像素。若源文件时长、分辨率或字幕烧录位置不同，应先更新时间线并重新检查关键帧。
