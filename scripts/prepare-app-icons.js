#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ICONS_ROOT = path.join(ROOT, 'assets', 'app-icons');
const TAURI_ICONS = path.join(ROOT, 'src-tauri', 'icons');
const BUILD_DIR = path.join(ROOT, 'build');
const DEFAULT_ID = 'default';
const CANVAS = 512;
const SAFE_FRACTION = 0.82;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function runPythonNormalize(srcPath, destPath) {
  const script = `
from PIL import Image
import math, sys

src, dest, canvas, safe = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4])
im = Image.open(src).convert('RGBA')

def squircle_alpha(x, y, w, h):
    cx, cy = w / 2, h / 2
    nx = abs(x - cx) / (w / 2)
    ny = abs(y - cy) / (h / 2)
    value = (nx ** 4.5 + ny ** 4.5) ** (1 / 4.5)
    if value <= 1:
        return 255
    edge = 0.02
    if value <= 1 + edge:
        return int(round(255 * (1 - (value - 1) / edge)))
    return 0

w, h = im.size
px = im.load()
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        m = squircle_alpha(x, y, w, h)
        px[x, y] = (r, g, b, min(a, m))

# bbox
min_x, min_y, max_x, max_y = w, h, -1, -1
for y in range(h):
    for x in range(w):
        if px[x, y][3] > 8:
            if x < min_x: min_x = x
            if y < min_y: min_y = y
            if x > max_x: max_x = x
            if y > max_y: max_y = y

out = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
if max_x >= min_x:
    cropped = im.crop((min_x, min_y, max_x + 1, max_y + 1))
    bw, bh = cropped.size
    max_side = int(round(canvas * safe))
    scale = min(max_side / bw, max_side / bh, 1.0)
    tw = max(1, int(round(bw * scale)))
    th = max(1, int(round(bh * scale)))
    resized = cropped.resize((tw, th), Image.Resampling.LANCZOS)
    ox = (canvas - tw) // 2
    oy = (canvas - th) // 2
    out.paste(resized, (ox, oy), resized)
else:
    resized = im.resize((canvas, canvas), Image.Resampling.LANCZOS)
    out.paste(resized, (0, 0), resized)

out.save(dest, format='PNG', optimize=True)
print(f'normalized {dest} ({canvas}x{canvas}, safe={safe})')
`;
  const tmp = path.join(os.tmpdir(), `fa-norm-${process.pid}.py`);
  fs.writeFileSync(tmp, script);
  try {
    execFileSync(
      'python3',
      [tmp, srcPath, destPath, String(CANVAS), String(SAFE_FRACTION)],
      { stdio: 'inherit' }
    );
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function resolveSourcePng(dir) {
  const candidates = [
    path.join(dir, 'icon-source-1024.png'),
    path.join(dir, 'icon.png'),
    path.join(dir, 'icon-raw.png')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  const pngs = fs
    .readdirSync(dir)
    .filter((n) => /\.png$/i.test(n) && !n.startsWith('.'))
    .sort();
  return pngs.length ? path.join(dir, pngs[0]) : null;
}

function listIconIds() {
  if (!fs.existsSync(ICONS_ROOT)) return [];
  return fs
    .readdirSync(ICONS_ROOT)
    .filter((name) => {
      if (!name || name.startsWith('.') || name.startsWith('_')) return false;
      if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) return false;
      const dir = path.join(ICONS_ROOT, name);
      return fs.statSync(dir).isDirectory() && !!resolveSourcePng(dir);
    });
}

function normalizeAllSets() {
  const ids = listIconIds();
  if (!ids.length) throw new Error(`Нет наборов в ${ICONS_ROOT}`);
  for (const id of ids) {
    const dir = path.join(ICONS_ROOT, id);
    const src = resolveSourcePng(dir);
    const dest = path.join(dir, 'icon.png');
    console.log(`[prepare-app-icons] ${id}: ${path.relative(ROOT, src)} → icon.png`);
    runPythonNormalize(src, dest);
  }
  return ids;
}

function syncTauriIcons(defaultIconPng) {
  fs.mkdirSync(TAURI_ICONS, { recursive: true });
  const master1024 = path.join(TAURI_ICONS, 'app-icon-1024.png');
  // tauri icon ожидает квадрат ≥1024; апскейлим нормализованный 512
  execFileSync(
    'sips',
    ['-z', '1024', '1024', defaultIconPng, '--out', master1024],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );

  const cargo = process.env.HOME
    ? path.join(process.env.HOME, '.cargo', 'bin', 'cargo')
    : 'cargo';
  const r = spawnSync(
    cargo,
    ['tauri', 'icon', master1024, '--output', TAURI_ICONS],
    { cwd: ROOT, stdio: 'inherit', env: process.env }
  );
  if (r.status !== 0) throw new Error('cargo tauri icon failed');

  // tauri пишет 128x128@2x.png; conf ждёт henry.w@example.net
  const at2x = path.join(TAURI_ICONS, '128x128@2x.png');
  if (fs.existsSync(at2x)) {
    fs.copyFileSync(at2x, path.join(TAURI_ICONS, 'henry.w@example.net'));
  }

  // убрать мобильные артефакты
  for (const name of ['android', 'ios']) {
    const p = path.join(TAURI_ICONS, name);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }

  // Icon Composer: источник правды для macOS (цвет/glass/light-dark).
  const composerSrc = path.join(ICONS_ROOT, DEFAULT_ID, 'icon.icon');
  const composerDst = path.join(TAURI_ICONS, 'Icon.icon');
  if (fs.existsSync(composerSrc)) {
    fs.rmSync(composerDst, { recursive: true, force: true });
    fs.cpSync(composerSrc, composerDst, { recursive: true });
    console.log('[prepare-app-icons] synced Icon.icon → src-tauri/icons/');
    compileComposerIcns(composerDst);
  }
}

/** actool: Icon.icon → icon.icns (fallback совпадает с Composer, не с плоским PNG). */
function compileComposerIcns(composerPath) {
  const compileDir = path.join(BUILD_DIR, 'mac-icon-compile');
  fs.rmSync(compileDir, { recursive: true, force: true });
  fs.mkdirSync(compileDir, { recursive: true });

  // actool капризничает на некоторых путях — работаем из /tmp
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-icon-'));
  const tmpIcon = path.join(tmpRoot, 'Icon.icon');
  const tmpOut = path.join(tmpRoot, 'out');
  fs.cpSync(composerPath, tmpIcon, { recursive: true });
  fs.mkdirSync(tmpOut, { recursive: true });

  try {
    execFileSync(
      'actool',
      [
        tmpIcon,
        '--compile',
        tmpOut,
        '--platform',
        'macosx',
        '--minimum-deployment-target',
        '26.0',
        '--output-format',
        'human-readable-text',
        '--notices',
        '--warnings',
        '--output-partial-info-plist',
        path.join(tmpOut, 'assetcatalog_generated_info.plist'),
        '--app-icon',
        'Icon',
        '--include-all-app-icons',
        '--target-device',
        'mac',
        '--enable-on-demand-resources',
        'NO',
        '--development-region',
        'en'
      ],
      { stdio: 'inherit' }
    );

    const car = path.join(tmpOut, 'Assets.car');
    const icns = path.join(tmpOut, 'Icon.icns');
    if (fs.existsSync(car)) {
      fs.copyFileSync(car, path.join(compileDir, 'Assets.car'));
      fs.copyFileSync(car, path.join(TAURI_ICONS, 'Assets.car'));
      console.log('[prepare-app-icons] Assets.car from Icon Composer');
    }
    if (fs.existsSync(icns)) {
      fs.copyFileSync(icns, path.join(TAURI_ICONS, 'icon.icns'));
      console.log('[prepare-app-icons] icon.icns replaced from Icon Composer');
    } else {
      console.warn('[prepare-app-icons] actool did not emit Icon.icns — leaving PNG-derived icns');
    }
  } catch (err) {
    console.warn('[prepare-app-icons] actool failed:', err.message || err);
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function buildIcoFromDibs(dibs) {
  const count = dibs.length;
  let offset = 6 + 16 * count;
  const entries = [];
  const blobs = [];
  for (const { size, data } of dibs) {
    const w = size >= 256 ? 0 : size;
    const h = size >= 256 ? 0 : size;
    const entry = Buffer.alloc(16);
    entry.writeUInt8(w, 0);
    entry.writeUInt8(h, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    blobs.push(data);
    offset += data.length;
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  return Buffer.concat([header, ...entries, ...blobs]);
}

function readBmp32(bmpPath) {
  const buf = fs.readFileSync(bmpPath);
  if (buf.toString('ascii', 0, 2) !== 'BM') throw new Error(`Not a BMP: ${bmpPath}`);
  const dataOffset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const heightSigned = buf.readInt32LE(22);
  const height = Math.abs(heightSigned);
  const topDown = heightSigned < 0;
  const bitCount = buf.readUInt16LE(28);
  const rowSizeIn = Math.floor(((width * Math.max(bitCount, 24)) / 8 + 3) / 4) * 4;
  const bgra = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y;
    const off = dataOffset + srcRow * rowSizeIn;
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      if (bitCount === 32) {
        const p = off + x * 4;
        bgra[d] = buf[p];
        bgra[d + 1] = buf[p + 1];
        bgra[d + 2] = buf[p + 2];
        bgra[d + 3] = buf[p + 3];
      } else if (bitCount === 24) {
        const p = off + x * 3;
        bgra[d] = buf[p];
        bgra[d + 1] = buf[p + 1];
        bgra[d + 2] = buf[p + 2];
        bgra[d + 3] = 255;
      } else {
        throw new Error(`Unsupported BMP bit depth: ${bitCount}`);
      }
    }
  }
  return { width, height, bgra };
}

function bgraToIcoDib(width, height, bgraTopDown) {
  const xor = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    bgraTopDown.copy(xor, y * width * 4, srcY * width * 4, srcY * width * 4 + width * 4);
  }
  const andRow = Math.floor((width + 31) / 32) * 4;
  const andMask = Buffer.alloc(andRow * height);
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    for (let x = 0; x < width; x++) {
      if (bgraTopDown[(srcY * width + x) * 4 + 3] === 0) {
        const byteIndex = y * andRow + (x >> 3);
        andMask[byteIndex] |= 0x80 >> (x & 7);
      }
    }
  }
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(xor.length + andMask.length, 20);
  return Buffer.concat([header, xor, andMask]);
}

function generateWinIco(srcPng) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-ico-'));
  try {
    const dibs = ICO_SIZES.map((size) => {
      const pngOut = path.join(tmp, `${size}.png`);
      const bmpOut = path.join(tmp, `${size}.bmp`);
      execFileSync('sips', ['-z', String(size), String(size), srcPng, '--out', pngOut], {
        stdio: ['ignore', 'ignore', 'inherit']
      });
      execFileSync('sips', ['-s', 'format', 'bmp', pngOut, '--out', bmpOut], {
        stdio: ['ignore', 'ignore', 'inherit']
      });
      const { width, height, bgra } = readBmp32(bmpOut);
      if (width !== size || height !== size) {
        throw new Error(`Icon resize failed: ${width}x${height}`);
      }
      return { size, data: bgraToIcoDib(width, height, bgra) };
    });
    const ico = buildIcoFromDibs(dibs);
    const outIco = path.join(BUILD_DIR, 'icon.ico');
    const tauriIco = path.join(TAURI_ICONS, 'icon.ico');
    fs.writeFileSync(outIco, ico);
    fs.writeFileSync(tauriIco, ico);
    console.log(`[prepare-app-icons] wrote ${path.relative(ROOT, outIco)} (${ico.length} bytes)`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  // pillow обязателен
  try {
    execFileSync('python3', ['-c', 'from PIL import Image'], { stdio: 'ignore' });
  } catch {
    execFileSync('python3', ['-m', 'pip', 'install', '--user', 'pillow', '-q'], {
      stdio: 'inherit'
    });
  }

  normalizeAllSets();
  const defaultPng = path.join(ICONS_ROOT, DEFAULT_ID, 'icon.png');
  if (!fs.existsSync(defaultPng)) {
    throw new Error(`Missing ${defaultPng}`);
  }
  syncTauriIcons(defaultPng);
  generateWinIco(defaultPng);
  console.log('[prepare-app-icons] done');
}

main();
