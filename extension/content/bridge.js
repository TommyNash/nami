(() => {
  const MAIN_SOURCE = 'nami-collector-main';

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== MAIN_SOURCE) return;

    if (data.type === 'hook-ready') {
      chrome.runtime.sendMessage({ type: 'hook-ready', payload: data.payload }).catch(() => {});
      return;
    }

    if (data.type === 'network-response') {
      chrome.runtime
        .sendMessage({ type: 'network-response', payload: data.payload })
        .catch(() => {});
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'ping-content') {
      sendResponse({
        ok: true,
        href: location.href,
        title: document.title
      });
      return true;
    }
    return false;
  });
})();
