(function () {
  const esc = (value) => window.FoundersFormat.esc(value);

  function mount(slot, { onChange } = {}) {
    if (!slot) return;
    const i18n = window.NamiI18n;
    const current = i18n.languages.find((l) => l.code === i18n.lang);
    slot.innerHTML = `
      <button type="button" class="capsule-btn lang-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(T('lang.label'))}">
        <i class="ph ph-globe" aria-hidden="true"></i>
        <span>${esc(current.name)}</span>
        <i class="ph ph-caret-down lang-caret" aria-hidden="true"></i>
      </button>`;
    const button = slot.querySelector('.lang-btn');
    let menu = null;

    function close() {
      if (!menu) return;
      menu.remove();
      menu = null;
      button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
    }

    function onOutside(event) {
      if (menu && !menu.contains(event.target) && !button.contains(event.target)) close();
    }

    function onKey(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    }

    function choose(code) {
      close();
      if (code === i18n.lang) return;
      if (onChange) onChange(code);
      else i18n.reloadWith(code);
    }

    function open() {
      menu = document.createElement('ul');
      menu.className = 'lang-menu';
      menu.setAttribute('role', 'listbox');
      menu.innerHTML = i18n.languages
        .map((l) => {
          const active = l.code === i18n.lang;
          return `<li><button type="button" role="option" class="lang-opt ${active ? 'is-active' : ''}" aria-selected="${active}" data-lang="${esc(l.code)}">
            <span>${esc(l.name)}</span>${active ? '<i class="ph ph-check" aria-hidden="true"></i>' : ''}
          </button></li>`;
        })
        .join('');
      document.body.appendChild(menu);
      const rect = button.getBoundingClientRect();
      menu.style.minWidth = `${Math.max(rect.width, 160)}px`;
      menu.style.top = `${rect.bottom + 8}px`;
      menu.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
      menu.querySelectorAll('[data-lang]').forEach((opt) => {
        opt.onclick = () => choose(opt.dataset.lang);
      });
      button.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    }

    button.onclick = () => (menu ? close() : open());
  }

  window.NamiLangPicker = { mount };
})();
