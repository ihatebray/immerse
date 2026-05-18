/**
 * Windows-friendly setup:
 * - If the user is on Windows and yt-dlp/ffmpeg are missing, download them
 *   into `bin/win-x64/` so `npm start` works immediately.
 *
 * Packaged Windows builds still bundle `bin/win-x64/` via forge `extraResource`.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

if (process.platform !== 'win32') {
  process.exit(0);
}

const binDir = path.join(root, 'bin', 'win-x64');
const ytDlp = path.join(binDir, 'yt-dlp.exe');
const ffmpeg = path.join(binDir, 'ffmpeg.exe');

const missing = !fs.existsSync(ytDlp) || !fs.existsSync(ffmpeg);
if (!missing) {
  process.exit(0);
}

console.log('[postinstall] Windows binaries missing; downloading yt-dlp + ffmpeg...');
const downloader = path.join(__dirname, 'download-binaries.mjs');
const r = spawnSync(process.execPath, [downloader], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(r.status ?? 1);

