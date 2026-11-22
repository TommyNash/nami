// @ts-check
const NamiLifecycle = (() => {
  /** @type {Map<string, Set<Function>>} */
  const cleanups = new Map();
  let current = '';

  function bucket(page) {
    let set = cleanups.get(page);
    if (!set) {
      set = new Set();
      cleanups.set(page, set);
    }
    return set;
  }

  return {
    current() {
      return current;
    },
    on(page, fn) {
      if (typeof fn === 'function') bucket(page).add(fn);
    },
    listen(page, target, type, fn, options) {
      target.addEventListener(type, fn, options);
      bucket(page).add(() => target.removeEventListener(type, fn, options));
    },
    enter(page) {
      current = page || '';
    },
    destroy(page) {
      const set = cleanups.get(page);
      if (!set) return;
      set.forEach((fn) => {
        try {
          fn();
        } catch (_) {}
      });
      set.clear();
    }
  };
})();
window.NamiLifecycle = NamiLifecycle;
