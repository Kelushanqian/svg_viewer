/* ======= SVG Viewer Core =======
      Features:
      - Load from file / paste / URL.
      - Sanitize: remove script tags and on* attributes.
      - Inline external <image href="..."> if CORS allows.
      - Pan (single touch/mouse) and zoom (wheel / pinch).
      - Show and edit source, then "load source" to render.
      - Download cleaned SVG.
      */

const viewer = document.getElementById("viewer");
const svgContainer = document.getElementById("svgContainer");
const placeholder = document.getElementById("placeholder");
const fileInput = document.getElementById("fileInput");
const openFileBtn = document.getElementById("openFileBtn");
const pasteBtn = document.getElementById("pasteBtn");
const urlInput = document.getElementById("urlInput");
const sourceArea = document.getElementById("sourceArea");
const loadSource = document.getElementById("loadSource");
const statusEl = document.getElementById("status");
const downloadBtn = document.getElementById("downloadClean");
const inlineImgsBtn = document.getElementById("inlineImgs");
const clearBtn = document.getElementById("clearBtn");
const toggleSourceBtn = document.getElementById("toggleSource");
const zoomInBtn = document.getElementById("zoomIn");
const zoomOutBtn = document.getElementById("zoomOut");
const fitViewBtn = document.getElementById("fitView");
const toolbar = document.getElementById("toolbar");

let state = {
  scale: 1,
  tx: 0,
  ty: 0,
  minScale: 0.1,
  maxScale: 20,
  isPanning: false,
  lastX: 0,
  lastY: 0,
  pointers: new Map(),
  svgElement: null,
  viewBox: null,
};

function setStatus(t) {
  statusEl.textContent = "状态:" + t;
}

/* sanitization: remove script nodes and attributes starting with "on" */
function sanitizeSVGDocument(doc) {
  // remove <script> and <foreignObject> (foreignObject may contain HTML/JS)
  const scripts = doc.querySelectorAll("script");
  scripts.forEach((n) => n.remove());
  const foreign = doc.querySelectorAll("foreignObject");
  foreign.forEach((n) => n.remove());

  // remove attributes that start with "on"
  const all = doc.querySelectorAll("*");
  all.forEach((el) => {
    [...el.attributes].forEach((attr) => {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      // remove javascript: hrefs
      if (
        attr.value &&
        typeof attr.value === "string" &&
        attr.value.trim().toLowerCase().startsWith("javascript:")
      ) {
        el.removeAttribute(attr.name);
      }
    });
  });

  return doc;
}

/* parse text to SVGDocument */
function parseSVGText(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "image/svg+xml");
  // check for parsererror
  if (doc.querySelector("parsererror"))
    throw new Error("解析失败:不是合法的 SVG");
  return doc;
}

/* render sanitized svg doc into viewer */
function renderSVGDocument(doc) {
  const svg = doc.documentElement;
  // reset transform state
  state.scale = 1;
  state.tx = 0;
  state.ty = 0;
  state.svgElement = svg;
  // clear container
  svgContainer.innerHTML = "";
  svgContainer.style.display = "inline-block";
  // clone node to avoid weirdness
  const imported = document.importNode(svg, true);
  // ensure width/height or viewBox exists
  if (!imported.hasAttribute("viewBox")) {
    // try set viewBox from width/height if present
    const w = imported.getAttribute("width");
    const h = imported.getAttribute("height");
    if (w && h) {
      const wi = parseFloat(w);
      const hi = parseFloat(h);
      if (!isNaN(wi) && !isNaN(hi)) {
        imported.setAttribute("viewBox", `0 0 ${wi} ${hi}`);
      }
    }
  }
  svgContainer.appendChild(imported);
  svgContainer.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
  adjustFit();
  placeholder.style.display = "none";
  setStatus("已加载");
  sourceArea.value = new XMLSerializer().serializeToString(svg);
}

/* load from file */
fileInput.addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    setStatus("读取文件...");
    const txt = await f.text();
    const doc = parseSVGText(txt);
    sanitizeSVGDocument(doc);
    renderSVGDocument(doc);
  } catch (err) {
    setStatus("加载失败:" + err.message);
  }
});

/* drag & drop */
["dragover", "dragenter"].forEach((ev) => {
  viewer.addEventListener(ev, (e) => {
    e.preventDefault();
    e.dataTransfer && (e.dataTransfer.dropEffect = "copy");
  });
});
viewer.addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) {
    // 直接读取文件,不再通过 fileInput
    try {
      setStatus("读取文件...");
      const txt = await file.text();
      const doc = parseSVGText(txt);
      sanitizeSVGDocument(doc);
      renderSVGDocument(doc);
    } catch (err) {
      setStatus("加载失败:" + err.message);
    }
    return;
  }
  const text =
    e.dataTransfer.getData("text/plain") ||
    e.dataTransfer.getData("text/uri-list");
  if (text) {
    await loadFromTextOrUrl(text.trim());
  }
});

/* paste */
pasteBtn.addEventListener("click", async () => {
  try {
    const clip = await navigator.clipboard.readText();
    if (!clip) {
      setStatus("剪贴板为空");
      return;
    }
    await loadFromTextOrUrl(clip.trim());
  } catch (err) {
    setStatus("读取剪贴板失败:" + err.message);
  }
});

/* URL input */
urlInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    const v = urlInput.value.trim();
    if (v) await loadFromTextOrUrl(v);
  }
});

/* load from text or url intelligently */
async function loadFromTextOrUrl(input) {
  // if it looks like xml/svg
  if (input.startsWith("<svg") || input.includes("<svg")) {
    try {
      setStatus("解析 SVG 文本...");
      const doc = parseSVGText(input);
      sanitizeSVGDocument(doc);
      renderSVGDocument(doc);
    } catch (err) {
      setStatus("解析失败:" + err.message);
    }
    return;
  }
  // otherwise treat as URL
  try {
    setStatus("从 URL 拉取中...");
    const res = await fetch(input, { mode: "cors" });
    if (!res.ok) throw new Error("网络错误 " + res.status);
    const txt = await res.text();
    const doc = parseSVGText(txt);
    sanitizeSVGDocument(doc);
    renderSVGDocument(doc);
  } catch (err) {
    setStatus("URL 加载失败:" + err.message);
  }
}

/* load source text into viewer */
loadSource.addEventListener("click", () => {
  const txt = sourceArea.value.trim();
  if (!txt) {
    setStatus("源为空");
    return;
  }
  try {
    const doc = parseSVGText(txt);
    sanitizeSVGDocument(doc);
    renderSVGDocument(doc);
  } catch (err) {
    setStatus("载入失败:" + err.message);
  }
});

/* download cleaned svg */
downloadBtn.addEventListener("click", () => {
  if (!state.svgElement) {
    setStatus("没有可下载的 SVG");
    return;
  }
  const serializer = new XMLSerializer();
  const xml = serializer.serializeToString(state.svgElement);
  const blob = new Blob([xml], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cleaned.svg";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus("已生成下载(cleaned.svg)");
});

/* clear - 修复:重置 fileInput.value */
clearBtn.addEventListener("click", () => {
  svgContainer.innerHTML = "";
  svgContainer.style.display = "none";
  placeholder.style.display = "block";
  sourceArea.value = "";
  fileInput.value = ""; // 关键修复:重置文件输入
  urlInput.value = ""; // 同时清空 URL 输入框
  state.svgElement = null;
  state.scale = 1;
  state.tx = 0;
  state.ty = 0;
  setStatus("已清空");
});

/* toggle source area visibility - 改进:隐藏整个工具栏 */
let showSource = true;
toggleSourceBtn.addEventListener("click", () => {
  showSource = !showSource;
  toolbar.style.display = showSource ? "block" : "none";
  toggleSourceBtn.textContent = showSource ? "隐藏源" : "查看源";
});

/* attempt to inline external images (<image href="...">) */
inlineImgsBtn.addEventListener("click", async () => {
  if (!state.svgElement) {
    setStatus("先加载一个 SVG");
    return;
  }
  setStatus("尝试内联外部图片...");
  try {
    // operate on current source text
    let serializer = new XMLSerializer();
    let xml = serializer.serializeToString(state.svgElement);
    let doc = parseSVGText(xml);
    const images = Array.from(doc.querySelectorAll("image"));
    if (images.length === 0) {
      setStatus("没有 <image> 标记需要内联");
      return;
    }
    // for each image, try fetch
    for (const img of images) {
      const href =
        img.getAttribute("href") ||
        img.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (!href) continue;
      if (href.startsWith("data:")) continue; // already inline
      try {
        const res = await fetch(href, { mode: "cors" });
        if (!res.ok) throw new Error("fetch fail " + res.status);
        const blob = await res.blob();
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("读取失败"));
          reader.readAsDataURL(blob);
        });
        img.setAttribute("href", dataUrl);
      } catch (err) {
        // cannot fetch due to CORS or network; keep original
        console.warn("无法内联", href, err);
      }
    }
    // finished
    sanitizeSVGDocument(doc);
    renderSVGDocument(doc);
    setStatus("内联尝试完成(若部分图片因 CORS 未内联,保留原路径)");
  } catch (err) {
    setStatus("内联失败:" + err.message);
  }
});

/* zoom controls */
zoomInBtn.addEventListener("click", () => {
  setScale(state.scale * 1.2);
});
zoomOutBtn.addEventListener("click", () => {
  setScale(state.scale / 1.2);
});
fitViewBtn.addEventListener("click", adjustFit);

function setScale(s) {
  s = Math.max(state.minScale, Math.min(state.maxScale, s));
  state.scale = s;
  applyTransform();
}

/* transform apply */
function applyTransform() {
  svgContainer.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
}

/* fit to viewer */
function adjustFit() {
  if (!state.svgElement) return;
  // center
  state.tx = 0;
  state.ty = 0;
  state.scale = 1;
  applyTransform();
}

/* Pointer / Touch handling for pan & pinch */
viewer.addEventListener("pointerdown", (e) => {
  viewer.setPointerCapture(e.pointerId);
  state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});

viewer.addEventListener("pointermove", (e) => {
  if (!state.pointers.has(e.pointerId)) return;
  state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (state.pointers.size === 1) {
    // pan
    const p = Array.from(state.pointers.values())[0];
    if (state.isPanning === false) {
      state.isPanning = true;
      state.lastX = p.x;
      state.lastY = p.y;
    } else {
      const dx = p.x - state.lastX;
      const dy = p.y - state.lastY;
      state.tx += dx;
      state.ty += dy;
      state.lastX = p.x;
      state.lastY = p.y;
      applyTransform();
    }
  } else if (state.pointers.size === 2) {
    // pinch zoom
    const pts = Array.from(state.pointers.values());
    const p0 = pts[0],
      p1 = pts[1];
    const curDist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (!state._pinchStart) {
      state._pinchStart = {
        dist: curDist,
        scale: state.scale,
        center: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 },
      };
    } else {
      const ratio = curDist / state._pinchStart.dist;
      const newScale = Math.max(
        state.minScale,
        Math.min(state.maxScale, state._pinchStart.scale * ratio)
      );
      // zoom about pinch center: adjust tx/ty
      const rect = viewer.getBoundingClientRect();
      const cx = state._pinchStart.center.x - rect.left;
      const cy = state._pinchStart.center.y - rect.top;
      // transform movement math:
      // newTx = (oldTx) - (cx)*(newScale-oldScale)
      state.tx = state.tx - cx * (newScale - state.scale);
      state.ty = state.ty - cy * (newScale - state.scale);
      state.scale = newScale;
      applyTransform();
    }
  }
});

viewer.addEventListener("pointerup", (e) => {
  viewer.releasePointerCapture && viewer.releasePointerCapture(e.pointerId);
  state.pointers.delete(e.pointerId);
  state.isPanning = false;
  state._pinchStart = null;
});

viewer.addEventListener("pointercancel", (e) => {
  state.pointers.delete(e.pointerId);
  state.isPanning = false;
  state._pinchStart = null;
});

/* wheel to zoom (desktop) */
viewer.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.08 : 1 / 1.08;
    // zoom at mouse pos
    const rect = viewer.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const newScale = Math.max(
      state.minScale,
      Math.min(state.maxScale, state.scale * factor)
    );
    state.tx = state.tx - mx * (newScale - state.scale);
    state.ty = state.ty - my * (newScale - state.scale);
    state.scale = newScale;
    applyTransform();
  },
  { passive: false }
);

/* keyboard shortcuts (desktop) */
window.addEventListener("keydown", (e) => {
  if (e.key === "+" || e.key === "=") setScale(state.scale * 1.2);
  if (e.key === "-") setScale(state.scale / 1.2);
});

/* initial */
setStatus("就绪。拖入文件、粘贴或输入 URL 即可。");
