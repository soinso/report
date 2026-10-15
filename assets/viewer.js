import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.min.mjs";

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/";
pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "legacy/build/pdf.worker.min.mjs";

const PDF_URL = "assets/PROGRESS1_REPORT.pdf";
const PAD = 16;          // px around the page
const MAX_DPR = 2.5;     // cap backing-store scale for memory
const IDLE_MS = 2000;    // toolbar auto-hide delay (fullscreen)

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const holder = $("page-holder");
const cover = $("cover");
const statusEl = $("status");
const barFill = $("bar-fill");
const errorEl = $("error");
const toolbar = $("toolbar");
const prevBtn = $("prev");
const nextBtn = $("next");
const pageInput = $("page-input");
const pageCount = $("page-count");
const fsBtn = $("fullscreen");
const fsLabel = $("fs-label");

let pdf = null;
let total = 0;
let current = 1;
let token = 0;                 // invalidates in-flight renders
const cache = new Map();       // "page@w x h" -> canvas
const pending = new Map();     // same key -> Promise<canvas>

/* ---------- Sizing ---------- */
function stageBox() {
  const r = stage.getBoundingClientRect();
  return { w: Math.max(1, r.width - PAD * 2), h: Math.max(1, r.height - PAD * 2) };
}
function keyFor(n, box) {
  return `${n}@${Math.round(box.w)}x${Math.round(box.h)}`;
}

/* ---------- Rendering ---------- */
async function renderPage(n, box) {
  const key = keyFor(n, box);
  if (cache.has(key)) return cache.get(key);
  if (pending.has(key)) return pending.get(key);

  const job = (async () => {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const fit = Math.min(box.w / base.width, box.h / base.height);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const vp = page.getViewport({ scale: fit * dpr });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = Math.floor(base.width * fit) + "px";
    canvas.style.height = Math.floor(base.height * fit) + "px";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `หน้า ${n} จาก ${total}`);

    await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    cache.set(key, canvas);
    pending.delete(key);
    trimCache(box);
    return canvas;
  })();

  pending.set(key, job);
  job.catch(() => pending.delete(key));
  return job;
}

function trimCache(box) {
  // keep only pages near the current one at the current size
  for (const k of cache.keys()) {
    const [n, size] = k.split("@");
    const near = Math.abs(Number(n) - current) <= 2;
    if (!near || size !== `${Math.round(box.w)}x${Math.round(box.h)}`) cache.delete(k);
  }
}

async function show(n, { pushHash = true } = {}) {
  if (!pdf) return;
  n = Math.min(Math.max(1, n), total);
  current = n;
  const my = ++token;
  updateUI(pushHash);

  const box = stageBox();
  try {
    const canvas = await renderPage(n, box);
    if (my !== token) return;
    holder.replaceChildren(canvas);
  } catch (err) {
    console.error(err);
    return;
  }
  // warm neighbours
  if (n < total) renderPage(n + 1, box).catch(() => {});
  if (n > 1) renderPage(n - 1, box).catch(() => {});
}

function updateUI(pushHash) {
  pageInput.value = current;
  prevBtn.disabled = current <= 1;
  nextBtn.disabled = current >= total;
  if (pushHash) {
    const hash = `#page=${current}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }
}

const next = () => show(current + 1);
const prev = () => show(current - 1);

function pageFromHash() {
  const m = /page=(\d+)/.exec(location.hash);
  return m ? Number(m[1]) : 1;
}

/* ---------- Fullscreen ---------- */
const fsEnabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
if (!fsEnabled) document.body.classList.add("no-fs");

function isFs() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
function toggleFs() {
  if (!fsEnabled) return;
  if (isFs()) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    const el = document.documentElement;
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  }
}
function onFsChange() {
  const on = isFs();
  document.body.classList.toggle("fs", on);
  fsLabel.textContent = on ? "ออกจากเต็มจอ" : "เต็มจอ";
  fsBtn.title = on ? "ออกจากเต็มจอ (F)" : "เต็มจอ (F)";
  fsBtn.setAttribute("aria-label", on ? "ออกจากเต็มจอ" : "เต็มจอ");
  wake();
  refit();
}
document.addEventListener("fullscreenchange", onFsChange);
document.addEventListener("webkitfullscreenchange", onFsChange);

/* ---------- Toolbar auto-hide (fullscreen) ---------- */
let idleTimer = 0;
function wake() {
  toolbar.classList.remove("idle");
  document.body.classList.remove("idle-cursor");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!isFs() || toolbar.matches(":hover") || toolbar.contains(document.activeElement)) return;
    toolbar.classList.add("idle");
    document.body.classList.add("idle-cursor");
  }, IDLE_MS);
}
document.addEventListener("mousemove", wake);

/* ---------- Input ---------- */
prevBtn.addEventListener("click", prev);
nextBtn.addEventListener("click", next);
fsBtn.addEventListener("click", toggleFs);

pageInput.addEventListener("change", () => {
  const v = parseInt(pageInput.value, 10);
  if (Number.isFinite(v)) show(v); else pageInput.value = current;
});
pageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { pageInput.blur(); }
  e.stopPropagation();
});

document.addEventListener("keydown", (e) => {
  if (!pdf || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  switch (e.key) {
    case "ArrowRight": case "ArrowDown": case "PageDown": case " ":
      e.preventDefault(); next(); break;
    case "ArrowLeft": case "ArrowUp": case "PageUp":
      e.preventDefault(); prev(); break;
    case "Home": e.preventDefault(); show(1); break;
    case "End": e.preventDefault(); show(total); break;
    case "f": case "F": e.preventDefault(); toggleFs(); break;
    default: return;
  }
  wake();
});

// Mouse: left half = previous, right half = next
let touchStart = null;
let lastTouch = 0;
stage.addEventListener("click", (e) => {
  if (!pdf || Date.now() - lastTouch < 600) return;
  const r = stage.getBoundingClientRect();
  (e.clientX - r.left < r.width / 2 ? prev : next)();
});

// Touch: swipe to page; tap left/right third to page; tap middle shows toolbar
stage.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 1) { touchStart = null; return; }
  const t = e.touches[0];
  touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
}, { passive: true });

stage.addEventListener("touchend", (e) => {
  lastTouch = Date.now();
  if (!pdf || !touchStart || e.changedTouches.length !== 1) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) {
    (dx < 0 ? next : prev)();
    return;
  }
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
    const r = stage.getBoundingClientRect();
    const x = t.clientX - r.left;
    if (x < r.width / 3) prev();
    else if (x > (r.width * 2) / 3) next();
    else wake();
  }
}, { passive: true });

window.addEventListener("hashchange", () => {
  const n = pageFromHash();
  if (n !== current) show(n, { pushHash: false });
});

/* ---------- Resize ---------- */
let resizeTimer = 0;
function refit() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    cache.clear();
    show(current, { pushHash: false });
  }, 120);
}
window.addEventListener("resize", refit);
window.addEventListener("orientationchange", refit);

/* ---------- Load ---------- */
async function init() {
  const task = pdfjsLib.getDocument({
    url: PDF_URL,
    cMapUrl: PDFJS + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: PDFJS + "standard_fonts/",
    wasmUrl: PDFJS + "wasm/",
  });
  task.onProgress = ({ loaded, total: size }) => {
    if (size) barFill.style.width = Math.min(100, (loaded / size) * 100).toFixed(0) + "%";
  };

  try {
    pdf = await task.promise;
  } catch (err) {
    console.error(err);
    statusEl.hidden = true;
    errorEl.hidden = false;
    return;
  }

  total = pdf.numPages;
  pageCount.textContent = total;
  pageInput.max = total;
  barFill.style.width = "100%";

  await show(pageFromHash(), { pushHash: location.hash !== "" });
  cover.classList.add("hidden");
  wake();
}

init();
