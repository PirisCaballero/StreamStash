// Descarga un stream HLS: lee la playlist, baja los segmentos en paralelo y los une en un archivo.
const CONCURRENCY = 6;
const RETRIES = 3;

const params = new URLSearchParams(location.search);
const SRC = params.get("url");
const REFERER = params.get("referer") || "";
const TITLE = params.get("title") || "video";

const $ = (id) => document.getElementById(id);
let busy = false;
const REPORT = [];

window.addEventListener("beforeunload", (e) => {
  if (busy) { e.preventDefault(); e.returnValue = ""; }
});

function formatSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function note(text) {
  $("notes").append(Object.assign(document.createElement("p"), { textContent: text }));
}

class UserError extends Error {}

function diag(label, lines) {
  $("diag").hidden = false;
  $("diagText").textContent += `[${label}]\n${lines.join("\n")}\n\n`;
}

// ---------- Referer / Origin: muchas webs devuelven 403 sin ellos ----------
async function addRefererRule() {
  if (!REFERER) return null;
  const tab = await chrome.tabs.getCurrent();
  let origin;
  try { origin = new URL(REFERER).origin; } catch { return null; }
  if (!tab || !/^https?:/.test(origin)) return null;

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tab.id],
    addRules: [{
      id: tab.id,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Referer", operation: "set", value: REFERER },
          { header: "Origin", operation: "set", value: origin },
        ],
      },
      condition: { tabIds: [tab.id], resourceTypes: ["xmlhttprequest", "other"] },
    }],
  });
  return tab.id;
}

// ---------- Red ----------
async function fetchWithRetry(url, as) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { credentials: "include", cache: "no-store" });
      if (res.status === 403 || res.status === 401) {
        throw new UserError("La web ha denegado el acceso (error " + res.status + "). Recarga la página del vídeo, reprodúcelo unos segundos y vuelve a intentarlo.");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return as === "text" ? await res.text() : await res.blob();
    } catch (e) {
      if (e instanceof UserError) throw e;
      lastError = e;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  throw new Error(`No se pudo descargar ${url.split("?")[0]} (${lastError?.message})`);
}

// ---------- Parser M3U8 ----------
function parseAttrs(str) {
  const out = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(str))) out[m[1]] = m[2].replace(/^"|"$/g, "");
  return out;
}

function parsePlaylist(text, baseUrl) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== "#EXTM3U") throw new UserError("El enlace no es una playlist HLS válida.");

  const pl = { variants: [], audio: [], segments: [], init: null, encrypted: false, byterange: false, ended: false, duration: 0, duplicates: 0, segDurations: [] };
  let pendingVariant = null;
  let pendingDuration = 0;
  const seen = new Set();
  const abs = (u) => new URL(u, baseUrl).href;

  for (const line of lines) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const a = parseAttrs(line.slice(18));
      pendingVariant = { bandwidth: Number(a.BANDWIDTH) || 0, resolution: a.RESOLUTION || "", audio: a.AUDIO || null };
    } else if (line.startsWith("#EXT-X-MEDIA:")) {
      const a = parseAttrs(line.slice(13));
      if (a.TYPE === "AUDIO" && a.URI) {
        pl.audio.push({ group: a["GROUP-ID"], isDefault: a.DEFAULT === "YES", url: abs(a.URI) });
      }
    } else if (line.startsWith("#EXT-X-KEY:") || line.startsWith("#EXT-X-SESSION-KEY:")) {
      const a = parseAttrs(line.slice(line.indexOf(":") + 1));
      if (a.METHOD && a.METHOD !== "NONE") pl.encrypted = true;
    } else if (line.startsWith("#EXT-X-MAP:")) {
      const a = parseAttrs(line.slice(11));
      if (a.BYTERANGE) pl.byterange = true;
      if (!pl.init) pl.init = abs(a.URI);
    } else if (line.startsWith("#EXT-X-BYTERANGE")) {
      pl.byterange = true;
    } else if (line.startsWith("#EXTINF:")) {
      pendingDuration = parseFloat(line.slice(8)) || 0;
    } else if (line.startsWith("#EXT-X-ENDLIST")) {
      pl.ended = true;
    } else if (!line.startsWith("#")) {
      if (pendingVariant) {
        pl.variants.push({ ...pendingVariant, url: abs(line) });
        pendingVariant = null;
      } else {
        const url = abs(line);
        if (seen.has(url)) {
          pl.duplicates++;
        } else {
          seen.add(url);
          pl.segments.push(url);
          pl.segDurations.push(pendingDuration);
          pl.duration += pendingDuration;
        }
        pendingDuration = 0;
      }
    }
  }
  return pl;
}

function checkSupported(pl) {
  if (pl.encrypted) throw new UserError("Este vídeo está cifrado o protegido, así que no se puede descargar.");
  if (pl.byterange) throw new UserError("Este stream usa rangos de bytes, un formato que la extensión aún no admite.");
  if (!pl.ended) throw new UserError("Parece una emisión en directo. Solo se pueden descargar vídeos completos.");
  if (!pl.segments.length) throw new UserError("La playlist no contiene fragmentos de vídeo.");
}

// ---------- Descarga de segmentos ----------
async function downloadMedia(pl, label) {
  checkSupported(pl);
  const total = pl.segments.length;
  const parts = new Array(total);
  let next = 0, done = 0, bytes = 0, failed = false;
  const started = Date.now();

  $("status").textContent = `Descargando ${label}…`;
  $("bar").value = 0;
  if (label !== "audio" && pl.duration) {
    const q = $("quality").textContent;
    $("quality").textContent = (q ? q + " · " : "") + `Duración: ${formatTime(pl.duration)}`;
  }
  if (pl.duplicates) note(`La playlist repetía ${pl.duplicates} fragmentos; se han descartado los duplicados.`);

  async function worker() {
    while (!failed) {
      const i = next++;
      if (i >= total) return;
      try {
        parts[i] = await fetchWithRetry(pl.segments[i], "blob");
      } catch (e) {
        failed = true;
        throw e;
      }
      done++;
      bytes += parts[i].size;
      const secs = (Date.now() - started) / 1000;
      $("bar").value = done / total;
      $("detail").textContent =
        `${done} de ${total} fragmentos · ${formatSize(bytes)} · ${formatSize(bytes / Math.max(secs, 1))}/s`;
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));

  const first = pl.segments[0].split("?")[0];
  const fmp4 = !!pl.init || /\.(mp4|m4s|m4v|m4a)$/i.test(first);
  let head = [];

  if (pl.init) {
    const initBlob = await fetchWithRetry(pl.init, "blob");
    const initBuf = await initBlob.arrayBuffer();
    try {
      $("status").textContent = `Convirtiendo el ${label} a MP4 estándar…`;
      const result = await remuxFmp4(initBuf.slice(0), parts, (p) => { $("bar").value = p; });
      diag(label, [
        "Formato final: MP4 estándar",
        `Duración según la playlist: ${formatTime(pl.duration)}`,
        ...result.summary.map((t) => `Pista ${t.id} (escala ${t.ts}): ${formatTime(t.sec)} · ${t.samples} muestras`),
        `Duración del archivo: ${formatTime(result.movieSec)} · fragmentos: ${parts.length}`,
      ]);
      return { blob: result.blob, ext: label === "audio" ? "m4a" : "mp4" };
    } catch (e) {
      console.warn("Conversión a MP4 estándar fallida; se usa MP4 fragmentado", e);
      diag(label, [`Conversión a MP4 estándar fallida: ${e.message}`]);
    }
  {
    head = [initBlob];
    try {
      $("status").textContent = `Ajustando la línea de tiempo del ${label}…`;
      const info = inspectInit(initBuf);
      const state = { ...info, next: null, offsetSec: 0, gaps: 0, unparsed: 0, lastRawSec: null };

      for (let i = 0; i < parts.length; i++) {
        parts[i] = await normalizeSegment(parts[i], state);
        if (i % 20 === 0) $("bar").value = i / parts.length;
      }

      const perTrack = [...state.next].map(([id, ticks]) => {
        const ts = info.timescales.get(id);
        return { id, ts, sec: ts ? Number(ticks) / ts : 0 };
      });
      const measured = Math.max(0, ...perTrack.map((t) => t.sec));
      const finalDuration = measured || pl.duration;
      head = [fixInitSegment(initBuf, finalDuration)];

      diag(label, [
        `Duración según la playlist: ${formatTime(pl.duration)}`,
        ...perTrack.map((t) => `Pista ${t.id} (escala ${t.ts}): ${formatTime(t.sec)}`),
        `Duración escrita en el archivo: ${formatTime(finalDuration)}`,
        `Fragmentos: ${parts.length} · duplicados descartados: ${pl.duplicates}`,
        `Tiempo inicial original: ${formatTime(state.offsetSec)} · último tiempo original: ${state.lastRawSec !== null ? formatTime(state.lastRawSec) : "?"}`,
        `Saltos de tiempo corregidos: ${state.gaps} · fragmentos no analizables: ${state.unparsed}`,
      ]);

      if (pl.duration && Math.abs(measured - pl.duration) / pl.duration > 0.05) {
        note(`Aviso: los fragmentos suman ${formatTime(measured)} pero la web indica ${formatTime(pl.duration)}. Abre "Detalles técnicos" y pásame los datos.`);
      }
    } catch (e) {
      console.warn("No se pudo reconstruir la línea de tiempo", e);
      note("No se pudo ajustar la duración de este vídeo; el reproductor podría mostrar un tiempo incorrecto.");
      diag(label, [`Error al ajustar: ${e.message}`]);
    }
  }
  }

  const isAudio = label === "audio";
  const ext = fmp4 ? (isAudio ? "m4a" : "mp4") : /\.aac$/i.test(first) ? "aac" : "ts";
  const type = fmp4 ? (isAudio ? "audio/mp4" : "video/mp4") : "video/mp2t";

  return { blob: new Blob([...head, ...parts], { type }), ext };
}

function saveBlob(blob, filename) {
  return new Promise(async (resolve, reject) => {
    const url = URL.createObjectURL(blob);
    try {
      const id = await chrome.downloads.download({ url, filename, saveAs: false });
      const onChanged = (delta) => {
        if (delta.id !== id || !delta.state) return;
        if (delta.state.current === "complete" || delta.state.current === "interrupted") {
          chrome.downloads.onChanged.removeListener(onChanged);
          URL.revokeObjectURL(url);
          delta.state.current === "complete" ? resolve() : reject(new Error("El navegador interrumpió el guardado del archivo."));
        }
      };
      chrome.downloads.onChanged.addListener(onChanged);
    } catch (e) {
      URL.revokeObjectURL(url);
      reject(e);
    }
  });
}


// ---------- Reconstrucción de la línea de tiempo en MP4 fragmentado ----------
function formatTime(sec) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(r).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function readBoxes(dv, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p);
    let header = 8;
    const type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
    if (size === 1) { size = Number(dv.getBigUint64(p + 8)); header = 16; }
    else if (size === 0) { size = end - p; }
    if (size < header || p + size > end) break;
    out.push({ type, start: p, header, end: p + size });
    p += size;
  }
  return out;
}
const children = (dv, box, type) => readBoxes(dv, box.start + box.header, box.end).filter((b) => b.type === type);
const child = (dv, box, type) => children(dv, box, type)[0];
const readVar = (dv, o, big) => (big ? dv.getBigUint64(o) : BigInt(dv.getUint32(o)));
function writeVar(dv, o, big, value) {
  if (value < 0n) value = 0n;
  if (big) dv.setBigUint64(o, value);
  else dv.setUint32(o, Number(value > 0xffffffffn ? 0xffffffffn : value));
}
// Convierte un box en "free": los reproductores lo ignoran sin cambiar tamaños
function neutralize(dv, box) {
  "free".split("").forEach((c, i) => dv.setUint8(box.start + 4 + i, c.charCodeAt(0)));
}

// Escalas de tiempo y duración por defecto de cada pista
function inspectInit(buffer) {
  const dv = new DataView(buffer);
  const moov = readBoxes(dv, 0, buffer.byteLength).find((b) => b.type === "moov");
  if (!moov) throw new Error("El segmento init no contiene moov");
  const timescales = new Map(), defaults = new Map();

  for (const trak of children(dv, moov, "trak")) {
    const tkhd = child(dv, trak, "tkhd");
    const o = tkhd.start + tkhd.header;
    const trackId = dv.getUint32(o + (dv.getUint8(o) === 1 ? 20 : 12));
    const mdia = child(dv, trak, "mdia");
    const mdhd = mdia && child(dv, mdia, "mdhd");
    if (mdhd) {
      const m = mdhd.start + mdhd.header;
      timescales.set(trackId, dv.getUint32(m + (dv.getUint8(m) === 1 ? 20 : 12)));
    }
  }
  const mvex = child(dv, moov, "mvex");
  for (const trex of mvex ? children(dv, mvex, "trex") : []) {
    const o = trex.start + trex.header;
    defaults.set(dv.getUint32(o + 4), dv.getUint32(o + 12));
  }
  return { timescales, defaults };
}

// Escribe la duración real en la cabecera y desactiva las edit lists
function fixInitSegment(buffer, durationSec) {
  const dv = new DataView(buffer);
  const moov = readBoxes(dv, 0, buffer.byteLength).find((b) => b.type === "moov");

  const mvhd = child(dv, moov, "mvhd");
  let o = mvhd.start + mvhd.header;
  const mvV1 = dv.getUint8(o) === 1;
  const mvTs = dv.getUint32(o + (mvV1 ? 20 : 12));
  const movieDur = BigInt(Math.round(durationSec * mvTs));
  writeVar(dv, o + (mvV1 ? 24 : 16), mvV1, movieDur);

  for (const trak of children(dv, moov, "trak")) {
    const tkhd = child(dv, trak, "tkhd");
    o = tkhd.start + tkhd.header;
    const tkV1 = dv.getUint8(o) === 1;
    writeVar(dv, o + (tkV1 ? 28 : 20), tkV1, movieDur);

    const mdia = child(dv, trak, "mdia");
    const mdhd = mdia && child(dv, mdia, "mdhd");
    if (mdhd) {
      o = mdhd.start + mdhd.header;
      const mdV1 = dv.getUint8(o) === 1;
      const ts = dv.getUint32(o + (mdV1 ? 20 : 12));
      writeVar(dv, o + (mdV1 ? 24 : 16), mdV1, BigInt(Math.round(durationSec * ts)));
    }
    // Las edit lists (entradas vacías, desfases) pueden sumar tiempo extra: se desactivan
    for (const edts of children(dv, trak, "edts")) neutralize(dv, edts);
  }

  const mvex = child(dv, moov, "mvex");
  if (!mvex) return buffer;
  const mehd = child(dv, mvex, "mehd");
  if (mehd) {
    o = mehd.start + mehd.header;
    writeVar(dv, o + 4, dv.getUint8(o) === 1, movieDur);
    return buffer;
  }
  if (moov.header !== 8 || mvex.header !== 8) return buffer;

  const insertAt = mvex.start + mvex.header;
  const out = new Uint8Array(buffer.byteLength + 20);
  out.set(new Uint8Array(buffer, 0, insertAt), 0);
  out.set(new Uint8Array(buffer, insertAt), insertAt + 20);
  const odv = new DataView(out.buffer);
  odv.setUint32(insertAt, 20);
  odv.setUint32(insertAt + 4, 0x6d656864); // "mehd"
  odv.setUint32(insertAt + 8, 0x01000000); // versión 1
  odv.setBigUint64(insertAt + 12, movieDur);
  odv.setUint32(moov.start, odv.getUint32(moov.start) + 20);
  odv.setUint32(mvex.start, odv.getUint32(mvex.start) + 20);
  return out.buffer;
}

// Duración real de un traf sumando las muestras de sus trun
function trafDuration(dv, traf, defaults) {
  const tfhd = child(dv, traf, "tfhd");
  let o = tfhd.start + tfhd.header;
  const flags = dv.getUint32(o) & 0xffffff;
  const trackId = dv.getUint32(o + 4);
  let p = o + 8;
  if (flags & 0x01) p += 8;
  if (flags & 0x02) p += 4;
  const defDur = flags & 0x08 ? dv.getUint32(p) : defaults.get(trackId) ?? 0;

  let dur = 0n;
  for (const trun of children(dv, traf, "trun")) {
    const t = trun.start + trun.header;
    const tf = dv.getUint32(t) & 0xffffff;
    const count = dv.getUint32(t + 4);
    let q = t + 8;
    if (tf & 0x001) q += 4;
    if (tf & 0x004) q += 4;
    const per = [0x100, 0x200, 0x400, 0x800].reduce((s, f) => s + (tf & f ? 4 : 0), 0);
    if (tf & 0x100) {
      for (let i = 0; i < count && q + i * per + 4 <= trun.end; i++) dur += BigInt(dv.getUint32(q + i * per));
    } else {
      dur += BigInt(defDur) * BigInt(count);
    }
  }
  return { trackId, dur };
}

// Reescribe el tfdt de cada fragmento para que empiece justo donde acabó el anterior
async function normalizeSegment(blob, state) {
  const headLen = Math.min(blob.size, 2 * 1024 * 1024);
  const buf = await blob.slice(0, headLen).arrayBuffer();
  const dv = new DataView(buf);
  const top = readBoxes(dv, 0, buf.byteLength);
  const moof = top.find((b) => b.type === "moof");
  if (!moof) { state.unparsed++; return blob; }

  for (const sidx of top.filter((b) => b.type === "sidx")) neutralize(dv, sidx);

  const trafs = children(dv, moof, "traf").map((traf) => {
    const { trackId, dur } = trafDuration(dv, traf, state.defaults);
    const tfdt = child(dv, traf, "tfdt");
    let off = null, v1 = false, base = null;
    if (tfdt) {
      const o = tfdt.start + tfdt.header;
      v1 = dv.getUint8(o) === 1;
      off = o + 4;
      base = readVar(dv, off, v1);
    }
    return { trackId, dur, off, v1, base, ts: state.timescales.get(trackId) || 0 };
  });

  if (!state.next) {
    // Primer fragmento: se conserva la diferencia inicial entre audio y vídeo, pero empezando en 0
    state.next = new Map();
    const secs = trafs.filter((t) => t.ts && t.base !== null).map((t) => Number(t.base) / t.ts);
    state.offsetSec = secs.length ? Math.min(...secs) : 0;
    for (const t of trafs) {
      const startTicks = t.base !== null && t.ts ? t.base - BigInt(Math.round(state.offsetSec * t.ts)) : 0n;
      state.next.set(t.trackId, startTicks < 0n ? 0n : startTicks);
    }
  }

  for (const t of trafs) {
    if (!state.next.has(t.trackId)) state.next.set(t.trackId, 0n);
    const expected = state.next.get(t.trackId);
    if (t.base !== null && t.ts) {
      const original = t.base - BigInt(Math.round(state.offsetSec * t.ts));
      const diff = original > expected ? original - expected : expected - original;
      if (diff > BigInt(Math.ceil(t.ts / 10))) state.gaps++;
      state.lastRawSec = Number(t.base) / t.ts;
      writeVar(dv, t.off, t.v1, expected);
    }
    state.next.set(t.trackId, expected + t.dur);
  }

  return new Blob([buf, blob.slice(headLen)]);
}

// ---------- Conversión de MP4 fragmentado a MP4 estándar (sin recodificar) ----------
function mkbox(type, ...parts) {
  const len = 8 + parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(len);
  new DataView(out.buffer).setUint32(0, len);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let p = 8;
  for (const part of parts) { out.set(part, p); p += part.byteLength; }
  return out;
}
function u32s(values) {
  const out = new Uint8Array(values.length * 4);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) dv.setUint32(i * 4, values[i] >>> 0);
  return out;
}
const fullbox = (type, version, flags, ...parts) => mkbox(type, u32s([(version << 24) | flags]), ...parts);

async function* walkTopBoxes(blob) {
  let pos = 0;
  while (pos + 8 <= blob.size) {
    const h = new DataView(await blob.slice(pos, pos + 16).arrayBuffer());
    let size = h.getUint32(0), header = 8;
    const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
    if (size === 1) { size = Number(h.getBigUint64(8)); header = 16; }
    else if (size === 0) size = blob.size - pos;
    if (size < header) break;
    yield { type, pos, size, header };
    pos += size;
  }
}

async function remuxFmp4(initBuf, segments, onProgress) {
  const idv = new DataView(initBuf);
  const moov = readBoxes(idv, 0, initBuf.byteLength).find((b) => b.type === "moov");
  if (!moov) throw new Error("init sin moov");

  // Datos por pista desde el init
  const tracks = new Map();
  for (const trak of children(idv, moov, "trak")) {
    const tkhd = child(idv, trak, "tkhd");
    const o = tkhd.start + tkhd.header;
    const id = idv.getUint32(o + (idv.getUint8(o) === 1 ? 20 : 12));
    const mdhd = child(idv, child(idv, trak, "mdia"), "mdhd");
    const m = mdhd.start + mdhd.header;
    tracks.set(id, {
      ts: idv.getUint32(m + (idv.getUint8(m) === 1 ? 20 : 12)),
      trex: { sdi: 1, dur: 0, size: 0, flags: 0 },
      durations: [], sizes: [], ctos: [], nonSync: [], chunks: [],
    });
  }
  const mvex = child(idv, moov, "mvex");
  for (const trex of mvex ? children(idv, mvex, "trex") : []) {
    const o = trex.start + trex.header;
    const t = tracks.get(idv.getUint32(o + 4));
    if (t) t.trex = { sdi: idv.getUint32(o + 8), dur: idv.getUint32(o + 12), size: idv.getUint32(o + 16), flags: idv.getUint32(o + 20) };
  }

  // Recorrer los fragmentos y construir las tablas de muestras
  let segBase = 0;
  for (let s = 0; s < segments.length; s++) {
    const blob = segments[s];
    for await (const top of walkTopBoxes(blob)) {
      if (top.type !== "moof") continue;
      const buf = await blob.slice(top.pos, top.pos + top.size).arrayBuffer();
      const dv = new DataView(buf);
      const moofBox = { start: 0, header: top.header, end: buf.byteLength };
      let prevEnd = top.pos, first = true;

      for (const traf of children(dv, moofBox, "traf")) {
        const tfhd = child(dv, traf, "tfhd");
        let o = tfhd.start + tfhd.header;
        const flags = dv.getUint32(o) & 0xffffff;
        const t = tracks.get(dv.getUint32(o + 4));
        let p = o + 8;
        let base;
        if (flags & 0x01) { base = Number(dv.getBigUint64(p)); p += 8; }
        else base = (flags & 0x020000) || first ? top.pos : prevEnd;
        first = false;
        if (!t) continue;
        let sdi = t.trex.sdi, defDur = t.trex.dur, defSize = t.trex.size, defFlags = t.trex.flags;
        if (flags & 0x02) { sdi = dv.getUint32(p); p += 4; }
        if (flags & 0x08) { defDur = dv.getUint32(p); p += 4; }
        if (flags & 0x10) { defSize = dv.getUint32(p); p += 4; }
        if (flags & 0x20) { defFlags = dv.getUint32(p); p += 4; }

        let dataPos = base;
        for (const trun of children(dv, traf, "trun")) {
          const tr = trun.start + trun.header;
          const v1 = dv.getUint8(tr) === 1;
          const tf = dv.getUint32(tr) & 0xffffff;
          const count = dv.getUint32(tr + 4);
          let q = tr + 8;
          if (tf & 0x001) { dataPos = base + dv.getInt32(q); q += 4; }
          let firstFlags = null;
          if (tf & 0x004) { firstFlags = dv.getUint32(q); q += 4; }
          if (count) t.chunks.push({ offset: segBase + dataPos, count, sdi });

          for (let i = 0; i < count; i++) {
            const dur = tf & 0x100 ? dv.getUint32(q) : defDur; if (tf & 0x100) q += 4;
            const size = tf & 0x200 ? dv.getUint32(q) : defSize; if (tf & 0x200) q += 4;
            let sflags = tf & 0x400 ? dv.getUint32(q) : i === 0 && firstFlags !== null ? firstFlags : defFlags;
            if (tf & 0x400) q += 4;
            let cto = 0;
            if (tf & 0x800) { cto = v1 ? dv.getInt32(q) : dv.getUint32(q); q += 4; }
            t.durations.push(dur);
            t.sizes.push(size);
            t.ctos.push(cto);
            if (sflags & 0x10000) t.nonSync.push(t.sizes.length); // número de muestra (base 1)
            dataPos += size;
          }
        }
        prevEnd = dataPos;
      }
    }
    segBase += blob.size;
    if (onProgress && s % 10 === 0) onProgress(s / segments.length);
  }

  // Duraciones
  const mvhd = child(idv, moov, "mvhd");
  const mo = mvhd.start + mvhd.header;
  const mvTs = idv.getUint32(mo + (idv.getUint8(mo) === 1 ? 20 : 12));
  const summary = [];
  let movieSec = 0;
  for (const [id, t] of tracks) {
    t.mediaDur = t.durations.reduce((a, b) => a + b, 0);
    let minCto = 0;
    for (const c of t.ctos) if (c < minCto) minCto = c;
    t.shift = minCto < 0 ? -minCto : 0;
    t.sec = t.ts ? t.mediaDur / t.ts : 0;
    if (t.sizes.length) movieSec = Math.max(movieSec, t.sec);
    summary.push({ id, ts: t.ts, sec: t.sec, samples: t.sizes.length });
  }
  const movieDur = Math.round(movieSec * mvTs);

  const copy = (box) => new Uint8Array(initBuf.slice(box.start, box.end));
  const patchDur = (bytes, header, offV0, offV1, value) => {
    const dv = new DataView(bytes.buffer);
    const v1 = dv.getUint8(header) === 1;
    if (v1) dv.setBigUint64(header + offV1, BigInt(value));
    else dv.setUint32(header + offV0, Math.min(value, 0xffffffff));
    return bytes;
  };
  const rle = (arr) => {
    const out = [];
    for (const v of arr) {
      if (out.length && out[out.length - 1][1] === v) out[out.length - 1][0]++;
      else out.push([1, v]);
    }
    return out;
  };

  function buildStbl(stbl, t) {
    const parts = [copy(child(idv, stbl, "stsd"))];
    const stts = rle(t.durations);
    parts.push(fullbox("stts", 0, 0, u32s([stts.length, ...stts.flat()])));
    if (t.ctos.some((c) => c !== 0)) {
      const ctts = rle(t.ctos.map((c) => c + t.shift));
      parts.push(fullbox("ctts", 0, 0, u32s([ctts.length, ...ctts.flat()])));
    }
    if (t.nonSync.length) {
      const nonSync = new Set(t.nonSync);
      const sync = [];
      for (let i = 1; i <= t.sizes.length; i++) if (!nonSync.has(i)) sync.push(i);
      parts.push(fullbox("stss", 0, 0, u32s([sync.length, ...sync])));
    }
    const stsc = [];
    t.chunks.forEach((c, i) => {
      const last = stsc[stsc.length - 1];
      if (!last || last[1] !== c.count || last[2] !== c.sdi) stsc.push([i + 1, c.count, c.sdi]);
    });
    parts.push(fullbox("stsc", 0, 0, u32s([stsc.length, ...stsc.flat()])));
    parts.push(fullbox("stsz", 0, 0, u32s([0, t.sizes.length, ...t.sizes])));
    const co64 = new Uint8Array(4 + t.chunks.length * 8);
    new DataView(co64.buffer).setUint32(0, t.chunks.length);
    parts.push(fullbox("co64", 0, 0, co64)); // offsets se rellenan al final
    t.co64Payload = co64;
    return mkbox("stbl", ...parts);
  }

  function rebuild(box, fn) {
    const kids = readBoxes(idv, box.start + box.header, box.end).map(fn).filter(Boolean);
    return mkbox(box.type, ...kids);
  }

  const moovKids = [];
  for (const b of readBoxes(idv, moov.start + moov.header, moov.end)) {
    if (b.type === "mvhd") moovKids.push(patchDur(copy(b), b.header, 16, 24, movieDur));
    else if (b.type === "mvex") continue;
    else if (b.type === "trak") {
      const tkhd = child(idv, b, "tkhd");
      const o = tkhd.start + tkhd.header;
      const t = tracks.get(idv.getUint32(o + (idv.getUint8(o) === 1 ? 20 : 12)));
      if (!t || !t.sizes.length) continue;
      const kids = [];
      for (const k of readBoxes(idv, b.start + b.header, b.end)) {
        if (k.type === "tkhd") {
          kids.push(patchDur(copy(k), k.header, 20, 28, Math.round(t.sec * mvTs)));
          if (t.shift) {
            const elst = new Uint8Array(12);
            const edv = new DataView(elst.buffer);
            edv.setUint32(0, Math.round(t.sec * mvTs));
            edv.setInt32(4, t.shift);
            edv.setUint32(8, 0x10000);
            kids.push(mkbox("edts", fullbox("elst", 0, 0, u32s([1]), elst)));
          }
        } else if (k.type === "edts") continue;
        else if (k.type === "mdia") {
          kids.push(rebuild(k, (m) => {
            if (m.type === "mdhd") return patchDur(copy(m), m.header, 16, 24, t.mediaDur);
            if (m.type === "minf") return rebuild(m, (n) => (n.type === "stbl" ? buildStbl(n, t) : copy(n)));
            return copy(m);
          }));
        } else kids.push(copy(k));
      }
      moovKids.push(mkbox("trak", ...kids));
    } else moovKids.push(copy(b));
  }
  const moovOut = mkbox("moov", ...moovKids);

  const ftyp = mkbox("ftyp", new Uint8Array([..."isom"].map((c) => c.charCodeAt(0))), u32s([0x200]),
    new Uint8Array([..."isomiso2avc1mp41"].map((c) => c.charCodeAt(0))));
  const payloadStart = ftyp.byteLength + moovOut.byteLength + 16;
  for (const t of tracks.values()) {
    if (!t.co64Payload) continue;
    const dv = new DataView(t.co64Payload.buffer);
    t.chunks.forEach((c, i) => dv.setBigUint64(4 + i * 8, BigInt(payloadStart + c.offset)));
  }
  // co64Payload es una vista copiada dentro de moovOut: hay que reescribir en moovOut
  rewriteCo64(moovOut, tracks, payloadStart);

  const mdatHeader = new Uint8Array(16);
  const mh = new DataView(mdatHeader.buffer);
  mh.setUint32(0, 1);
  mdatHeader.set([..."mdat"].map((c) => c.charCodeAt(0)), 4);
  mh.setBigUint64(8, BigInt(16 + segBase));

  return { blob: new Blob([ftyp, moovOut, mdatHeader, ...segments], { type: "video/mp4" }), summary, movieSec };
}

// Rellena los co64 dentro del moov ya serializado (en el mismo orden que las pistas)
function rewriteCo64(moovBytes, tracks, payloadStart) {
  const dv = new DataView(moovBytes.buffer, moovBytes.byteOffset, moovBytes.byteLength);
  const moovBox = { start: 0, header: 8, end: moovBytes.byteLength };
  for (const trak of children(dv, moovBox, "trak")) {
    const tkhd = child(dv, trak, "tkhd");
    const o = tkhd.start + tkhd.header;
    const t = tracks.get(dv.getUint32(o + (dv.getUint8(o) === 1 ? 20 : 12)));
    const stbl = child(dv, child(dv, child(dv, trak, "mdia"), "minf"), "stbl");
    const co64 = child(dv, stbl, "co64");
    const base = co64.start + co64.header + 8;
    t.chunks.forEach((c, i) => dv.setBigUint64(base + i * 8, BigInt(payloadStart + c.offset)));
  }
}

// ---------- Flujo principal ----------
async function run() {
  $("title").textContent = TITLE;
  document.title = `StreamStash · ${TITLE}`;
  let ruleId = null;
  busy = true;

  try {
    ruleId = await addRefererRule();

    let pl = parsePlaylist(await fetchWithRetry(SRC, "text"), SRC);
    let audioUrl = null;

    if (pl.variants.length) {
      if (pl.encrypted) checkSupported(pl);
      const best = [...pl.variants].sort((a, b) => b.bandwidth - a.bandwidth)[0];
      const kbps = Math.round(best.bandwidth / 1000);
      $("quality").textContent = `Calidad: ${best.resolution || "máxima disponible"}${kbps ? ` · ${kbps} kbps` : ""}`;

      if (best.audio) {
        const tracks = pl.audio.filter((t) => t.group === best.audio);
        audioUrl = (tracks.find((t) => t.isDefault) ?? tracks[0])?.url ?? null;
      }
      pl = parsePlaylist(await fetchWithRetry(best.url, "text"), best.url);
    }

    const video = await downloadMedia(pl, "vídeo");
    $("status").textContent = "Guardando archivo…";
    await saveBlob(video.blob, `${TITLE}.${video.ext}`);

    if (audioUrl) {
      const apl = parsePlaylist(await fetchWithRetry(audioUrl, "text"), audioUrl);
      const audio = await downloadMedia(apl, "audio");
      $("status").textContent = "Guardando audio…";
      await saveBlob(audio.blob, `${TITLE} (audio).${audio.ext}`);
      note("Esta web sirve el audio por separado, así que se han guardado dos archivos: vídeo y audio.");
    }

    if (video.ext === "ts") {
      note("El vídeo se ha guardado en formato .ts. Se abre con VLC o IINA; QuickTime no lo reproduce y algunos reproductores pueden mostrar mal la duración.");
    }

    document.body.className = "ok";
    $("status").textContent = "Descarga completada";
    $("bar").value = 1;
  } catch (e) {
    console.error(e);
    document.body.className = "error";
    $("status").textContent = "No se pudo descargar";
    $("detail").textContent = e.message;
  } finally {
    busy = false;
    if (ruleId !== null) {
      chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {});
    }
  }
}

$("copyDiag").onclick = async () => {
  await navigator.clipboard.writeText($("diag").textContent);
  $("copyDiag").textContent = "Copiado";
};

run();
