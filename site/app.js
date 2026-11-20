(function () {
  const cfg = window.NAMI_SITE;

  const TARGETS = [
    { id: 'mac-arm', match: (n) => /\.dmg$/i.test(n) && /aarch64|arm64/i.test(n) },
    { id: 'mac-intel', match: (n) => /\.dmg$/i.test(n) && /x64|x86_64|intel/i.test(n) },
    { id: 'win', match: (n) => /\.exe$/i.test(n) && /setup|nsis|x64/i.test(n) }
  ];

  function setLink(id, href, label) {
    const el = document.getElementById(id);
    if (!el) return;
    el.href = href;
    if (label) el.querySelector('[data-label]').textContent = label;
    el.classList.remove('is-pending');
  }

  function setVersion(text) {
    document.querySelectorAll('[data-version]').forEach((el) => {
      el.textContent = text;
    });
  }

  async function load() {
    try {
      const res = await fetch(cfg.latestApi, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(String(res.status));
      const release = await res.json();
      const assets = Array.isArray(release.assets) ? release.assets : [];
      setVersion(release.tag_name || release.name || '');
      TARGETS.forEach((t) => {
        const asset = assets.find((a) => t.match(a.name));
        if (asset) setLink(`dl-${t.id}`, asset.browser_download_url, asset.name);
        else setLink(`dl-${t.id}`, release.html_url || cfg.releasesUrl, 'Скоро');
      });
    } catch (err) {
      console.warn('[site] не удалось получить релиз', err);
      setVersion('');
      TARGETS.forEach((t) => setLink(`dl-${t.id}`, cfg.releasesUrl, 'Все релизы'));
    }
  }

  document.querySelectorAll('[data-repo-link]').forEach((el) => {
    el.href = `https://github.com/${cfg.repo}`;
  });
  document.querySelectorAll('[data-releases-link]').forEach((el) => {
    el.href = cfg.releasesUrl;
  });

  load();
})();
