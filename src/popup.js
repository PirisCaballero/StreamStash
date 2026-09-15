const STREAM = /(\.m3u8|\.mpd)(\?|#|$)|mpegurl|dash\+xml/i;
const HLS = /\.m3u8(\?|#|$)|mpegurl/i;

function formatSize(bytes) {
  if (!bytes) return "tamaño desconocido";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function sanitize(name) {
  return (name || "video").replace(/[\\/:*?"<>|\n\r\t]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "video";
}

function nameFromUrl(url) {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "video";
  } catch { return "video"; }
}

function extFor(v) {
  const m = nameFromUrl(v.url).match(/\.(mp4|webm|mkv|mov|m4v|ogv)$/i);
  if (m) return m[1].toLowerCase();
  return v.type?.split("/")[1]?.split(";")[0] || "mp4";
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// Descarta ruido: segmentos de inicialización y sub-listas que ya cuelgan de una master
async function filterVideos(videos) {
  let list = videos.filter((v) => {
    const name = nameFromUrl(v.url);
    if (/^init[-_.]/i.test(name)) return false;
    if (!STREAM.test(v.url) && v.size > 0 && v.size < 100 * 1024) return false;
    return true;
  });

  const playlists = list.filter((v) => HLS.test(v.url) || HLS.test(v.type));
  if (playlists.length < 2) return list;

  const referenced = new Set();
  await Promise.all(playlists.map(async (p) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const text = await (await fetch(p.url, { credentials: "include", signal: ctrl.signal })).text();
      clearTimeout(t);
      if (!text.includes("#EXT-X-STREAM-INF")) return;
      p.isMaster = true;
      for (const line of text.split(/\r?\n/)) {
        const l = line.trim();
        if (l && !l.startsWith("#")) referenced.add(new URL(l, p.url).href.split("?")[0]);
      }
    } catch { /* si no se puede leer, se muestra tal cual */ }
  }));

  return list.filter((v) => v.isMaster || !referenced.has(v.url.split("?")[0]));
}

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const key = `tab:${tab.id}`;
  const stored = (await chrome.storage.session.get(key))[key] ?? [];
  const videos = await filterVideos(stored);
  const list = document.getElementById("list");
  const count = document.getElementById("count");
  list.replaceChildren();

  if (!videos.length) {
    count.textContent = "";
    list.append(el("li", {
      className: "empty",
      textContent: "No hay vídeos detectados. Reproduce el vídeo unos segundos y vuelve a abrir este panel.",
    }));
    return;
  }

  count.textContent = videos.length === 1 ? "1 vídeo" : `${videos.length} vídeos`;
  const title = sanitize(tab.title);

  // Streams primero: suelen ser el vídeo principal
  videos.sort((a, b) => STREAM.test(b.url) - STREAM.test(a.url));

  for (const v of videos) {
    const isHls = HLS.test(v.url) || HLS.test(v.type);
    const isDash = !isHls && STREAM.test(v.url + v.type);
    const btn = el("button", { className: "primary", textContent: "Descargar" });
    let meta;

    if (isHls) {
      meta = v.isMaster ? "Stream HLS · se descargará la mejor calidad" : "Stream HLS";
      btn.onclick = () => {
        const params = new URLSearchParams({ url: v.url, referer: tab.url, title });
        chrome.tabs.create({ url: chrome.runtime.getURL(`download.html?${params}`) });
        window.close();
      };
    } else if (isDash) {
      meta = "Stream DASH · todavía no compatible";
      btn.disabled = true;
    } else {
      meta = `${formatSize(v.size)} · detectado en ${v.source === "network" ? "red" : "página"}`;
      btn.onclick = async () => {
        try {
          await chrome.downloads.download({ url: v.url, filename: `${title}.${extFor(v)}` });
          btn.textContent = "Descargando";
          btn.disabled = true;
        } catch (e) {
          btn.textContent = "Error al descargar";
          console.error(e);
        }
      };
    }

    list.append(el("li", {}, [
      el("div", { className: "name", textContent: nameFromUrl(v.url) }),
      el("div", { className: "meta", textContent: meta }),
      el("div", { className: "actions" }, [btn]),
    ]));
  }
}

render();
