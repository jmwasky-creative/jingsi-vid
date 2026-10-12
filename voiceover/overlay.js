(() => {
  "use strict";

  const WIDTH = 1080;
  const HEIGHT = 1920;
  const PANEL = { x: 64, y: 1580, w: 952, h: 250, radius: 34 };
  const MOTION_SECONDS = 0.2;
  const CYAN = "#55e6ee";
  const OFF_WHITE = "#f5f2e9";
  const MUTED = "#b9c3c8";
  const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  const VALID_KINDS = new Set([
    "intro",
    "accessible",
    "setup",
    "ready",
    "computer",
    "dialogue",
  ]);

  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha: true });
  let project = emptyProject();

  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  document.body.classList.toggle("render", new URLSearchParams(location.search).has("render"));

  function emptyProject() {
    return { version: 1, width: WIDTH, height: HEIGHT, fps: 15, cues: [] };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function easeOutCubic(value) {
    return 1 - Math.pow(1 - value, 3);
  }

  function easeInCubic(value) {
    return value * value * value;
  }

  function roundedRect(context, x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
  }

  function cueMotion(cue, time) {
    const entering = clamp((time - cue.start) / MOTION_SECONDS, 0, 1);
    const leaving = clamp((cue.end - time) / MOTION_SECONDS, 0, 1);
    const alpha = Math.min(easeOutCubic(entering), easeInCubic(leaving));
    return {
      alpha,
      offsetY: (1 - easeOutCubic(entering)) * 20 + (1 - leaving) * 8,
    };
  }

  function strokeLine(points, width = 4, color = CYAN) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  function drawDot(x, y, radius = 6, fill = CYAN) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawSegment(from, to, progress, width = 5) {
    const p = clamp(progress, 0, 1);
    strokeLine([
      from,
      [from[0] + (to[0] - from[0]) * p, from[1] + (to[1] - from[1]) * p],
    ], width);
  }

  function phase(progress, start, end) {
    return clamp((progress - start) / (end - start), 0, 1);
  }

  function drawIcon(kind, x, y, progress) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = CYAN;
    ctx.fillStyle = CYAN;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (kind === "intro") {
      ctx.beginPath();
      ctx.arc(0, 0, 45, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * phase(progress, 0, 0.72));
      ctx.stroke();
      const play = phase(progress, 0.52, 1);
      ctx.globalAlpha *= play;
      ctx.beginPath();
      ctx.moveTo(-14 * play, -22 * play);
      ctx.lineTo(21 * play, 0);
      ctx.lineTo(-14 * play, 22 * play);
      ctx.closePath();
      ctx.stroke();
    } else if (kind === "accessible") {
      const head = phase(progress, 0, 0.24);
      ctx.beginPath();
      ctx.arc(0, -34, 9 * head, 0, Math.PI * 2);
      ctx.fill();
      const body = phase(progress, 0.18, 0.54);
      drawSegment([0, -1], [0, 30], body);
      const limbs = phase(progress, 0.42, 1);
      drawSegment([0, -1], [-38, -13], limbs);
      drawSegment([0, -1], [38, -13], limbs);
      drawSegment([0, 30], [-24, 51], limbs);
      drawSegment([0, 30], [25, 51], limbs);
    } else if (kind === "setup") {
      const first = phase(progress, 0, 0.34);
      const second = phase(progress, 0.28, 0.68);
      const third = phase(progress, 0.62, 1);
      drawSegment([-38, -31], [-8, -31], first, 4);
      drawSegment([-8, -31], [-8, 0], first, 4);
      if (first > 0) drawDot(-38, -31, 8 * first);
      drawSegment([-8, 0], [21, 0], second, 4);
      drawSegment([21, 0], [21, 31], second, 4);
      if (second > 0) drawDot(-8, 0, 8 * second);
      drawSegment([21, 31], [43, 31], third, 4);
      if (third > 0) drawDot(21, 31, 8 * third);
    } else if (kind === "ready") {
      ctx.beginPath();
      ctx.arc(0, 0, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * phase(progress, 0, 0.62));
      ctx.stroke();
      const checkOne = phase(progress, 0.48, 0.74);
      const checkTwo = phase(progress, 0.7, 1);
      drawSegment([-24, 1], [-6, 20], checkOne, 6);
      if (checkOne >= 1) drawSegment([-6, 20], [27, -20], checkTwo, 6);
    } else if (kind === "computer") {
      roundedRect(ctx, -48, -37, 96, 66, 10);
      ctx.stroke();
      strokeLine([[0, 29], [0, 44]], 5);
      strokeLine([[-24, 45], [24, 45]], 5);
      const prompt = phase(progress, 0.08, 0.42);
      drawSegment([-27, -12], [-13, 0], prompt, 4);
      drawSegment([-13, 0], [-27, 12], prompt, 4);
      const typed = Math.min(3, Math.floor(phase(progress, 0.36, 0.94) * 3.99));
      for (let i = 0; i < typed; i += 1) drawDot(-2 + i * 15, 12, 4);
    } else {
      roundedRect(ctx, -49, -34, 98, 63, 18);
      ctx.stroke();
      drawSegment([-18, 29], [-31, 45], phase(progress, 0.1, 0.5), 5);
      drawSegment([-31, 45], [2, 29], phase(progress, 0.42, 0.74), 5);
      const spoken = Math.min(3, Math.floor(phase(progress, 0.12, 0.88) * 3.99));
      for (let i = 0; i < spoken; i += 1) drawDot(-23 + i * 23, -3, 5);
    }

    ctx.restore();
  }

  function fitText(text, maxWidth, initialSize, minimumSize, weight) {
    let size = initialSize;
    ctx.font = `${weight} ${size}px ${FONT}`;
    while (size > minimumSize && ctx.measureText(text).width > maxWidth) {
      size -= 1;
      ctx.font = `${weight} ${size}px ${FONT}`;
    }
    return size;
  }

  function splitLines(text, maxWidth, maxLines) {
    const chars = Array.from(String(text || ""));
    const lines = [];
    let line = "";

    for (const char of chars) {
      const candidate = line + char;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = char;
        if (lines.length === maxLines) break;
      } else {
        line = candidate;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);

    const consumed = lines.join("").length;
    if (consumed < chars.length && lines.length) {
      let finalLine = lines[lines.length - 1];
      while (finalLine && ctx.measureText(`${finalLine}…`).width > maxWidth) {
        finalLine = finalLine.slice(0, -1);
      }
      lines[lines.length - 1] = `${finalLine}…`;
    }
    return lines;
  }

  function drawPanel(cue, time) {
    const motion = cueMotion(cue, time);
    if (motion.alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = motion.alpha;
    ctx.translate(0, motion.offsetY);

    ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 10;
    roundedRect(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, PANEL.radius);
    ctx.fillStyle = "rgba(10, 18, 24, 0.88)";
    ctx.fill();
    ctx.shadowColor = "transparent";

    const border = ctx.createLinearGradient(PANEL.x, PANEL.y, PANEL.x + PANEL.w, PANEL.y);
    border.addColorStop(0, "rgba(85, 230, 238, 0.72)");
    border.addColorStop(0.3, "rgba(85, 230, 238, 0.18)");
    border.addColorStop(1, "rgba(245, 242, 233, 0.08)");
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    roundedRect(ctx, PANEL.x + 1, PANEL.y + 1, PANEL.w - 2, PANEL.h - 2, PANEL.radius - 1);
    ctx.stroke();

    roundedRect(ctx, PANEL.x + 22, PANEL.y + 22, 142, PANEL.h - 44, 25);
    ctx.fillStyle = "rgba(85, 230, 238, 0.08)";
    ctx.fill();
    const iconProgress = easeOutCubic(clamp((time - cue.start) / 1, 0, 1));
    drawIcon(cue.kind, PANEL.x + 93, PANEL.y + 125, iconProgress);

    ctx.fillStyle = "rgba(85, 230, 238, 0.28)";
    ctx.fillRect(PANEL.x + 187, PANEL.y + 40, 2, PANEL.h - 80);

    const textX = PANEL.x + 224;
    const maxTextWidth = PANEL.w - 264;
    const title = String(cue.title || "");
    const titleSize = fitText(title, maxTextWidth, 58, 42, 600);
    ctx.font = `600 ${titleSize}px ${FONT}`;
    ctx.fillStyle = OFF_WHITE;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(title, textX, PANEL.y + 102);

    ctx.font = `400 32px ${FONT}`;
    ctx.fillStyle = MUTED;
    const lines = splitLines(cue.description, maxTextWidth, 2);
    lines.forEach((line, index) => {
      ctx.fillText(line, textX, PANEL.y + 158 + index * 43);
    });

    ctx.restore();
  }

  function normalizeProject(input) {
    if (!input || input.version !== 1 || !Array.isArray(input.cues)) {
      throw new TypeError("Project must be version 1 and include a cues array.");
    }

    const cues = input.cues.map((cue, index) => {
      const start = Number(cue.start);
      const end = Number(cue.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        throw new TypeError(`Cue ${index} must have finite start/end times with end > start.`);
      }
      return {
        id: String(cue.id ?? `cue-${index + 1}`),
        start,
        end,
        kind: VALID_KINDS.has(cue.kind) ? cue.kind : "dialogue",
        title: String(cue.title ?? ""),
        description: String(cue.description ?? ""),
      };
    });

    cues.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
    return {
      version: 1,
      width: WIDTH,
      height: HEIGHT,
      fps: Number.isFinite(Number(input.fps)) ? Number(input.fps) : 15,
      cues,
    };
  }

  function getActiveCue(time) {
    const t = Number(time);
    if (!Number.isFinite(t)) return null;
    return project.cues.find((cue) => t >= cue.start && t < cue.end) || null;
  }

  function renderFrame(time) {
    const t = Number(time);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (!Number.isFinite(t)) return;
    const cue = getActiveCue(t);
    if (cue) drawPanel(cue, t);
  }

  function setProject(nextProject) {
    project = normalizeProject(nextProject);
    renderFrame(0);
  }

  window.setProject = setProject;
  window.renderFrame = renderFrame;
  window.getActiveCue = getActiveCue;
  window.ready = document.fonts && document.fonts.ready
    ? document.fonts.ready.then(() => undefined)
    : Promise.resolve();

  window.ready.then(() => renderFrame(0));
})();
