import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { app } from 'electron';

const COVER_DIR_NAME = 'cover-cache';

/** Absolute path to the cover-cache directory, created lazily on first use. */
function coverDir() {
  const dir = path.join(app.getPath('userData'), COVER_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Map a data-URI mime type to a file extension. */
function extForMime(mime) {
  const m = (mime || '').toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return '.jpg';
  if (m === 'image/png') return '.png';
  if (m === 'image/webp') return '.webp';
  if (m === 'image/gif') return '.gif';
  if (m === 'image/avif') return '.avif';
  return '.bin';
}

/**
 * Persist a data URI to disk and return its canonical `studio-cover://...` URL.
 * If the input is already a URL (http/https or studio-cover), it's returned as-is.
 * If the input is null/empty, returns null.
 *
 * Files are named by sha1 of their bytes so identical images dedupe automatically.
 */
export function storeCoverFromDataUri(input) {
  if (input == null || input === '') return null;
  if (typeof input !== 'string') return null;

  const u = input.trim();
  if (!u) return null;

  // Already a URL — pass through unchanged
  if (/^https?:\/\//i.test(u)) return u.slice(0, 2048);
  if (u.startsWith('studio-cover://')) return u;

  // Data URI — decode and persist
  if (u.startsWith('data:image/')) {
    const m = /^data:([^;]+);base64,(.+)$/i.exec(u);
    if (!m) return null;
    const mime = m[1];
    const b64 = m[2];
    let buf;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch {
      return null;
    }
    if (!buf || buf.length === 0) return null;

    // Hash-based filename so duplicate uploads dedupe
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20);
    const ext = extForMime(mime);
    const filename = `${hash}${ext}`;
    const full = path.join(coverDir(), filename);

    try {
      if (!fs.existsSync(full)) fs.writeFileSync(full, buf);
    } catch (e) {
      console.error('coverArtStore: write failed', e);
      return null;
    }
    return `studio-cover://local/${encodeURIComponent(filename)}`;
  }

  return null;
}

/** Resolve a studio-cover://... URL to the on-disk file. Returns null if invalid. */
export function resolveCoverFilePath(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'studio-cover:') return null;
  // Strip leading /
  const rel = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  // Sanitize — no path traversal
  if (!rel || rel.includes('..') || rel.includes('/') || rel.includes('\\')) return null;
  const full = path.join(coverDir(), rel);
  return full;
}

/** MIME type lookup from filename extension, for the HTTP response. */
export function mimeForCoverPath(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.avif') return 'image/avif';
  return 'application/octet-stream';
}
