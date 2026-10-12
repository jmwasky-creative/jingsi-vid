#!/usr/bin/env node

import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateLayout } from '../voiceover/layout.js';

const ROOT = process.cwd();
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 15;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const activeChildren = new Set();

function usage() {
  return `Usage:
  node scripts/render-voiceover.mjs --video PATH --subtitles PATH [options]

Options:
  --project PATH  Project JSON (default: voiceover/project.json)
  --out PATH      Output directory (default: output/voiceover)
  --stills        Export an overlay PNG and composite JPG at each cue midpoint
  --help          Show this help`;
}

function parseArgs(argv) {
  const options = {
    project: 'voiceover/project.json',
    out: 'output/voiceover',
    stills: false,
  };
  const valueFlags = new Set(['video', 'subtitles', 'project', 'out']);

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
    if (token === '--stills') {
      options.stills = true;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`Unexpected positional argument: ${token}`);

    const equal = token.indexOf('=');
    const name = token.slice(2, equal === -1 ? undefined : equal);
    if (!valueFlags.has(name)) throw new Error(`Unknown option: --${name}`);
    const value = equal === -1 ? argv[++i] : token.slice(equal + 1);
    if (!value || value.startsWith('--')) throw new Error(`--${name} requires a path`);
    options[name] = value;
  }
  return options;
}

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
  if (!statSync(path).isFile()) throw new Error(`${label} is not a file: ${path}`);
}

function parseJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse ${label} ${path}: ${error.message}`);
  }
}

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function validateProject(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new Error('Project must be a JSON object');
  }
  if (project.version !== 1) throw new Error('Project version must be 1');
  if (project.width !== WIDTH || project.height !== HEIGHT) {
    throw new Error(`Project dimensions must be ${WIDTH}x${HEIGHT}`);
  }
  if (project.fps !== FPS) throw new Error(`Project fps must be ${FPS}`);
  if (!Array.isArray(project.cues)) throw new Error('Project cues must be an array');

  const ids = new Set();
  project.cues.forEach((cue, index) => {
    const label = `Project cue ${index + 1}`;
    if (!cue || typeof cue !== 'object' || Array.isArray(cue)) {
      throw new Error(`${label} must be an object`);
    }
    if (typeof cue.id !== 'string' || cue.id.trim() === '') throw new Error(`${label}.id is required`);
    if (ids.has(cue.id)) throw new Error(`Duplicate cue id: ${cue.id}`);
    ids.add(cue.id);
    validateLayout(cue.layout);
    assertFiniteNumber(cue.start, `${label}.start`);
    assertFiniteNumber(cue.end, `${label}.end`);
    if (cue.start < 0 || cue.end <= cue.start) {
      throw new Error(`${label} must satisfy 0 <= start < end`);
    }
    for (const field of ['kind', 'title', 'description']) {
      if (typeof cue[field] !== 'string') throw new Error(`${label}.${field} must be a string`);
    }
    if (index > 0) {
      const previous = project.cues[index - 1];
      if (cue.start < previous.start) throw new Error(`${label} starts before the preceding cue`);
      if (cue.start < previous.end) throw new Error(`${label} overlaps cue ${previous.id}`);
    }
  });
}

function parseSrtTimestamp(raw, label) {
  const match = raw.trim().match(/^(\d+):([0-5]\d):([0-5]\d)[,.](\d{3})$/);
  if (!match) throw new Error(`Invalid SRT timestamp (${label}): ${raw}`);
  const [, hours, minutes, seconds, milliseconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(milliseconds) / 1000;
}

function parseSrt(source) {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) throw new Error('Subtitle file is empty');
  const blocks = normalized.split(/\n{2,}/);

  return blocks.map((block, blockIndex) => {
    const lines = block.split('\n');
    const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeLineIndex === -1) throw new Error(`SRT block ${blockIndex + 1} has no timestamp line`);
    const timeParts = lines[timeLineIndex].split(/\s*-->\s*/);
    if (timeParts.length !== 2) throw new Error(`SRT block ${blockIndex + 1} has an invalid timestamp line`);
    const start = parseSrtTimestamp(timeParts[0], `block ${blockIndex + 1} start`);
    const endToken = timeParts[1].trim().split(/\s+/)[0];
    const end = parseSrtTimestamp(endToken, `block ${blockIndex + 1} end`);
    if (end <= start) throw new Error(`SRT block ${blockIndex + 1} must satisfy start < end`);
    const text = lines.slice(timeLineIndex + 1).join('\n').trim();
    if (!text) throw new Error(`SRT block ${blockIndex + 1} has no subtitle text`);
    return {
      index: blockIndex + 1,
      start,
      end,
      text,
    };
  });
}

function spawnTracked(command, args, { stdin = 'ignore', stdout = 'ignore' } = {}) {
  const child = spawn(command, args, { stdio: [stdin, stdout, 'pipe'] });
  activeChildren.add(child);
  if (child.stdin) child.stdin.on('error', () => {});
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-32_000);
  });

  const done = new Promise((resolveDone, rejectDone) => {
    child.once('error', (error) => {
      activeChildren.delete(child);
      rejectDone(new Error(`Could not start ${command}: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      activeChildren.delete(child);
      if (code === 0) {
        resolveDone({ stderr });
      } else {
        const detail = stderr.trim() ? `\n${stderr.trim()}` : '';
        rejectDone(new Error(`${command} exited with ${code ?? `signal ${signal}`}${detail}`));
      }
    });
  });
  // Streaming encoders are awaited after their input has been produced. Attach a
  // handler now as well so an early ffmpeg failure is never an unhandled rejection.
  done.catch(() => {});
  return { child, done };
}

async function runCommand(command, args) {
  const { done } = spawnTracked(command, args);
  return done;
}

async function captureCommand(command, args) {
  const { child, done } = spawnTracked(command, args, { stdout: 'pipe' });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  await done;
  return stdout;
}

async function probeVideo(videoPath) {
  const output = await captureCommand(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=index,codec_type,codec_name,duration,width,height,pix_fmt,avg_frame_rate,r_frame_rate',
    '-of', 'json',
    videoPath,
  ]);
  let probe;
  try {
    probe = JSON.parse(output);
  } catch (error) {
    throw new Error(`ffprobe returned invalid JSON: ${error.message}`);
  }
  const videoStream = probe.streams?.find((stream) => stream.codec_type === 'video');
  if (!videoStream) throw new Error(`Input has no video stream: ${videoPath}`);
  const duration = Number(probe.format?.duration || videoStream.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not determine a positive video duration');
  const audioStream = probe.streams?.find((stream) => stream.codec_type === 'audio') || null;
  return { duration, videoStream, audioStream };
}

function buildTimeline(project, subtitles, duration) {
  const epsilon = 1 / FPS;
  for (const cue of project.cues) {
    if (cue.end > duration + epsilon) {
      throw new Error(`Cue ${cue.id} ends at ${cue.end}s, after the ${duration.toFixed(3)}s source video`);
    }
  }
  return {
    version: 1,
    width: project.width,
    height: project.height,
    fps: project.fps,
    duration,
    frameCount: Math.ceil(duration * FPS),
    cues: project.cues.map((cue) => {
      const matchingSubtitles = subtitles
        .filter((subtitle) => subtitle.start < cue.end && subtitle.end > cue.start)
        .map(({ index, start, end, text }) => ({ index, start, end, text }));
      return {
        ...cue,
        midpoint: (cue.start + cue.end) / 2,
        subtitles: matchingSubtitles,
      };
    }),
    subtitles,
  };
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeChunk(stream, chunk) {
  if (stream.destroyed || !stream.writable) throw new Error('ffmpeg closed its input while overlay frames were rendering');
  if (!stream.write(chunk)) {
    await new Promise((resolveDrain, rejectDrain) => {
      const cleanup = () => {
        stream.off('drain', onDrain);
        stream.off('close', onClose);
        stream.off('error', onError);
      };
      const onDrain = () => {
        cleanup();
        resolveDrain();
      };
      const onClose = () => {
        cleanup();
        rejectDrain(new Error('ffmpeg closed its input while waiting for backpressure to clear'));
      };
      const onError = (error) => {
        cleanup();
        rejectDrain(new Error(`Could not write an overlay frame to ffmpeg: ${error.message}`));
      };
      stream.once('drain', onDrain);
      stream.once('close', onClose);
      stream.once('error', onError);
    });
  }
}

function parseFrameRate(value) {
  if (typeof value !== 'string') return NaN;
  const [numerator, denominator = '1'] = value.split('/');
  const rate = Number(numerator) / Number(denominator);
  return Number.isFinite(rate) ? rate : NaN;
}

async function verifyOutput(path, sourceHasAudio, expectedDuration) {
  const output = await probeVideo(path);
  const width = Number(output.videoStream.width);
  const height = Number(output.videoStream.height);
  const rate = parseFrameRate(output.videoStream.avg_frame_rate || output.videoStream.r_frame_rate);
  const tolerance = 1 / FPS + 0.005;
  const problems = [];
  if (width !== WIDTH || height !== HEIGHT) problems.push(`dimensions are ${width}x${height}`);
  if (Math.abs(rate - FPS) > 0.01) problems.push(`frame rate is ${rate}`);
  if (output.videoStream.codec_name !== 'h264') problems.push(`video codec is ${output.videoStream.codec_name}`);
  if (output.videoStream.pix_fmt !== 'yuv420p') problems.push(`pixel format is ${output.videoStream.pix_fmt}`);
  if (Math.abs(output.duration - expectedDuration) > tolerance) {
    problems.push(`duration is ${output.duration.toFixed(3)}s, expected ${expectedDuration.toFixed(3)}s`);
  }
  if (sourceHasAudio && !output.audioStream) problems.push('source audio is missing');
  if (!sourceHasAudio && output.audioStream) problems.push('an unexpected audio stream is present');
  if (output.audioStream && output.audioStream.codec_name !== 'aac') {
    problems.push(`audio codec is ${output.audioStream.codec_name}`);
  }
  if (problems.length) throw new Error(`Output verification failed: ${problems.join('; ')}`);
  return {
    width,
    height,
    fps: rate,
    duration: output.duration,
    videoCodec: output.videoStream.codec_name,
    pixelFormat: output.videoStream.pix_fmt,
    audioCodec: output.audioStream?.codec_name || null,
  };
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'cue';
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(usage());
    return;
  }
  if (!cli.video || !cli.subtitles) throw new Error(`--video and --subtitles are required\n\n${usage()}`);

  const paths = {
    video: resolve(ROOT, cli.video),
    subtitles: resolve(ROOT, cli.subtitles),
    project: resolve(ROOT, cli.project),
    overlay: resolve(ROOT, 'voiceover/overlay.html'),
    out: resolve(ROOT, cli.out),
  };
  requireFile(paths.video, 'Video');
  requireFile(paths.subtitles, 'Subtitle file');
  requireFile(paths.project, 'Project file');
  requireFile(paths.overlay, 'Overlay entry');

  const project = parseJson(paths.project, 'project');
  validateProject(project);
  const subtitles = parseSrt(readFileSync(paths.subtitles, 'utf8'));
  const probe = await probeVideo(paths.video);
  const timeline = buildTimeline(project, subtitles, probe.duration);

  mkdirSync(paths.out, { recursive: true });
  const outputs = {
    video: resolve(paths.out, 'voiceover.mp4'),
    alpha: resolve(paths.out, 'overlay-alpha.mov'),
    timeline: resolve(paths.out, 'timeline.json'),
    report: resolve(paths.out, 'report.json'),
    stills: resolve(paths.out, 'stills'),
  };
  const inputs = new Set([paths.video, paths.subtitles, paths.project, paths.overlay]);
  for (const outputPath of Object.values(outputs)) {
    if (inputs.has(outputPath)) throw new Error(`Refusing to overwrite input path: ${outputPath}`);
  }

  const startedAt = new Date().toISOString();
  const report = {
    version: 1,
    status: 'rendering',
    startedAt,
    inputs: {
      video: paths.video,
      subtitles: paths.subtitles,
      project: paths.project,
      overlay: paths.overlay,
    },
    source: {
      duration: probe.duration,
      videoCodec: probe.videoStream.codec_name || null,
      audioCodec: probe.audioStream?.codec_name || null,
      hasAudio: Boolean(probe.audioStream),
    },
    render: {
      width: WIDTH,
      height: HEIGHT,
      fps: FPS,
      frameCount: timeline.frameCount,
      audioMode: probe.audioStream ? (probe.audioStream.codec_name === 'aac' ? 'copy' : 'aac') : 'none',
    },
    cueAssociations: timeline.cues.map((cue) => ({
      id: cue.id,
      subtitleIndexes: cue.subtitles.map((subtitle) => subtitle.index),
      subtitleText: cue.subtitles.map((subtitle) => subtitle.text).join('\n'),
    })),
    outputs,
  };
  writeJson(outputs.timeline, timeline);
  writeJson(outputs.report, report);

  let browser;
  let alphaEncoder;
  try {
    requireFile(CHROME, 'Chrome executable');
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    page.on('pageerror', (error) => console.error(`Overlay page error: ${error.message}`));
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    await page.goto(`${pathToFileURL(paths.overlay).href}?render`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.setProject === 'function' && typeof window.renderFrame === 'function');
    await page.evaluate(async (value) => {
      if (window.ready && typeof window.ready.then === 'function') await window.ready;
      else if (typeof window.ready === 'function') await window.ready();
      await window.setProject(value);
    }, project);

    const canvas = await page.$('#c');
    if (!canvas) throw new Error('Overlay entry did not provide Canvas #c');
    const canvasSize = await canvas.evaluate((element) => ({ width: element.width, height: element.height }));
    if (canvasSize.width !== WIDTH || canvasSize.height !== HEIGHT) {
      throw new Error(`Canvas #c must be ${WIDTH}x${HEIGHT}; received ${canvasSize.width}x${canvasSize.height}`);
    }

    const renderPng = async (time) => {
      const base64 = await page.evaluate(async (t) => {
        await window.renderFrame(t);
        return document.getElementById('c').toDataURL('image/png').split(',', 2)[1];
      }, time);
      return Buffer.from(base64, 'base64');
    };

    const exportStills = async () => {
      mkdirSync(outputs.stills, { recursive: true });
      for (const cue of timeline.cues) {
        const time = Math.min(cue.midpoint, Math.max(0, probe.duration - 0.001));
        const stem = `${safeName(cue.id)}-${time.toFixed(3)}`;
        const overlayStill = resolve(outputs.stills, `${stem}-overlay.png`);
        const compositeStill = resolve(outputs.stills, `${stem}-composite.jpg`);
        writeFileSync(overlayStill, await renderPng(time));
        await runCommand(FFMPEG, [
          '-y',
          '-hide_banner',
          '-loglevel', 'error',
          '-ss', time.toFixed(6),
          '-i', paths.video,
          '-i', overlayStill,
          '-filter_complex',
          `[0:v]scale=w=${WIDTH}:h=${HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[base];[1:v]format=rgba[ov];[base][ov]overlay=0:0:format=auto,format=yuvj420p[preview]`,
          '-map', '[preview]',
          '-frames:v', '1',
          '-q:v', '2',
          compositeStill,
        ]);
      }
    };

    await exportStills();
    if (cli.stills) {
      report.status = 'complete';
      report.render.mode = 'stills';
      report.completedAt = new Date().toISOString();
      writeJson(outputs.report, report);
      console.log(`Done → ${outputs.stills}`);
      return;
    }

    console.log(`Rendering ${timeline.frameCount} transparent overlay frames at ${FPS} fps…`);
    alphaEncoder = spawnTracked(FFMPEG, [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'image2pipe',
      '-framerate', String(FPS),
      '-c:v', 'png',
      '-i', 'pipe:0',
      '-frames:v', String(timeline.frameCount),
      '-an',
      '-c:v', 'qtrle',
      '-pix_fmt', 'argb',
      outputs.alpha,
    ], { stdin: 'pipe' });

    try {
      const progressEvery = Math.max(1, Math.ceil(timeline.frameCount / 10));
      for (let frameIndex = 0; frameIndex < timeline.frameCount; frameIndex += 1) {
        const png = await renderPng(frameIndex / FPS);
        await writeChunk(alphaEncoder.child.stdin, png);
        if (frameIndex === 0 || (frameIndex + 1) % progressEvery === 0 || frameIndex + 1 === timeline.frameCount) {
          console.log(`Overlay frames: ${frameIndex + 1}/${timeline.frameCount}`);
        }
      }
      alphaEncoder.child.stdin.end();
      await alphaEncoder.done;
      alphaEncoder = null;
    } catch (error) {
      alphaEncoder.child.stdin.destroy();
      alphaEncoder.child.kill('SIGTERM');
      await alphaEncoder.done.catch(() => {});
      alphaEncoder = null;
      throw error;
    }

    console.log('Compositing source video, overlay, and source audio…');
    const filter = `[0:v]scale=w=${WIDTH}:h=${HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${FPS},setsar=1[base];[1:v]fps=${FPS},format=rgba[ov];[base][ov]overlay=0:0:format=auto:eof_action=pass[v]`;
    const compositeArgs = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-i', paths.video,
      '-i', outputs.alpha,
      '-filter_complex', filter,
      '-map', '[v]',
    ];
    if (probe.audioStream) compositeArgs.push('-map', '0:a:0');
    compositeArgs.push(
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-r', String(FPS),
    );
    if (probe.audioStream) {
      if (probe.audioStream.codec_name === 'aac') compositeArgs.push('-c:a', 'copy');
      else compositeArgs.push('-c:a', 'aac', '-b:a', '192k');
    }
    compositeArgs.push(
      '-t', probe.duration.toFixed(6),
      '-movflags', '+faststart',
      outputs.video,
    );
    await runCommand(FFMPEG, compositeArgs);

    report.verification = await verifyOutput(outputs.video, Boolean(probe.audioStream), probe.duration);
    report.status = 'complete';
    report.completedAt = new Date().toISOString();
    writeJson(outputs.report, report);
    console.log(`Done → ${outputs.video}`);
  } catch (error) {
    report.status = 'failed';
    report.failedAt = new Date().toISOString();
    report.error = error.message;
    writeJson(outputs.report, report);
    throw error;
  } finally {
    if (alphaEncoder) {
      alphaEncoder.child.stdin.destroy();
      alphaEncoder.child.kill('SIGTERM');
      await alphaEncoder.done.catch(() => {});
    }
    if (browser) await browser.close().catch(() => {});
  }
}

process.once('SIGTERM', () => {
  for (const child of activeChildren) child.kill('SIGTERM');
});

main().catch((error) => {
  console.error(`render-voiceover: ${error.message}`);
  process.exitCode = 1;
});
