/**
 * Downloads yt-dlp and ffmpeg into resources/bin/<platform>/ for local bundling.
 * Windows: win-x64. macOS: darwin-arm64 or darwin-x64. Linux: linux-x64.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const platform = process.platform;
const arch = process.arch;

function pickTargetDir() {
  if (platform === 'win32') return path.join(root, 'bin', 'win-x64');
  if (platform === 'darwin') {
    const a = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
    return path.join(root, 'bin', a);
  }
  return path.join(root, 'bin', 'linux-x64');
}

const binDir = pickTargetDir();

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

function findFileRecursive(dir, name) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const hit = findFileRecursive(full, name);
      if (hit) return hit;
    } else if (e.name === name) {
      return full;
    }
  }
  return null;
}

async function downloadFfmpegWindows() {
  const gh = await fetch('https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest');
  if (!gh.ok) throw new Error(`GitHub API ffmpeg: ${gh.status}`);
  const rel = await gh.json();
  const asset = rel.assets?.find(
    (a) => a.name.includes('win64') && a.name.includes('gpl') && a.name.endsWith('.zip') && !a.name.includes('shared'),
  );
  if (!asset?.browser_download_url) {
    throw new Error('Could not find win64 gpl ffmpeg zip in latest BtbN release');
  }
  const zipPath = path.join(binDir, '_ffmpeg.zip');
  const extractDir = path.join(binDir, '_ffmpeg_extract');
  await download(asset.browser_download_url, zipPath);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync('tar', ['-xf', zipPath, '-C', extractDir], { stdio: 'inherit' });
  const ffmpegSrc = findFileRecursive(extractDir, 'ffmpeg.exe');
  if (!ffmpegSrc) throw new Error('ffmpeg.exe not found inside archive');
  const dest = path.join(binDir, 'ffmpeg.exe');
  fs.copyFileSync(ffmpegSrc, dest);
  fs.rmSync(zipPath, { force: true });
  fs.rmSync(extractDir, { recursive: true, force: true });
  console.log('Wrote', dest);
}

async function downloadFfmpegMac() {
  const gh = await fetch('https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest');
  if (!gh.ok) throw new Error(`GitHub API ffmpeg: ${gh.status}`);
  const rel = await gh.json();
  const isArm = arch === 'arm64';
  const asset = rel.assets?.find((a) => {
    if (!a.name.endsWith('.zip') || a.name.includes('shared')) return false;
    if (isArm) return a.name.includes('macos') && a.name.includes('arm64') && a.name.includes('gpl');
    return a.name.includes('macos') && a.name.includes('gpl') && !a.name.includes('arm64');
  });
  if (!asset?.browser_download_url) {
    throw new Error('Could not find macOS ffmpeg zip in latest BtbN release');
  }
  const zipPath = path.join(binDir, '_ffmpeg.zip');
  const extractDir = path.join(binDir, '_ffmpeg_extract');
  await download(asset.browser_download_url, zipPath);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync('tar', ['-xf', zipPath, '-C', extractDir], { stdio: 'inherit' });
  const ffmpegSrc = findFileRecursive(extractDir, 'ffmpeg');
  if (!ffmpegSrc) throw new Error('ffmpeg binary not found inside archive');
  const dest = path.join(binDir, 'ffmpeg');
  fs.copyFileSync(ffmpegSrc, dest);
  fs.chmodSync(dest, 0o755);
  fs.rmSync(zipPath, { force: true });
  fs.rmSync(extractDir, { recursive: true, force: true });
  console.log('Wrote', dest);
}

async function downloadFfmpegLinux() {
  const gh = await fetch('https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest');
  if (!gh.ok) throw new Error(`GitHub API ffmpeg: ${gh.status}`);
  const rel = await gh.json();
  const asset = rel.assets?.find(
    (a) => a.name.includes('linux64') && a.name.includes('gpl') && a.name.endsWith('.tar.xz'),
  );
  if (!asset?.browser_download_url) {
    throw new Error('Could not find linux64 ffmpeg tar.xz in latest BtbN release');
  }
  const txzPath = path.join(binDir, '_ffmpeg.tar.xz');
  const extractDir = path.join(binDir, '_ffmpeg_extract');
  await download(asset.browser_download_url, txzPath);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync('tar', ['-xf', txzPath, '-C', extractDir], { stdio: 'inherit' });
  const ffmpegSrc = findFileRecursive(extractDir, 'ffmpeg');
  if (!ffmpegSrc) throw new Error('ffmpeg binary not found inside archive');
  const dest = path.join(binDir, 'ffmpeg');
  fs.copyFileSync(ffmpegSrc, dest);
  fs.chmodSync(dest, 0o755);
  fs.rmSync(txzPath, { force: true });
  fs.rmSync(extractDir, { recursive: true, force: true });
  console.log('Wrote', dest);
}

async function main() {
  fs.mkdirSync(binDir, { recursive: true });
  console.log('Target:', binDir);

  if (platform === 'win32') {
    const ytdlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
    const ytdlpDest = path.join(binDir, 'yt-dlp.exe');
    console.log('Downloading yt-dlp...');
    await download(ytdlpUrl, ytdlpDest);
    console.log('Wrote', ytdlpDest);
    console.log('Downloading ffmpeg (BtbN, may take a minute)...');
    await downloadFfmpegWindows();
  } else if (platform === 'darwin') {
    const base = arch === 'arm64'
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
      : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos_legacy';
    const ytdlpDest = path.join(binDir, 'yt-dlp');
    console.log('Downloading yt-dlp...');
    await download(base, ytdlpDest);
    fs.chmodSync(ytdlpDest, 0o755);
    console.log('Wrote', ytdlpDest);
    console.log('Downloading ffmpeg (BtbN)...');
    await downloadFfmpegMac();
  } else {
    const ytdlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
    const ytdlpDest = path.join(binDir, 'yt-dlp');
    console.log('Downloading yt-dlp...');
    await download(ytdlpUrl, ytdlpDest);
    fs.chmodSync(ytdlpDest, 0o755);
    console.log('Wrote', ytdlpDest);
    console.log('Downloading ffmpeg (BtbN)...');
    await downloadFfmpegLinux();
  }

  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
