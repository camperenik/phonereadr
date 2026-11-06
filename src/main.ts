import './style.css';
import {
  allDocs,
  delDoc,
  getDoc,
  getFile,
  progressOf,
  putDoc,
  putFile,
  type DocRecord,
} from './lib/db';
import { loadPdf, type LoadedPdf } from './pdf/loader';
import { extractBlocks } from './reflow/reflow';
import { PARSERS, formatOf } from './reflow/parsers';
import { TextReader } from './text/textReader';
import { Viewer } from './viewer';

const $ = (id: string) => document.getElementById(id)!;
const stripExt = (n: string) => n.replace(/\.(pdf|txt|epub|docx|md|markdown)$/i, '');

type View = 'home' | 'text' | 'page';

/** File yang sudah dipilih pada sesi ini (tetap bisa dipakai walau tidak muat disimpan). */
const sessionFiles = new Map<string, Blob>();

let record: DocRecord | null = null;
let viewer: Viewer | null = null;
let pdf: LoadedPdf | null = null;
let view: View = 'home';
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function show(v: View): void {
  view = v;
  $('home').hidden = v !== 'home';
  $('text-view').hidden = v !== 'text';
  $('page-view').hidden = v !== 'page';
  if (v === 'home') window.scrollTo(0, 0);
}

function setStatus(msg: string): void {
  const el = $('home-status');
  el.hidden = !msg;
  el.textContent = msg;
}

// ---------- penyimpanan ----------

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (record) void putDoc({ ...record });
  }, 400);
}

async function saveNow(): Promise<void> {
  clearTimeout(saveTimer);
  if (record) await putDoc({ ...record });
}

/** Simpan file asli di latar belakang agar pembukaan tidak menunggu penyalinan ratusan MB. */
async function storeFile(rec: DocRecord, file: Blob): Promise<void> {
  const ok = await putFile(rec.id, file);
  rec.unstored = !ok;
  await putDoc({ ...rec });
  if (!ok && view === 'home') {
    setStatus('File terlalu besar untuk disimpan di perangkat. Anda perlu memilihnya lagi saat membukanya dari daftar.');
  }
}

// ---------- beranda ----------

async function renderHome(): Promise<void> {
  const docs = (await allDocs()).sort((a, b) => b.opened - a.opened);
  $('empty').hidden = docs.length > 0;
  const ul = $('recent');
  ul.textContent = '';
  for (const d of docs) {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.className = 'open-doc';
    const pct = Math.round(progressOf(d) * 100);
    open.innerHTML = '<span class="name"></span><span class="meta"></span>';
    (open.firstChild as HTMLElement).textContent = d.name;
    (open.lastChild as HTMLElement).textContent =
      `${!d.format || d.format === 'pdf' ? d.pages + ' halaman' : d.format.toUpperCase()} · ${pct}% terbaca`;
    open.onclick = () => void openRecent(d);
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Hapus ' + d.name);
    del.onclick = async () => {
      if (confirm(`Hapus "${d.name}" dari perangkat ini?`)) {
        await delDoc(d.id);
        void renderHome();
      }
    };
    li.append(open, del);
    ul.append(li);
  }
}

async function goHome(): Promise<void> {
  await closeCurrent();
  show('home');
  await renderHome();
}

/** Tutup pembaca yang aktif dan simpan posisinya. */
async function closeCurrent(): Promise<void> {
  if (view === 'text') text.close();
  viewer?.destroy();
  viewer = null;
  pdf = null;
  await saveNow();
  record = null;
}

// ---------- membuka file ----------

async function openFile(f: File): Promise<void> {
  try {
    setStatus(`Membuka ${f.name}…`);
    const format = formatOf(f.name);
    const id = `${f.name}|${f.size}|${f.lastModified}`;
    const prev = await getDoc(id);
    sessionFiles.set(id, f);

    if (format === 'pdf') {
      const loaded = await loadPdf(f, stripExt(f.name));
      const rec: DocRecord = prev ?? {
        id,
        name: stripExt(f.name),
        format: 'pdf',
        pages: loaded.doc.numPages,
        blob: null,
        blocks: [],
        anchor: 0,
        opened: Date.now(),
        mode: 'page',
      };
      rec.pages = loaded.doc.numPages;
      rec.format = 'pdf';
      setStatus('');
      await migrateLegacyBlob(rec);
      void putDoc({ ...rec }).then(() => (rec.unstored === undefined ? storeFile(rec, f) : undefined));
      await openPdf(rec, loaded);
      return;
    }

    const buf = await f.arrayBuffer();
    const { blocks, pages } = await PARSERS[format](buf.slice(0));
    const chars = blocks.reduce((s, b) => s + b.text.length, 0);
    if (chars < 50 * Math.min(pages, 3)) {
      setStatus('Tidak ditemukan teks yang bisa dibaca di file ini.');
      return;
    }
    setStatus('');
    const rec: DocRecord = {
      id,
      name: stripExt(f.name),
      format,
      pages,
      blob: null,
      blocks,
      anchor: prev?.anchor ?? 0,
      progress: prev?.progress,
      opened: Date.now(),
    };
    await putDoc(rec);
    await openText(rec);
  } catch (err) {
    console.error(err);
    setStatus('Tidak bisa membuka file itu: ' + ((err as Error).message || String(err)));
    if (view !== 'home') show('home');
  }
}

/** Dokumen dari aplikasi lama menyimpan PDF di dalam record; pindahkan ke penyimpanan file. */
async function migrateLegacyBlob(rec: DocRecord): Promise<void> {
  if (!rec.blob) return;
  if (await putFile(rec.id, rec.blob)) {
    rec.blob = null;
    rec.unstored = false;
  }
}

async function openRecent(d: DocRecord): Promise<void> {
  try {
    if (d.format && d.format !== 'pdf') {
      await openText(d);
      return;
    }
    if (d.mode === 'text' && d.blocks.length) {
      await openText(d);
      return;
    }
    const src = sessionFiles.get(d.id) ?? (await getFile(d));
    if (!src) {
      needFile(d);
      return;
    }
    const loaded = await loadPdf(src, d.name);
    await migrateLegacyBlob(d);
    await openPdf(d, loaded);
  } catch (err) {
    console.error(err);
    setStatus('Tidak bisa membuka dokumen: ' + ((err as Error).message || String(err)));
  }
}

/** File asli tidak tersimpan (terlalu besar): minta pengguna memilihnya lagi. */
function needFile(d: DocRecord): void {
  setStatus(`"${d.name}" tidak tersimpan di perangkat. Pilih file yang sama untuk melanjutkan membaca.`);
  const input = $('refile') as HTMLInputElement;
  input.onchange = async () => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const id = `${f.name}|${f.size}|${f.lastModified}`;
    if (id !== d.id) {
      setStatus('File yang dipilih berbeda dari yang tadi dibaca. Pilih file yang sama.');
      return;
    }
    await openFile(f);
  };
  input.click();
}

// ---------- mode halaman ----------

async function openPdf(rec: DocRecord, loaded: LoadedPdf, startPage?: number): Promise<void> {
  await closeCurrent();
  record = rec;
  pdf = loaded;
  rec.opened = Date.now();
  if (rec.mode === 'text' && rec.blocks.length && startPage === undefined) {
    // mode terakhir teks, tetapi file sudah dibuka: tetap hormati pilihan terakhir
    loaded.doc.loadingTask.destroy();
    pdf = null;
    await openText(rec);
    return;
  }
  rec.mode = 'page';
  show('page');
  viewer = new Viewer(loaded.doc, loaded.id, document.body, {
    initialPage: startPage ?? (rec.page ? rec.page - 1 : 0),
    onPage: (p, total) => {
      if (!record) return;
      record.page = p + 1;
      record.progress = total > 1 ? p / (total - 1) : 0;
      scheduleSave();
    },
  });
  await viewer.start();
}

/** Mode halaman -> teks: ekstrak teks bila belum ada, lalu buka di posisi yang setara. */
async function pageToText(): Promise<void> {
  const rec = record;
  const cur = pdf;
  if (!rec || !cur || !viewer) return;
  const page = viewer.getPage() + 1;

  if (!rec.blocks.length) {
    const ctl = new AbortController();
    $('busy-msg').textContent = 'Menyiapkan teks…';
    $('busy').hidden = false;
    $('busy-cancel').onclick = () => ctl.abort();
    try {
      const blocks = await extractBlocks(
        cur.doc,
        (n, total) => ($('busy-msg').textContent = `Menyiapkan teks… halaman ${n} dari ${total}`),
        ctl.signal,
      );
      const chars = blocks.reduce((s, b) => s + b.text.length, 0);
      if (chars < 50 * Math.min(rec.pages, 3)) {
        $('busy').hidden = true;
        alert('PDF ini hampir tidak punya teks yang bisa dipilih (mungkin hasil scan), jadi tetap dibaca sebagai halaman.');
        return;
      }
      rec.blocks = blocks;
    } catch (err) {
      $('busy').hidden = true;
      if ((err as DOMException).name !== 'AbortError') {
        console.error(err);
        alert('Gagal menyiapkan teks: ' + ((err as Error).message || String(err)));
      }
      return;
    }
    $('busy').hidden = true;
  }

  const anchor = Math.max(0, rec.blocks.findIndex((b) => b.page >= page));
  rec.mode = 'text';
  rec.anchor = anchor < 0 ? 0 : anchor;
  await putDoc({ ...rec });
  await openText(rec, rec.anchor);
}

// ---------- mode teks ----------

async function openText(rec: DocRecord, startBlock?: number): Promise<void> {
  await closeCurrent();
  record = rec;
  rec.opened = Date.now();
  if (!rec.format || rec.format === 'pdf') rec.mode = 'text';
  show('text');
  text.open(rec, startBlock ?? rec.anchor);
}

/** Mode teks -> halaman (PDF): buka file asli di halaman yang setara. */
async function textToPage(page: number): Promise<void> {
  const rec = record;
  if (!rec) return;
  const src = sessionFiles.get(rec.id) ?? (await getFile(rec));
  if (!src) {
    needFileFromText(rec, page);
    return;
  }
  try {
    const loaded = await loadPdf(src, rec.name);
    rec.mode = 'page';
    rec.page = page;
    await putDoc({ ...rec });
    await openPdf(rec, loaded, page - 1);
  } catch (err) {
    console.error(err);
    alert('Tidak bisa membuka halaman asli: ' + ((err as Error).message || String(err)));
  }
}

function needFileFromText(rec: DocRecord, page: number): void {
  alert('File PDF asli tidak tersimpan di perangkat. Pilih file yang sama untuk melihat halaman aslinya.');
  const input = $('refile') as HTMLInputElement;
  input.onchange = async () => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (`${f.name}|${f.size}|${f.lastModified}` !== rec.id) {
      alert('File yang dipilih berbeda dari dokumen ini.');
      return;
    }
    sessionFiles.set(rec.id, f);
    await textToPage(page);
  };
  input.click();
}

const text = new TextReader({
  onBack: () => void goHome(),
  onSwitchToPage: (page) => void textToPage(page),
  onChange: (rec) => {
    if (rec === record) scheduleSave();
    else void putDoc({ ...rec });
  },
});

// ---------- kontrol bersama ----------

($('file') as HTMLInputElement).onchange = (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (f) void openFile(f);
};
$('pv-back').addEventListener('click', () => void goHome());
$('to-text').addEventListener('click', () => void pageToText());
$('pv-opts').addEventListener('click', () => (($('psheet') as HTMLElement).hidden = false));
$('psheet-close').addEventListener('click', () => (($('psheet') as HTMLElement).hidden = true));
$('psheet').addEventListener('click', (e) => {
  if (e.target === $('psheet')) ($('psheet') as HTMLElement).hidden = true;
});

// seret & lepas di desktop
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f && view === 'home') void openFile(f);
});

// simpan posisi saat aplikasi disembunyikan/ditutup
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void saveNow();
});

show('home');
void renderHome();
