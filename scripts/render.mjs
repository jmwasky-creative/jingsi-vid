import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const FPS = Number(process.env.FPS || 30);
const CHROME = process.env.CHROME || '/usr/local/bin/google-chrome';
const stills = process.argv.includes('--stills');
const out = resolve('output');
mkdirSync(out, { recursive: true });

const run = (args) =>
  new Promise((ok, fail) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (c) => (c ? fail(new Error(`ffmpeg exited ${c}`)) : ok()));
  });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.setViewport({ width: 1920, height: 1080 });
await page.goto('file://' + resolve('index.html') + '?render', { waitUntil: 'load' });
await page.evaluate(() => window.ready);
const TL = await page.evaluate(() => ({ S: TL.S, cues: TL.cues, DUR: TL.DUR }));

const frame = (t) =>
  page.evaluate((t) => {
    window.renderFrame(t);
    return document.getElementById('c').toDataURL('image/jpeg', 0.95).split(',')[1];
  }, t);

if (stills) {
  const times = process.argv.slice(3).map(Number);
  const picks = times.length ? times : TL.S.flatMap((s) => [s.start + 3, (s.start + s.end) / 2, s.end - 2.2]);
  for (const t of picks) writeFileSync(`${out}/still-${t.toFixed(1)}.jpg`, Buffer.from(await frame(t), 'base64'));
  console.log('scenes', TL.S.map((s) => `${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(' '), 'dur', TL.DUR.toFixed(1));
  await browser.close();
  process.exit(0);
}

console.log(`duration ${TL.DUR.toFixed(2)}s, rendering music…`);
writeFileSync(`${out}/music.wav`, Buffer.from(await page.evaluate(() => window.renderAudio()), 'base64'));
writeFileSync(`${out}/cover.jpg`, Buffer.from(await frame(TL.cues.find((c) => c.id === 'n5').t + 3), 'base64'));

const inputs = ['-i', `${out}/music.wav`];
const chains = TL.cues.map((c, i) => {
  inputs.push('-i', `narration/${c.id}.wav`);
  const ms = Math.round(c.t * 1000);
  return `[${i + 1}:a]aresample=44100,pan=stereo|c0=c0|c1=c0,adelay=${ms}|${ms},volume=1.15[v${i}]`;
});
const mix = `${chains.join(';')};[0:a]${TL.cues.map((_, i) => `[v${i}]`).join('')}amix=inputs=${TL.cues.length + 1}:normalize=0:duration=first,alimiter=limit=0.95[a]`;
await run(['-y', '-loglevel', 'error', ...inputs, '-filter_complex', mix, '-map', '[a]', `${out}/soundtrack.wav`]);

const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-i', `${out}/soundtrack.wav`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
  `${out}/jingyesi.mp4`,
], { stdio: ['pipe', 'inherit', 'inherit'] });

const total = Math.ceil(TL.DUR * FPS);
for (let i = 0; i < total; i++) {
  const buf = Buffer.from(await frame(i / FPS), 'base64');
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (i % (FPS * 5) === 0) console.log(`frame ${i}/${total}`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
console.log(`done → ${out}/jingyesi.mp4`);
