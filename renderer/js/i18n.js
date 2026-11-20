(function () {
  const DEFAULT_LANG = 'ru';
  const STORAGE_KEY = 'fa.lang';
  const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

  // Синхронно: переводы нужны уже при выполнении следующих скриптов.
  function syncGet(url) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send();
    return xhr.responseText;
  }

  // Список языков — locales/index.json; его собирает scripts/sync_locales_index.js из locales/*.json.
  function loadLanguages() {
    try {
      const list = JSON.parse(syncGet('locales/index.json'));
      const out = (Array.isArray(list) ? list : [])
        .filter((entry) => entry && typeof entry.code === 'string' && entry.code)
        .map((entry) => ({
          code: entry.code,
          name: entry.name || entry.code,
          locale: entry.locale || entry.code
        }));
      if (out.length) return out;
    } catch (err) {
      console.warn('[i18n] не удалось прочитать locales/index.json', err); // i18n-ignore
    }
    return [{ code: DEFAULT_LANG, name: 'Русский', locale: 'ru-RU' }]; // i18n-ignore
  }

  const LANGUAGES = loadLanguages();

  function savedLang() {
    try {
      const code = localStorage.getItem(STORAGE_KEY);
      return LANGUAGES.some((l) => l.code === code) ? code : DEFAULT_LANG;
    } catch (_) {
      return DEFAULT_LANG;
    }
  }

  function isPluralEntry(obj) {
    const keys = Object.keys(obj);
    return keys.length > 0 && keys.every((k) => PLURAL_FORMS.has(k));
  }

  function flatten(obj, prefix, out) {
    Object.keys(obj).forEach((key) => {
      if (!prefix && key === '_meta') return;
      const value = obj[key];
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !isPluralEntry(value)) {
        flatten(value, path, out);
      } else {
        out[path] = value;
      }
    });
    return out;
  }

  function loadMessages(code) {
    try {
      return flatten(JSON.parse(syncGet(`locales/${code}.json`)), '', {});
    } catch (err) {
      console.error('[i18n] не удалось загрузить locales/' + code + '.json', err); // i18n-ignore
      return {};
    }
  }

  const lang = savedLang();
  const meta = LANGUAGES.find((l) => l.code === lang) || LANGUAGES[0];
  const messages = lang === DEFAULT_LANG ? loadMessages(lang) : { ...loadMessages(DEFAULT_LANG), ...loadMessages(lang) };
  const rules = new Intl.PluralRules(meta.locale);
  const warned = new Set();

  function fill(template, params) {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
  }

  function T(key, params) {
    let entry = messages[key];
    if (entry === undefined) {
      if (!warned.has(key)) {
        warned.add(key);
        console.warn('[i18n] нет ключа', key); // i18n-ignore
      }
      return key;
    }
    if (typeof entry === 'object') {
      const form = rules.select(Math.abs(Number(params && params.n)) || 0);
      entry = entry[form] !== undefined ? entry[form] : entry.other;
    }
    return fill(entry, params);
  }

  const ATTRS = [
    ['data-i18n-title', 'title'],
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-aria-label', 'aria-label']
  ];

  function apply(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = T(el.getAttribute('data-i18n'));
    });
    ATTRS.forEach(([data, attr]) => {
      scope.querySelectorAll(`[${data}]`).forEach((el) => {
        el.setAttribute(attr, T(el.getAttribute(data)));
      });
    });
  }

  function setLang(code) {
    if (!LANGUAGES.some((l) => l.code === code)) return false;
    localStorage.setItem(STORAGE_KEY, code);
    return true;
  }

  function reloadWith(code) {
    if (code === lang || !setLang(code)) return;
    sessionStorage.setItem('nami.skipSplash', '1');
    window.location.reload();
  }

  document.documentElement.lang = lang;

  window.NamiI18n = {
    lang,
    locale: meta.locale,
    languages: LANGUAGES,
    t: T,
    apply,
    setLang,
    reloadWith
  };
  window.T = T;
  apply(document);
})();
