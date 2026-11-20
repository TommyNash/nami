const SENSITIVE_KEY = /^(.*_)?(secret|token|csrf|password|authorization|cookie|session|sessionid)(_.*)?$/i;

export function isSensitiveKey(key) {
  return SENSITIVE_KEY.test(String(key));
}

export function sanitizeValue(value, depth = 0) {
  if (depth > 12) return '[max-depth]';
  if (value == null) return value;
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = sanitizeValue(val, depth + 1);
    }
  }
  return out;
}

export function sanitizeJsonText(text, maxChars) {
  if (typeof text !== 'string') return { ok: false, body: null, error: 'not-string' };
  const clipped = maxChars && text.length > maxChars ? text.slice(0, maxChars) : text;
  try {
    const parsed = JSON.parse(clipped);
    const clean = sanitizeValue(parsed);
    return { ok: true, body: clean, truncated: clipped.length < text.length };
  } catch (err) {
    return {
      ok: false,
      body: null,
      error: String(err && err.message ? err.message : err),
      rawPreview: clipped.slice(0, 2000)
    };
  }
}

export function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isSensitiveKey(key) || /cookie|authorization/i.test(key)) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = String(value).slice(0, 300);
    }
  }
  return out;
}
