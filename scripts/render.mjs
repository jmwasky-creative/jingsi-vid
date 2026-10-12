import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const FPS = Number(process.env.FPS || 30);
const CHROME = process.env.CHROME || '/usr/local/bin/google-chrome';
const stills = process.argv.includes('--stills');
const out = resolve('output');
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.goto('file://' + resolve('index.html') + '?render', { waitUntil: 'load' });
await page.evaluate(() => window.ready);

const frame = (t, type = 'image/jpeg') =>
  page.evaluate((t, type) => {
    window.renderFrame(t);
    return document.getElementById('c').toDataURL(type, 0.95).split(',')[1];
  }, t, type);

if (stills) {
  for (const t of [4, 9, 17, 26, 34, 41]) {
    writeFileSync(`${out}/still-${t}.jpg`, Buffer.from(await frame(t), 'base64'));
  }
  await browser.close();
  process.exit(0);
}

const DUR = await page.evaluate(() => 48);
console.log('rendering audio…');
writeFileSync(`${out}/music.wav`, Buffer.from(await page.evaluate(() => window.renderAudio()), 'base64'));
writeFileSync(`${out}/cover.jpg`, Buffer.from(await frame(41), 'base64'));

const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-i', `${out}/music.wav`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
  `${out}/jingyesi.mp4`,
], { stdio: ['pipe', 'inherit', 'inherit'] });

const total = DUR * FPS;
for (let i = 0; i < total; i++) {
  const buf = Buffer.from(await frame(i / FPS), 'base64');
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (i % FPS === 0) process.stdout.write(`\rframe ${i}/${total}`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
console.log(`\ndone → ${out}/jingyesi.mp4`);
