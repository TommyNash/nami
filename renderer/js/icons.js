/** Phosphor Icons (@phosphor-icons/web) — классы вида `ph ph-sparkle`. */
window.FoundersIcons = {
  /** @param {string} name phosphor name without `ph-` prefix, or legacy alias */
  className(name) {
    const key = ALIASES[name] || String(name || 'info').replace(/^ph-/, '');
    return `ph ph-${key}`;
  },

  /** HTML for an icon (webfont <i>), size via font-size */
  svg(name, size = 14) {
    const cls = this.className(name);
    const s = Number(size) || 14;
    return `<i class="${cls}" style="font-size:${s}px" aria-hidden="true"></i>`;
  },

  el(name, size = 14) {
    const i = document.createElement('i');
    i.className = this.className(name);
    i.style.fontSize = `${Number(size) || 14}px`;
    i.setAttribute('aria-hidden', 'true');
    return i;
  }
};

const ALIASES = {
  games: 'game-controller',
  portfolio: 'briefcase',
  compare: 'arrows-left-right',
  collect: 'cloud-arrow-down',
  settings: 'gear',
  'trend-up': 'trend-up',
  'trend-down': 'trend-down',
  'chart-line': 'chart-line',
  'arrows-left-right': 'arrows-left-right',
  'arrows-down-up': 'arrows-down-up',
  'calendar-blank': 'calendar-blank',
  minus: 'minus',
  'plus-minus': 'plus-minus',
  info: 'info',
  'wave-sine': 'wave-sine',
  sparkle: 'sparkle',
  'arrow-right': 'arrow-right',
  'arrow-up-right': 'arrow-up-right',
  'arrow-left': 'arrow-left',
  check: 'check',
  'caret-down': 'caret-down',
  plus: 'plus'
};
