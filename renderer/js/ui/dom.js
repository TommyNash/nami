// @ts-check
function namiEl(tag, attrs, text) {
  const node = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach((key) => {
      if (attrs[key] != null) node.setAttribute(key, String(attrs[key]));
    });
  }
  if (text != null) node.textContent = String(text);
  return node;
}

function namiEmpty(message) {
  return namiEl('div', { class: 'empty' }, message);
}
