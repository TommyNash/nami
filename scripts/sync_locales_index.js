#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'renderer/locales');
const INDEX = path.join(DIR, 'index.json');
const DEFAULT_LANG = 'ru';

function capitalize(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function languageName(code, override) {
  if (override) return override;
  try {
    return capitalize(new Intl.DisplayNames([code], { type: 'language' }).of(code) || code);
  } catch (_) {
    return code;
  }
}

function listLocales() {
  return fs
    .readdirSync(DIR)
    .filter((name) => name.endsWith('.json') && !name.startsWith('._') && name !== 'index.json')
    .map((name) => {
      const code = name.slice(0, -5);
      const raw = JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
      const meta = raw && typeof raw._meta === 'object' && raw._meta ? raw._meta : {};
      return {
        code,
        name: languageName(code, meta.name),
        locale: meta.locale || code
      };
    })
    .sort((a, b) => {
      if (a.code === DEFAULT_LANG) return -1;
      if (b.code === DEFAULT_LANG) return 1;
      return a.code.localeCompare(b.code);
    });
}

const languages = listLocales();
const next = `${JSON.stringify(languages, null, 2)}\n`;
const prev = fs.existsSync(INDEX) ? fs.readFileSync(INDEX, 'utf8') : '';
if (prev !== next) {
  fs.writeFileSync(INDEX, next);
  console.log(`locales/index.json ← ${languages.map((l) => l.code).join(', ')}`);
} else {
  console.log(`locales/index.json без изменений (${languages.map((l) => l.code).join(', ')})`);
}
