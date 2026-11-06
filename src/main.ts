import './style.css';
import { loadPdf } from './pdf/loader';
import { Viewer } from './viewer';

const app = document.querySelector<HTMLElement>('#app')!;
let viewer: Viewer | null = null;

const homeHtml = `
  <main class="home">
    <h1>PhoneReadr</h1>
    <p>Baca PDF di HP dengan konten sebesar mungkin: margin dipotong, layout dan gambar tetap utuh.</p>
    <label class="btn primary" for="file">Buka PDF</label>
    <input id="file" type="file" accept="application/pdf,.pdf" hidden />
    <p id="msg" class="msg" role="status"></p>
    <p class="hint">File diproses di perangkat Anda dan tidak diunggah ke mana pun.</p>
  </main>`;

const readerHtml = (name: string) => `
  <div class="reader">
    <div id="scroller" class="scroller"><canvas id="page"></canvas></div>
    <div class="bar" role="toolbar" aria-label="Kontrol baca">
      <button id="close" class="icon" aria-label="Tutup dokumen" title="${name}">✕</button>
      <button id="prev" aria-label="Halaman sebelumnya">‹</button>
      <span class="pager">
        <input id="page-input" type="number" min="1" inputmode="numeric" aria-label="Nomor halaman" />
        <span id="page-total"></span>
      </span>
      <button id="next" aria-label="Halaman berikutnya">›</button>
      <button id="mode" class="text">Aman</button>
      <button id="original" class="text" aria-pressed="false">Asli</button>
    </div>
    <div id="status" class="status" role="status"></div>
  </div>`;

function showHome(message = ''): void {
  viewer?.destroy();
  viewer = null;
  app.innerHTML = homeHtml;
  const input = app.querySelector<HTMLInputElement>('#file')!;
  const msg = app.querySelector<HTMLElement>('#msg')!;
  msg.textContent = message;
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void open(f, msg);
  });
}

async function open(file: File, msg: HTMLElement): Promise<void> {
  msg.textContent = 'Membuka…';
  try {
    const { doc, id, name } = await loadPdf(file);
    app.innerHTML = readerHtml(name);
    app.querySelector('#close')!.addEventListener('click', () => showHome());
    viewer = new Viewer(doc, id, app);
    await viewer.start();
  } catch (err) {
    console.error(err);
    showHome('Gagal membuka file. Pastikan file adalah PDF yang valid dan tidak diproteksi sandi.');
  }
}

// Izinkan drag & drop di desktop.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  const msg = app.querySelector<HTMLElement>('#msg');
  if (f && msg) void open(f, msg);
});

showHome();
