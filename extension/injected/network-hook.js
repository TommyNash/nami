(() => {
  if (window.__foundersCollectorHooked) return;
  window.__foundersCollectorHooked = true;

  const SOURCE = 'nami-collector-main';

  function emit(payload) {
    window.postMessage({ source: SOURCE, type: 'network-response', payload }, '*');
  }

  function parseUrl(input) {
    try {
      return new URL(typeof input === 'string' ? input : input.url, location.href);
    } catch {
      return null;
    }
  }

  function isConsoleApi(urlObj) {
    return urlObj && urlObj.hostname === 'games.yandex.ru' && urlObj.pathname.startsWith('/console/api/');
  }

  function capture(meta, bodyText) {
    emit({
      capturedAt: Date.now(),
      method: meta.method,
      url: meta.url,
      pathname: meta.pathname,
      search: meta.search,
      status: meta.status,
      contentType: meta.contentType || '',
      durationMs: meta.durationMs,
      requestBody: meta.requestBody || null,
      responseBody: typeof bodyText === 'string' ? bodyText : '',
      pageUrl: location.href,
      sourceTransport: meta.transport
    });
  }

  function bodyFromInit(init) {
    try {
      if (!init || init.body == null) return null;
      if (typeof init.body === 'string') return init.body.slice(0, 100000);
      return '[non-string-body]';
    } catch {
      return null;
    }
  }

  async function bodyFromRequest(input) {
    try {
      if (!input || typeof input !== 'object' || typeof input.clone !== 'function') return null;
      const cloned = input.clone();
      const text = await cloned.text();
      return text ? text.slice(0, 100000) : null;
    } catch {
      return null;
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function foundersFetch(input, init) {
    const started = Date.now();
    const urlObj = parseUrl(input);
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    let requestBody = bodyFromInit(init);
    if (!requestBody) requestBody = await bodyFromRequest(input);
    const response = await originalFetch.apply(this, arguments);

    if (isConsoleApi(urlObj)) {
      try {
        const clone = response.clone();
        const contentType = clone.headers.get('content-type') || '';
        const text = await clone.text();
        capture(
          {
            transport: 'fetch',
            method,
            url: urlObj.href,
            pathname: urlObj.pathname,
            search: urlObj.search,
            status: response.status,
            contentType,
            durationMs: Date.now() - started,
            requestBody
          },
          text
        );
      } catch {
        /* ignore capture errors */
      }
    }

    return response;
  };

  const OriginalXHR = window.XMLHttpRequest;
  function WrappedXHR() {
    const xhr = new OriginalXHR();
    let method = 'GET';
    let url = '';
    let started = 0;
    let requestBody = null;

    const open = xhr.open;
    xhr.open = function (m, u) {
      method = String(m || 'GET').toUpperCase();
      url = String(u || '');
      return open.apply(xhr, arguments);
    };

    const send = xhr.send;
    xhr.send = function (body) {
      started = Date.now();
      if (typeof body === 'string') requestBody = body.slice(0, 100000);
      xhr.addEventListener('loadend', () => {
        const urlObj = parseUrl(url);
        if (!isConsoleApi(urlObj)) return;
        let contentType = '';
        try {
          contentType = xhr.getResponseHeader('content-type') || '';
        } catch {
          /* ignore */
        }
        let text = '';
        try {
          text = xhr.responseText || '';
        } catch {
          text = '';
        }
        capture(
          {
            transport: 'xhr',
            method,
            url: urlObj.href,
            pathname: urlObj.pathname,
            search: urlObj.search,
            status: xhr.status,
            contentType,
            durationMs: Date.now() - started,
            requestBody
          },
          text
        );
      });
      return send.apply(xhr, arguments);
    };

    return xhr;
  }

  WrappedXHR.prototype = OriginalXHR.prototype;
  window.XMLHttpRequest = WrappedXHR;

  window.postMessage({ source: SOURCE, type: 'hook-ready', payload: { at: Date.now() } }, '*');
})();
