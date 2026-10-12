#!/usr/bin/env node
import { createServer } from 'node:http';
import { createReadStream, readFileSync, statSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateLayout, getCueLayout } from '../voiceover/layout.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = { project: 'voiceover/project.json', port: '47220' };
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  if (flag === '--help') {
    console.log('Usage: npm run voiceover:edit -- --video PATH [--subtitles PATH] [--project PATH] [--port 47220]');
    process.exit(0);
  }
  const key = flag.slice(2);
  if (!flag.startsWith('--') || !['video', 'subtitles', 'project', 'port'].includes(key) || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) {
    throw new Error(`参数无效：${flag}`);
  }
  options[key] = process.argv[++i];
}
if (!options.video) throw new Error('请使用 --video 指定原始口播视频');
const port = Number(options.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须为 1–65535 的整数');
const videoPath = resolve(options.video);
const projectPath = resolve(options.project);
const subtitlePath = options.subtitles ? resolve(options.subtitles) : null;
for (const path of [videoPath, projectPath, subtitlePath].filter(Boolean)) {
  if (!statSync(path).isFile()) throw new Error(`不是文件：${path}`);
}

function readProject() {
  const project = JSON.parse(readFileSync(projectPath, 'utf8'));
  if (project.version !== 1 || project.width !== 1080 || project.height !== 1920 || project.fps !== 15 || !Array.isArray(project.cues)) throw new Error('项目必须为1080×1920、15fps的v1时间轴');
  for (const cue of project.cues) validateLayout(cue.layout);
  return project;
}
readProject();

function subtitleCues() {
  if (!subtitlePath) return [];
  const seconds = (h, m, s, ms) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  return readFileSync(subtitlePath, 'utf8').replace(/\r/g, '').split(/\n\s*\n/).flatMap(block => {
    const match = block.match(/(\d+):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{3})[^\n]*\n([\s\S]*)/);
    if (!match) return [];
    return [{ start: seconds(...match.slice(1, 5)), end: seconds(...match.slice(5, 9)), text: match[9].trim() }];
  });
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw Object.assign(new Error('项目数据过大'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON 格式无效'), { status: 400 }); }
}

function saveLayouts(incoming) {
  const current = readProject();
  const conflict = () => { throw Object.assign(new Error('项目内容已变化，请重新加载编辑器后调整位置'), { status: 409 }); };
  for (const key of ['version', 'width', 'height', 'fps']) if (incoming?.[key] !== current[key]) conflict();
  if (!Array.isArray(incoming.cues) || incoming.cues.length !== current.cues.length) conflict();
  const keys = ['id', 'start', 'end', 'kind', 'title', 'description'];
  current.cues.forEach((cue, index) => {
    const next = incoming.cues[index];
    if (!next || keys.some(key => next[key] !== cue[key])) conflict();
    try { validateLayout(next.layout); }
    catch (error) { throw Object.assign(error, { status: 400 }); }
    cue.layout = getCueLayout(next);
  });
  const temporary = `${projectPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(current, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporary, projectPath);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function streamVideo(req, res) {
  const size = statSync(videoPath).size;
  let start = 0, end = size - 1;
  if (req.headers.range) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!range || (!range[1] && !range[2])) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return;
    }
    if (!range[1]) start = Math.max(0, size - Number(range[2]));
    else start = Number(range[1]);
    if (range[1] && range[2]) end = Math.min(size - 1, Number(range[2]));
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return;
    }
  }
  const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-store' };
  if (req.headers.range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(req.headers.range ? 206 : 200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = createReadStream(videoPath, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

const assets = new Map([
  ['/voiceover/editor.html', 'text/html'], ['/voiceover/editor.js', 'text/javascript'],
  ['/voiceover/editor.css', 'text/css'], ['/voiceover/overlay.html', 'text/html'],
  ['/voiceover/overlay.js', 'text/javascript'], ['/voiceover/layout.js', 'text/javascript'],
]);
const server = createServer(async (req, res) => {
  try {
    const validHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!validHosts.includes(req.headers.host)) { json(res, 403, { error: '仅允许本机访问' }); return; }
    const path = new URL(req.url, `http://${req.headers.host}`).pathname;
    if (req.method === 'POST' && path === '/api/project') {
      if (req.headers.origin && !validHosts.some(host => req.headers.origin === `http://${host}`)) { json(res, 403, { error: '请求来源无效' }); return; }
      if (!req.headers['content-type']?.startsWith('application/json')) { json(res, 415, { error: '请提交 JSON 数据' }); return; }
      saveLayouts(await bodyJson(req));
      json(res, 200, { ok: true }); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { json(res, 405, { error: '不支持此操作' }); return; }
    if (path === '/api/video') { streamVideo(req, res); return; }
    if (path === '/api/project') { json(res, 200, readProject()); return; }
    if (path === '/api/source') { json(res, 200, { name: basename(videoPath) }); return; }
    if (path === '/api/subtitles') { json(res, 200, subtitleCues()); return; }
    if (path === '/') { res.writeHead(302, { Location: '/voiceover/editor.html' }); res.end(); return; }
    if (!assets.has(path)) { json(res, 404, { error: '未找到页面' }); return; }
    const file = readFileSync(resolve(root, `.${path}`));
    res.writeHead(200, { 'Content-Type': `${assets.get(path)}; charset=utf-8`, 'Content-Length': file.length, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : file);
  } catch (error) {
    if (!res.headersSent) json(res, error.status || 500, { error: error.message });
    else res.destroy();
  }
});
server.on('error', error => { console.error(`编辑器启动失败：${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`位置编辑器：http://127.0.0.1:${port}/\n视频：${basename(videoPath)}\n保存目标：${projectPath}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
