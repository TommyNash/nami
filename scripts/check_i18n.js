#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const CYRILLIC = /[А-Яа-яЁё]/;

// Список языков в renderer/locales/index.json всегда актуален перед проверкой.
require('./sync_locales_index.js');

function parseArgs(argv) {
  const out = { locales: [], files: [], strict: true };
  let mode = null;
  argv.forEach((arg) => {
    if (arg === '--locale') mode = 'locales';
    else if (arg === '--files') mode = 'files';
    else if (arg === '--no-cyrillic') out.strict = false;
    else if (mode) out[mode].push(arg);
  });
  return out;
}

function listDefaultFiles() {
  const files = [path.join(ROOT, 'renderer/index.html')];
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      if (entry.name.startsWith('._')) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    });
  };
  walk(path.join(ROOT, 'renderer/js'));
  return files;
}

function flatten(obj, prefix, out) {
  Object.keys(obj).forEach((key) => {
    if (!prefix && key === '_meta') return;
    const value = obj[key];
    const full = prefix ? `${prefix}.${key}` : key;
    const plural = value && typeof value === 'object' && Object.keys(value).length && Object.keys(value).every((k) => PLURAL_FORMS.has(k));
    if (value && typeof value === 'object' && !plural) flatten(value, full, out);
    else out[full] = value;
  });
  return out;
}

function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next || '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    out += ch;
    i += 1;
  }
  return out;
}

function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));
}

function collectKeys(file, src) {
  const exact = [];
  const dynamic = [];
  const add = (key, line) => (key.includes('${') ? dynamic.push({ key, line }) : exact.push({ key, line }));
  const lineOf = (index) => src.slice(0, index).split('\n').length;
  const callRe = /\bT\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  let m;
  while ((m = callRe.exec(src))) add(m[2], lineOf(m.index));
  const attrRe = /data-i18n(?:-title|-placeholder|-aria-label)?="([^"]+)"/g;
  while ((m = attrRe.exec(src))) add(m[1], lineOf(m.index));
  return { exact, dynamic };
}

function cyrillicLines(file, src) {
  const text = file.endsWith('.html') ? stripHtmlComments(src) : stripComments(src);
  const original = src.split('\n');
  const hits = [];
  text.split('\n').forEach((line, i) => {
    if (!CYRILLIC.test(line)) return;
    if (/i18n-ignore/.test(original[i] || '')) return;
    if (file.endsWith('.html') && /data-i18n/.test(line)) return;
    hits.push({ line: i + 1, text: line.trim().slice(0, 140) });
  });
  return hits;
}

const args = parseArgs(process.argv.slice(2));
const localeFiles = args.locales.length ? args.locales : [path.join(ROOT, 'renderer/locales/ru.json')];
const messages = {};
localeFiles.forEach((file) => Object.assign(messages, flatten(JSON.parse(fs.readFileSync(file, 'utf8')), '', {})));
const all = args.files.length === 0;
const files = all ? listDefaultFiles() : args.files.map((f) => path.resolve(f));

const used = new Set();
const dynamicPrefixes = new Set();
let problems = 0;

files.forEach((file) => {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const { exact, dynamic } = collectKeys(file, src);
  for (const m of src.matchAll(/(['"`])([A-Za-z][\w]*(?:\.[\w]+)+)\1/g)) used.add(m[2]);
  exact.forEach(({ key, line }) => {
    used.add(key);
    if (!(key in messages)) {
      console.log(`MISSING  ${rel}:${line}  ${key}`);
      problems += 1;
    }
  });
  dynamic.forEach(({ key, line }) => {
    const prefix = key.slice(0, key.indexOf('${'));
    dynamicPrefixes.add(prefix);
    if (!Object.keys(messages).some((k) => k.startsWith(prefix))) {
      console.log(`MISSING  ${rel}:${line}  ${key}  (нет ключей с префиксом)`);
      problems += 1;
    }
  });
  if (args.strict) {
    cyrillicLines(file, src).forEach(({ line, text }) => {
      console.log(`CYRILLIC ${rel}:${line}  ${text}`);
      problems += 1;
    });
  }
});

if (all) {
  Object.keys(messages).forEach((key) => {
    const viaDynamic = [...dynamicPrefixes].some((p) => key.startsWith(p));
    if (!used.has(key) && !viaDynamic) {
      console.log(`UNUSED   ${key}`);
    }
  });
}

console.log(problems ? `Проблем: ${problems}` : 'i18n OK');
process.exit(problems ? 1 : 0);
