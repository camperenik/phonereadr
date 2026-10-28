import * as pdfjs from './vendor/pdf.min.mjs';
import { extractBlocks } from './reflow.js';
import { FORMATS } from './parsers.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;

const $ = (id) => document.getElementById(id);
const DEFAULTS = { fontSize: 20, lineHeight: 1.55, margin: 20, paraGap: 0.9, font: 'serif', theme: 'light', align: 'left' };
const LIMITS = { fontSize: [12, 40, 0], lineHeight: [1.2, 2.2, 2], margin: [4, 48, 0], paraGap: [0.2, 2, 1] };
const THEME_COLOR = { light: '#fbfaf7', sepia: '#f4ecd8', dark: '#111112' };

// ---------- storage ----------
const db = new Promise((resolve, reject) => {
  const req = indexedDB.open('phonereadr', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('docs', { keyPath: 'id' });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function tx(mode, fn) {
  const d = await db;
  return new Promise((resolve, reject) => {
    const t = d.transaction('docs', mode);
    const r = fn(t.objectStore('docs'));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = () => reject(t.error);
  });
}
const putDoc = (doc) => tx('readwrite', (s) => s.put(doc));
const getDoc = (id) => tx('readonly', (s) => s.get(id));
const delDoc = (id) => tx('readwrite', (s) => s.delete(id));
const allDocs = () => tx('readonly', (s) => s.getAll());

let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('settings') || '{}')); } catch {}

// ---------- home ----------
let current = null; // open doc
async function renderHome() {
  const docs = (await allDocs()).sort((a, b) => b.opened - a.opened);
  $('empty').hidden = docs.length > 0;
  const ul = $('recent');
  ul.textContent = '';
  for (const d of docs) {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.className = 'open-doc';
    const pct = d.blocks.length ? Math.round((d.anchor / d.blocks.length) * 100) : 0;
    open.innerHTML = '<span class="name"></span><span class="meta"></span>';
    open.firstChild.textContent = d.name;
    open.lastChild.textContent = `${d.format === 'pdf' || !d.format ? d.pages + ' pages' : d.format.toUpperCase()} · ${pct}% read`;
    open.onclick = () => openDoc(d);
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Remove ' + d.name);
    del.onclick = async () => { if (confirm(`Remove "${d.name}" from this phone?`)) { await delDoc(d.id); renderHome(); } };
    li.append(open, del);
    ul.append(li);
  }
}

function setStatus(msg) {
  $('status').hidden = !msg;
  $('status').textContent = msg || '';
}

const fmtOf = (f) => (/\.(txt|epub|docx|md|markdown)$/i.exec(f.name) || [])[1]?.toLowerCase().replace('markdown', 'md') || 'pdf';

$('file').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    setStatus('Reading ' + f.name + '…');
    const buf = await f.arrayBuffer();
    const format = fmtOf(f);
    let blocks, pages;
    if (format === 'pdf') {
      const pdf = await pdfjs.getDocument({ data: buf.slice(0) }).promise;
      blocks = await extractBlocks(pdf, (n, total) => setStatus(`Preparing text… page ${n} of ${total}`));
      pages = pdf.numPages;
      pdf.destroy();
    } else {
      setStatus('Preparing text…');
      ({ blocks, pages } = await FORMATS[format](buf.slice(0)));
    }
    const chars = blocks.reduce((s, b) => s + b.text.length, 0);
    const empty = chars < 50 * Math.min(pages, 3);
    setStatus(empty ? (format === 'pdf'
      ? 'This PDF has almost no selectable text (it may be a scan).'
      : 'Could not find any readable text in this file.') : '');
    const doc = {
      id: `${f.name}|${f.size}|${f.lastModified}`,
      name: f.name.replace(/\.(pdf|txt|epub|docx|md|markdown)$/i, ''),
      format,
      pages,
      blob: format === 'pdf' ? new Blob([buf], { type: 'application/pdf' }) : null,
      blocks,
      anchor: 0,
      opened: Date.now(),
    };
    const prev = await getDoc(doc.id);
    if (prev) doc.anchor = prev.anchor;
    await putDoc(doc);
    if (!empty) openDoc(doc);
    else renderHome();
  } catch (err) {
    console.error(err);
    setStatus('Could not open that file: ' + (err.message || err));
  }
};

// ---------- reader ----------
let els = [];
function applySettings() {
  const r = document.documentElement.style;
  r.setProperty('--fs', settings.fontSize + 'px');
  r.setProperty('--lh', settings.lineHeight);
  r.setProperty('--mx', settings.margin + 'px');
  r.setProperty('--pg', settings.paraGap + 'em');
  document.body.dataset.theme = settings.theme;
  document.body.dataset.font = settings.font;
  $('text').dataset.align = settings.align;
  document.querySelector('meta[name=theme-color]').content = THEME_COLOR[settings.theme];
  for (const k of Object.keys(LIMITS)) $('v-' + k).textContent = k === 'fontSize' ? settings[k] + ' pt' : k === 'margin' ? settings[k] : Number(settings[k]).toFixed(LIMITS[k][2]);
  document.querySelectorAll('.seg').forEach((s) => s.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings[s.dataset.key])));
  try { localStorage.setItem('settings', JSON.stringify(settings)); } catch {}
}

function currentIndex() {
  const y = window.scrollY + 70;
  let lo = 0, hi = els.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (els[mid].offsetTop <= y) lo = mid; else hi = mid - 1;
  }
  return lo;
}
function scrollToIndex(i) {
  const el = els[Math.max(0, Math.min(els.length - 1, i))];
  if (el) window.scrollTo(0, Math.max(0, el.offsetTop - 70));
}

async function openDoc(doc) {
  current = doc;
  doc.opened = Date.now();
  $('home').hidden = true;
  $('reader').hidden = false;
  $('title').textContent = doc.name;
  $('orig-btn').hidden = doc.format !== 'pdf' && !!doc.format;
  document.body.classList.remove('chrome-hidden');
  const frag = document.createDocumentFragment();
  els = doc.blocks.map((b) => {
    const el = document.createElement(b.type === 'li' ? 'li' : b.type);
    el.textContent = b.type === 'li' ? '• ' + b.text.replace(/^([•▪◦●■□‣∙·*]|[-–—])\s+/, '') : b.text;
    frag.append(el);
    return el;
  });
  const pad = document.createElement('div');
  pad.className = 'pad';
  frag.append(pad);
  $('text').replaceChildren(frag);
  applySettings();
  requestAnimationFrame(() => { scrollToIndex(doc.anchor); updatePos(); setTimeout(() => document.body.classList.add('chrome-hidden'), 1200); });
}

let saveTimer;
function updatePos() {
  if (!current) return;
  const i = currentIndex();
  current.anchor = i;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const frac = max > 0 ? Math.min(1, window.scrollY / max) : 0;
  $('seek').value = Math.round(frac * 1000);
  const page = current.blocks[i] ? current.blocks[i].page : 1;
  const unit = !current.format || current.format === 'pdf' ? 'Page' : current.format === 'epub' ? 'Chapter' : 'Section';
  $('pos').textContent = current.format === 'txt' ? `${Math.round(frac * 100)}%` : `${unit} ${page} of ${current.pages} · ${Math.round(frac * 100)}%`;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => current && putDoc({ ...current }), 400);
}
let ticking = false;
window.addEventListener('scroll', () => {
  if (!current || ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; updatePos(); });
}, { passive: true });
$('seek').oninput = (e) => {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  window.scrollTo(0, (e.target.value / 1000) * max);
};

$('text').addEventListener('click', (e) => {
  if (String(getSelection())) return;
  document.body.classList.toggle('chrome-hidden');
});

$('back').onclick = async () => {
  if (current) { clearTimeout(saveTimer); await putDoc({ ...current }); }
  current = null;
  $('reader').hidden = true;
  $('home').hidden = false;
  window.scrollTo(0, 0);
  renderHome();
};

// settings sheet
$('aa-btn').onclick = () => { $('sheet').hidden = false; };
$('sheet-close').onclick = () => { $('sheet').hidden = true; };
$('sheet').onclick = (e) => { if (e.target === $('sheet')) $('sheet').hidden = true; };
function change(fn) {
  const i = current ? currentIndex() : 0;
  fn();
  applySettings();
  if (current) requestAnimationFrame(() => scrollToIndex(i));
}
document.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => change(() => {
  const k = b.dataset.step, [lo, hi, dp] = LIMITS[k];
  const v = Math.min(hi, Math.max(lo, Number(settings[k]) + Number(b.dataset.d)));
  settings[k] = Number(v.toFixed(2));
}));
document.querySelectorAll('.seg').forEach((s) => s.querySelectorAll('button').forEach((b) => b.onclick = () => change(() => { settings[s.dataset.key] = b.dataset.v; })));

// contents
$('toc-btn').onclick = () => {
  const list = $('toc-list');
  list.textContent = '';
  current.blocks.forEach((b, i) => {
    if (!/^h[12]$/.test(b.type) && !(b.type === 'h3' && b.text.length < 60 && current.blocks.filter((x) => x.type === 'h1' || x.type === 'h2').length < 3)) return;
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'l' + b.type[1];
    btn.textContent = b.text;
    btn.onclick = () => { $('toc').hidden = true; scrollToIndex(i); };
    li.append(btn);
    list.append(li);
  });
  if (!list.children.length) list.innerHTML = '<li class="muted">No headings found in this document.</li>';
  $('toc').hidden = false;
};
$('toc-close').onclick = () => { $('toc').hidden = true; };
$('toc').onclick = (e) => { if (e.target === $('toc')) $('toc').hidden = true; };

// original page viewer (for tables, figures, scans)
let origPage = 1, origPdf = null, rendering = false;
async function renderOrig() {
  if (rendering) return;
  rendering = true;
  try {
    if (!origPdf) origPdf = await pdfjs.getDocument({ data: new Uint8Array(await current.blob.arrayBuffer()) }).promise;
    origPage = Math.max(1, Math.min(origPdf.numPages, origPage));
    $('orig-title').textContent = `Page ${origPage} of ${origPdf.numPages}`;
    const page = await origPdf.getPage(origPage);
    const base = page.getViewport({ scale: 1 });
    // render at 2.5x screen width so pinch-zoom stays sharp
    const scale = (window.innerWidth * 2.5) / base.width;
    const vp = page.getViewport({ scale });
    const c = $('orig-canvas');
    c.width = vp.width; c.height = vp.height;
    c.style.width = window.innerWidth + 'px';
    c.style.height = (vp.height / vp.width) * window.innerWidth + 'px';
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    $('orig-scroll').scrollTo(0, 0);
  } finally { rendering = false; }
}
$('orig-btn').onclick = async () => {
  origPage = current.blocks[currentIndex()]?.page || 1;
  origPdf = null;
  $('orig').hidden = false;
  await renderOrig();
};
$('orig-prev').onclick = () => { origPage--; renderOrig(); };
$('orig-next').onclick = () => { origPage++; renderOrig(); };
$('orig-close').onclick = () => { $('orig').hidden = true; if (origPdf) { origPdf.destroy(); origPdf = null; } };

applySettings();
renderHome();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
