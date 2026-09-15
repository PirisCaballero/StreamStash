// Busca <video> y <source> con URL directa (las blob: son MSE y no se pueden descargar así).
(() => {
  const sent = new Set();

  function scan() {
    const found = [];
    document.querySelectorAll("video, video source").forEach((el) => {
      const raw = el.currentSrc || el.src;
      if (!raw || raw.startsWith("blob:") || raw.startsWith("data:")) return;
      const url = new URL(raw, location.href).href;
      if (!sent.has(url)) {
        sent.add(url);
        found.push(url);
      }
    });
    if (found.length) {
      chrome.runtime.sendMessage({ type: "dom-videos", urls: found }).catch(() => {});
    }
  }

  let timer;
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(scan, 800);
  };

  scan();
  new MutationObserver(debounced).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });
  // loadstart no burbujea, pero sí se captura
  document.addEventListener("loadstart", (e) => {
    if (e.target instanceof HTMLMediaElement) debounced();
  }, true);
})();
