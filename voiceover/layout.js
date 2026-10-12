export const WIDTH = 1080;
export const HEIGHT = 1920;
export const PANEL_WIDTH = 952;
export const PANEL_HEIGHT = 250;
export const MIN_SCALE = 0.35;
export const MAX_SCALE = 1.1;
export const DEFAULT_LAYOUT = Object.freeze({ x: 64, y: 1580, scale: 1 });

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function normalizeLayout(input = {}) {
  const scale = clamp(numberOr(input?.scale, DEFAULT_LAYOUT.scale), MIN_SCALE, MAX_SCALE);
  return {
    x: clamp(numberOr(input?.x, DEFAULT_LAYOUT.x), 0, WIDTH - PANEL_WIDTH * scale),
    y: clamp(numberOr(input?.y, DEFAULT_LAYOUT.y), 0, HEIGHT - PANEL_HEIGHT * scale),
    scale,
  };
}

export function getCueLayout(cue) {
  return normalizeLayout(cue?.layout);
}

export function validateLayout(layout) {
  if (layout === undefined) return;
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) throw new Error('布局必须是对象');
  for (const key of ['x', 'y', 'scale']) {
    if (typeof layout[key] !== 'number' || !Number.isFinite(layout[key])) throw new Error(`布局 ${key} 必须为数字`);
  }
  const normalized = normalizeLayout(layout);
  for (const key of ['x', 'y', 'scale']) {
    if (Math.abs(normalized[key] - layout[key]) > 0.001) throw new Error('卡片位置或缩放超出画面范围');
  }
}
