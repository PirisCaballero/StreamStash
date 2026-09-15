// Detecta vídeos por dos vías: cabeceras de red (webRequest) y el DOM (content.js).
// Guarda la lista por pestaña en storage.session.

const VIDEO_EXT = /\.(mp4|webm|mkv|mov|m4v|ogv|m3u8|mpd)(\?|#|$)/i;
const SEGMENT = /\.(ts|m4s|aac)(\?|#|$)/i;
const STREAM_CT = /(mpegurl|dash\+xml)/i;

const locks = new Map();
function withLock(tabId, fn) {
  const prev = locks.get(tabId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(tabId, next);
  return next;
}

const keyFor = (tabId) => `tab:${tabId}`;

function addVideo(tabId, video) {
  if (tabId < 0) return;
  return withLock(tabId, async () => {
    const key = keyFor(tabId);
    const list = (await chrome.storage.session.get(key))[key] ?? [];
    const existing = list.find((v) => v.url === video.url);
    if (existing) {
      if (!existing.size && video.size) existing.size = video.size;
      if (!existing.type && video.type) existing.type = video.type;
    } else {
      list.push(video);
    }
    await chrome.storage.session.set({ [key]: list });
    chrome.action.setBadgeText({ tabId, text: String(list.length) }).catch(() => {});
  });
}

function clearTab(tabId) {
  if (tabId < 0) return; // peticiones sin pestaña (precargas, workers…)
  return withLock(tabId, async () => {
    await chrome.storage.session.remove(keyFor(tabId));
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  });
}

// Nueva navegación en la pestaña: limpiar lista
chrome.webRequest.onBeforeRequest.addListener(
  (d) => { if (d.type === "main_frame") clearTab(d.tabId); },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (d.tabId < 0 || d.type === "main_frame") return;
    const header = (name) =>
      d.responseHeaders?.find((h) => h.name.toLowerCase() === name)?.value ?? "";

    const ct = header("content-type").toLowerCase();
    if (SEGMENT.test(d.url) || ct.includes("mp2t") || ct.includes("iso.segment")) return;

    const isVideo = ct.startsWith("video/") || STREAM_CT.test(ct) || VIDEO_EXT.test(d.url);
    if (!isVideo) return;

    // Si es una respuesta parcial (206), el tamaño real va en Content-Range
    const range = header("content-range").match(/\/(\d+)$/);
    const size = Number(range?.[1] ?? header("content-length")) || 0;

    addVideo(d.tabId, { url: d.url, type: ct, size, source: "network" });
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "dom-videos" && sender.tab) {
    for (const url of msg.urls) {
      addVideo(sender.tab.id, { url, type: "", size: 0, source: "page" });
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTab(tabId);
  locks.delete(tabId);
});
