import {
  DEFAULT_LAYOUT,
  PANEL_HEIGHT,
  PANEL_WIDTH,
  MIN_SCALE,
  MAX_SCALE,
  normalizeLayout,
} from './layout.js';

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;

const elements = {
  stage: document.querySelector('#stage'),
  video: document.querySelector('#video'),
  overlay: document.querySelector('#overlay'),
  selection: document.querySelector('#selection'),
  resizeHandle: document.querySelector('#resizeHandle'),
  stageMessage: document.querySelector('#stageMessage'),
  sourceName: document.querySelector('#sourceName'),
  playButton: document.querySelector('#playButton'),
  currentTime: document.querySelector('#currentTime'),
  timeSlider: document.querySelector('#timeSlider'),
  duration: document.querySelector('#duration'),
  subtitle: document.querySelector('#subtitle'),
  cueCount: document.querySelector('#cueCount'),
  cueList: document.querySelector('#cueList'),
  selectedCueTitle: document.querySelector('#selectedCueTitle'),
  xInput: document.querySelector('#xInput'),
  yInput: document.querySelector('#yInput'),
  scaleInput: document.querySelector('#scaleInput'),
  scaleOutput: document.querySelector('#scaleOutput'),
  resetButton: document.querySelector('#resetButton'),
  applyAllButton: document.querySelector('#applyAllButton'),
  saveButton: document.querySelector('#saveButton'),
  exportButton: document.querySelector('#exportButton'),
  saveStatus: document.querySelector('#saveStatus'),
};

let project = null;
let subtitles = [];
let selectedCueId = null;
let dirty = false;
let saving = false;
let overlayReady = false;
let frameRequest = 0;
let pointerOperation = null;
let activeCueId = null;
let changeVersion = 0;

function formatTime(seconds) {
  const safe = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
}

function selectedCue() {
  return project?.cues.find((cue) => cue.id === selectedCueId) || null;
}

function setStatus(message, kind = '') {
  elements.saveStatus.textContent = message;
  elements.saveStatus.dataset.kind = kind;
}

function markDirty() {
  changeVersion += 1;
  dirty = true;
  elements.saveButton.disabled = !project || saving;
  setStatus('有未保存的修改', 'dirty');
}

function setSaved(message = '已保存到 project.json') {
  dirty = false;
  elements.saveButton.disabled = true;
  setStatus(message, 'success');
}

function updateInspector() {
  const cue = selectedCue();
  const enabled = Boolean(cue);
  for (const control of [elements.xInput, elements.yInput, elements.scaleInput, elements.resetButton, elements.applyAllButton]) {
    control.disabled = !enabled;
  }
  if (!cue) {
    elements.selectedCueTitle.textContent = '选择一张卡片';
    elements.xInput.value = '';
    elements.yInput.value = '';
    elements.scaleOutput.value = '100%';
    return;
  }
  const layout = normalizeLayout(cue.layout);
  elements.selectedCueTitle.textContent = cue.title || '未命名卡片';
  elements.xInput.value = String(Math.round(layout.x));
  elements.yInput.value = String(Math.round(layout.y));
  elements.xInput.max = String(Math.floor(CANVAS_WIDTH - PANEL_WIDTH * layout.scale));
  elements.yInput.max = String(Math.floor(CANVAS_HEIGHT - PANEL_HEIGHT * layout.scale));
  elements.scaleInput.value = String(layout.scale);
  elements.scaleOutput.value = `${Math.round(layout.scale * 100)}%`;
}

function updateSelection() {
  const cue = selectedCue();
  const time = elements.video.currentTime || 0;
  if (!cue || !elements.video.paused || time < cue.start || time >= cue.end) {
    elements.selection.hidden = true;
    return;
  }
  const layout = normalizeLayout(cue.layout);
  elements.selection.hidden = false;
  elements.selection.style.left = `${layout.x / CANVAS_WIDTH * 100}%`;
  elements.selection.style.top = `${layout.y / CANVAS_HEIGHT * 100}%`;
  elements.selection.style.width = `${PANEL_WIDTH * layout.scale / CANVAS_WIDTH * 100}%`;
  elements.selection.style.height = `${PANEL_HEIGHT * layout.scale / CANVAS_HEIGHT * 100}%`;
}

function refreshCueStates() {
  for (const node of elements.cueList.querySelectorAll('.cue-item')) {
    node.classList.toggle('selected', node.dataset.id === selectedCueId);
    node.classList.toggle('active', node.dataset.id === activeCueId);
    node.setAttribute('aria-selected', String(node.dataset.id === selectedCueId));
  }
}

function renderCueList() {
  elements.cueList.replaceChildren();
  elements.cueCount.textContent = String(project.cues.length);
  project.cues.forEach((cue, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cue-item';
    button.dataset.id = cue.id;
    button.setAttribute('role', 'option');
    button.innerHTML = `
      <span class="cue-index">${String(index + 1).padStart(2, '0')}</span>
      <span class="cue-copy">
        <strong>${escapeHtml(cue.title || '未命名卡片')}</strong>
        <small>${formatTime(cue.start)} — ${formatTime(cue.end)}</small>
      </span>
      <span class="cue-arrow" aria-hidden="true">›</span>
    `;
    button.addEventListener('click', () => selectCue(cue.id, true));
    elements.cueList.append(button);
  });
  refreshCueStates();
}

function escapeHtml(value) {
  const node = document.createElement('span');
  node.textContent = String(value);
  return node.innerHTML;
}

async function syncOverlay() {
  if (!project || !overlayReady) return;
  try {
    elements.overlay.contentWindow.setProject(project);
    elements.overlay.contentWindow.renderFrame(elements.video.currentTime || 0);
  } catch (error) {
    console.error('叠加层更新失败', error);
    elements.stageMessage.textContent = '卡片预览暂时不可用';
    elements.stageMessage.hidden = false;
  }
}

function renderCurrentFrame() {
  if (!project || !overlayReady) return;
  const time = elements.video.currentTime || 0;
  elements.overlay.contentWindow.renderFrame(time);
  const activeCue = elements.overlay.contentWindow.getActiveCue(time);
  const nextActiveId = activeCue?.id || null;
  let selectedChanged = false;
  if (activeCue && selectedCueId !== activeCue.id && !pointerOperation) {
    selectedCueId = activeCue.id;
    updateInspector();
    selectedChanged = true;
  }
  if (nextActiveId !== activeCueId) {
    activeCueId = nextActiveId;
    refreshCueStates();
  } else if (selectedChanged) {
    refreshCueStates();
  }
  updateTransport(time);
  updateSubtitle(time);
  updateSelection();
}

function updateTransport(time = elements.video.currentTime || 0) {
  elements.currentTime.textContent = formatTime(time);
  if (!elements.timeSlider.matches(':active')) elements.timeSlider.value = String(time);
}

function updateSubtitle(time) {
  const line = subtitles.find((item) => time >= item.start && time < item.end);
  elements.subtitle.textContent = line?.text || '';
}

function playbackLoop() {
  renderCurrentFrame();
  if (!elements.video.paused && !elements.video.ended) {
    frameRequest = requestAnimationFrame(playbackLoop);
  }
}

function selectCue(id, seek) {
  const cue = project.cues.find((item) => item.id === id);
  if (!cue) return;
  selectedCueId = cue.id;
  if (seek) {
    elements.video.pause();
    const cueTime = (cue.start + cue.end) / 2;
    if (elements.video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      elements.video.currentTime = cueTime;
    } else {
      elements.video.addEventListener('loadedmetadata', () => {
        elements.video.currentTime = cueTime;
        renderCurrentFrame();
      }, { once: true });
    }
  }
  updateInspector();
  updateSelection();
  refreshCueStates();
  renderCurrentFrame();
}

function updateSelectedLayout(nextLayout, { refreshInputs = true } = {}) {
  const cue = selectedCue();
  if (!cue) return;
  cue.layout = normalizeLayout(nextLayout);
  if (refreshInputs) updateInspector();
  updateSelection();
  markDirty();
  syncOverlay();
}

function canvasPoint(event) {
  const rect = elements.stage.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * CANVAS_WIDTH / rect.width,
    y: (event.clientY - rect.top) * CANVAS_HEIGHT / rect.height,
  };
}

function beginPointerOperation(event, type) {
  if (event.button !== 0) return;
  const cue = selectedCue();
  if (!cue || !elements.video.paused) return;
  event.preventDefault();
  const point = canvasPoint(event);
  const layout = normalizeLayout(cue.layout);
  pointerOperation = { type, pointerId: event.pointerId, start: point, layout };
  elements.selection.setPointerCapture(event.pointerId);
  elements.selection.classList.add('dragging');
}

function movePointerOperation(event) {
  if (!pointerOperation || pointerOperation.pointerId !== event.pointerId) return;
  const point = canvasPoint(event);
  const dx = point.x - pointerOperation.start.x;
  const dy = point.y - pointerOperation.start.y;
  if (pointerOperation.type === 'move') {
    updateSelectedLayout({
      ...pointerOperation.layout,
      x: pointerOperation.layout.x + dx,
      y: pointerOperation.layout.y + dy,
    });
    return;
  }
  const diagonalSquared = PANEL_WIDTH ** 2 + PANEL_HEIGHT ** 2;
  const scaleDelta = (dx * PANEL_WIDTH + dy * PANEL_HEIGHT) / diagonalSquared;
  updateSelectedLayout({
    ...pointerOperation.layout,
    scale: pointerOperation.layout.scale + scaleDelta,
  });
}

function endPointerOperation(event) {
  if (!pointerOperation || pointerOperation.pointerId !== event.pointerId) return;
  pointerOperation = null;
  elements.selection.classList.remove('dragging');
}

async function saveProject() {
  if (!project || saving) return;
  saving = true;
  const savedVersion = changeVersion;
  elements.saveButton.disabled = true;
  setStatus('正在保存…', 'saving');
  try {
    const response = await fetch('/api/project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project, null, 2),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) {
      throw new Error(result?.error || `服务器返回 ${response.status}`);
    }
    if (changeVersion === savedVersion) {
      setSaved();
    } else {
      dirty = true;
      setStatus('已保存较早版本，仍有未保存的修改', 'dirty');
    }
  } catch (error) {
    setStatus(`保存失败：${error.message}`, 'error');
    elements.saveButton.disabled = false;
  } finally {
    saving = false;
    elements.saveButton.disabled = !dirty;
  }
}

function exportProject() {
  if (!project) return;
  const blob = new Blob([`${JSON.stringify(project, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'project.json';
  link.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  elements.video.addEventListener('loadedmetadata', () => {
    elements.timeSlider.max = String(elements.video.duration || 1);
    elements.timeSlider.disabled = false;
    elements.playButton.disabled = false;
    elements.duration.textContent = formatTime(elements.video.duration);
    elements.stageMessage.hidden = true;
    renderCurrentFrame();
  });
  elements.video.addEventListener('error', () => {
    elements.stageMessage.textContent = '无法载入源视频，请确认本地编辑服务已配置视频文件';
    elements.stageMessage.hidden = false;
    elements.playButton.disabled = true;
    elements.timeSlider.disabled = true;
  });
  elements.video.addEventListener('play', () => {
    elements.playButton.textContent = '❚❚';
    elements.playButton.setAttribute('aria-label', '暂停');
    updateSelection();
    cancelAnimationFrame(frameRequest);
    playbackLoop();
  });
  elements.video.addEventListener('pause', () => {
    elements.playButton.textContent = '▶';
    elements.playButton.setAttribute('aria-label', '播放');
    cancelAnimationFrame(frameRequest);
    renderCurrentFrame();
    updateSelection();
  });
  elements.video.addEventListener('seeked', renderCurrentFrame);
  elements.video.addEventListener('ended', updateSelection);

  elements.playButton.addEventListener('click', () => {
    if (elements.video.paused) elements.video.play().catch(() => {});
    else elements.video.pause();
  });
  elements.timeSlider.addEventListener('input', () => {
    elements.video.currentTime = Number(elements.timeSlider.value);
    renderCurrentFrame();
  });

  elements.selection.addEventListener('pointerdown', (event) => {
    if (event.target === elements.resizeHandle) return;
    beginPointerOperation(event, 'move');
  });
  elements.resizeHandle.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    beginPointerOperation(event, 'resize');
  });
  elements.selection.addEventListener('pointermove', movePointerOperation);
  elements.selection.addEventListener('pointerup', endPointerOperation);
  elements.selection.addEventListener('pointercancel', endPointerOperation);

  elements.xInput.addEventListener('change', () => {
    const cue = selectedCue();
    if (cue) updateSelectedLayout({ ...cue.layout, x: Number(elements.xInput.value) });
  });
  elements.yInput.addEventListener('change', () => {
    const cue = selectedCue();
    if (cue) updateSelectedLayout({ ...cue.layout, y: Number(elements.yInput.value) });
  });
  elements.scaleInput.addEventListener('input', () => {
    const cue = selectedCue();
    if (cue) updateSelectedLayout({ ...cue.layout, scale: Number(elements.scaleInput.value) });
  });
  elements.resetButton.addEventListener('click', () => updateSelectedLayout(DEFAULT_LAYOUT));
  elements.applyAllButton.addEventListener('click', () => {
    const cue = selectedCue();
    if (!cue) return;
    const layout = normalizeLayout(cue.layout);
    project.cues.forEach((item) => { item.layout = { ...layout }; });
    updateInspector();
    updateSelection();
    markDirty();
    syncOverlay();
  });
  elements.saveButton.addEventListener('click', saveProject);
  elements.exportButton.addEventListener('click', exportProject);

  window.addEventListener('resize', updateSelection);
  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveProject();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable) return;
    const cue = selectedCue();
    if (!cue) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key];
    updateSelectedLayout({ ...cue.layout, x: cue.layout.x + delta[0], y: cue.layout.y + delta[1] });
  });
}

async function loadOptionalSourceName() {
  try {
    const response = await fetch('/api/source');
    if (!response.ok) throw new Error();
    const data = await response.json();
    elements.sourceName.textContent = data.name || '本地源视频';
  } catch {
    elements.sourceName.textContent = '本地源视频（来源信息不可用）';
  }
}

async function loadOptionalSubtitles() {
  try {
    const response = await fetch('/api/subtitles');
    if (!response.ok) return;
    const data = await response.json();
    if (Array.isArray(data)) subtitles = data;
  } catch {
    subtitles = [];
  }
}

async function waitForOverlay() {
  if (!elements.overlay.contentWindow?.ready) await Promise.race([
    new Promise((resolve) => elements.overlay.addEventListener('load', resolve, { once: true })),
    new Promise((resolve) => {
      const started = performance.now();
      const poll = () => {
        if (elements.overlay.contentWindow?.ready || performance.now() - started > 5000) resolve();
        else setTimeout(poll, 25);
      };
      poll();
    }),
  ]);
  if (!elements.overlay.contentWindow?.ready) throw new Error('叠加层载入超时');
  await elements.overlay.contentWindow.ready;
  overlayReady = true;
}

async function initialize() {
  bindEvents();
  loadOptionalSourceName();
  loadOptionalSubtitles();
  try {
    const [response] = await Promise.all([fetch('/api/project'), waitForOverlay()]);
    if (!response.ok) throw new Error(`服务器返回 ${response.status}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.cues)) throw new Error('项目数据格式不正确');
    project = {
      ...data,
      cues: data.cues.map((cue, index) => ({
        ...cue,
        id: String(cue.id ?? `cue-${index + 1}`),
        layout: normalizeLayout(cue.layout),
      })),
    };
    elements.exportButton.disabled = false;
    renderCueList();
    await syncOverlay();
    if (project.cues.length) selectCue(project.cues[0].id, true);
    setStatus('尚未修改');
  } catch (error) {
    console.error(error);
    elements.stageMessage.textContent = '无法连接本地编辑服务';
    elements.stageMessage.hidden = false;
    setStatus(`项目载入失败：${error.message}`, 'error');
    elements.cueList.innerHTML = '<p class="empty-state">请通过本地编辑服务打开此页面，并检查视频和项目路径。</p>';
  }
}

initialize();
