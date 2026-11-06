import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { RenderTask } from 'pdfjs-dist';
import { computeCrops, FULL_PAGE } from './crop/aggregate';
import type { Box, CropMode, RawBoxes } from './crop/types';
import { analyzeDocument } from './pdf/analyze';
import { getPref, loadAnalysis, saveAnalysis, setPref } from './store/cache';

const MAX_CANVAS_PIXELS = 16_000_000;

export class Viewer {
  private raw: RawBoxes = { safe: [], aggressive: [] };
  private crops: Box[] = [];
  private page = 0;
  private mode: CropMode;
  private original = false;
  private trim: boolean;
  private renderTask: RenderTask | null = null;
  private renderToken = 0;
  private abort = new AbortController();
  private analyzed = 0;

  private readonly canvas: HTMLCanvasElement;
  private readonly scroller: HTMLElement;
  private readonly status: HTMLElement;
  private readonly pageInput: HTMLInputElement;
  private readonly pageTotal: HTMLElement;

  constructor(
    private readonly doc: PDFDocumentProxy,
    private readonly id: string,
    private readonly root: HTMLElement,
  ) {
    this.canvas = this.q('#page');
    this.scroller = this.q('#scroller');
    this.status = this.q('#status');
    this.pageInput = this.q('#page-input');
    this.pageTotal = this.q('#page-total');
    this.mode = getPref<CropMode>('mode', 'safe');
    this.trim = getPref<boolean>('trim', false);
    this.page = Math.min(doc.numPages - 1, Math.max(0, getPref<number>(`page:${id}`, 0)));
  }

  private q<T extends Element>(sel: string): T {
    return this.root.querySelector<T>(sel)!;
  }

  async start(): Promise<void> {
    this.pageTotal.textContent = `/ ${this.doc.numPages}`;
    this.pageInput.max = String(this.doc.numPages);
    this.bindUi();

    const cached = await loadAnalysis(this.id);
    if (cached && cached.total === this.doc.numPages) this.raw = cached.raw;
    this.recompute();
    await this.renderPage();

    void this.runAnalysis();
  }

  destroy(): void {
    this.abort.abort();
    this.renderTask?.cancel();
    void this.doc.loadingTask.destroy();
  }

  private async runAnalysis(): Promise<void> {
    let lastSave = 0;
    await analyzeDocument(this.doc, this.raw, {
      signal: this.abort.signal,
      onPage: (index, p) => {
        this.analyzed = p.done;
        this.recompute();
        this.updateStatus(p.done, p.total);
        // Halaman yang sedang dibaca berubah cropnya -> render ulang.
        if (index === this.page || (p.done <= 24 && p.done % 6 === 0)) void this.renderPage();
        if (Date.now() - lastSave > 3000) {
          lastSave = Date.now();
          void this.persist();
        }
      },
    });
    if (this.abort.signal.aborted) return;
    this.updateStatus(this.doc.numPages, this.doc.numPages);
    await this.persist();
    void this.renderPage();
  }

  private persist(): Promise<void> {
    return saveAnalysis({ id: this.id, raw: this.raw, total: this.doc.numPages });
  }

  private recompute(): void {
    this.crops = computeCrops(this.raw[this.mode], {
      splitParity: this.doc.numPages > 4,
      trimBottom: this.trim,
    });
  }

  private updateStatus(done: number, total: number): void {
    this.status.textContent = done >= total ? '' : `Menganalisis ${done}/${total}`;
  }

  // ---------- navigasi ----------

  goTo(index: number, resetScroll = true): void {
    const next = Math.min(this.doc.numPages - 1, Math.max(0, index));
    if (next === this.page && !resetScroll) return;
    this.page = next;
    setPref(`page:${this.id}`, next);
    if (resetScroll) this.scroller.scrollTop = 0;
    void this.renderPage();
  }

  setMode(mode: CropMode): void {
    this.mode = mode;
    setPref('mode', mode);
    this.recompute();
    void this.renderPage();
  }

  setOriginal(on: boolean): void {
    this.original = on;
    void this.renderPage();
  }

  getMode(): CropMode {
    return this.mode;
  }

  // ---------- render ----------

  private async renderPage(): Promise<void> {
    const token = ++this.renderToken;
    this.renderTask?.cancel();
    this.pageInput.value = String(this.page + 1);

    const page = await this.doc.getPage(this.page + 1);
    if (token !== this.renderToken) return;

    const crop = this.original ? FULL_PAGE : (this.crops[this.page] ?? FULL_PAGE);
    const base = page.getViewport({ scale: 1 });
    const cssWidth = this.scroller.clientWidth || window.innerWidth;
    const dpr = window.devicePixelRatio || 1;

    // skala agar lebar area konten = lebar layar
    const cropW = (crop.right - crop.left) * base.width;
    const cropH = (crop.bottom - crop.top) * base.height;
    let scale = (cssWidth * dpr) / cropW;
    const pixels = cropW * scale * (cropH * scale);
    if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);

    const viewport = page.getViewport({ scale });
    const w = Math.max(1, Math.round(cropW * scale));
    const h = Math.max(1, Math.round(cropH * scale));

    // Render ke canvas luar layar agar tampilan lama tidak berkedip.
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const task = page.render({
      canvas: off,
      canvasContext: off.getContext('2d')!,
      viewport,
      background: '#ffffff',
      transform: [1, 0, 0, 1, -crop.left * viewport.width, -crop.top * viewport.height],
    });
    this.renderTask = task;
    try {
      await task.promise;
    } catch {
      return; // dibatalkan oleh render yang lebih baru
    } finally {
      page.cleanup();
    }
    if (token !== this.renderToken) return;

    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.getContext('2d')!.drawImage(off, 0, 0);
    this.canvas.style.width = '100%';
    this.canvas.style.aspectRatio = `${w} / ${h}`;
  }

  // ---------- UI ----------

  private bindUi(): void {
    const prev = () => this.goTo(this.page - 1);
    const next = () => this.goTo(this.page + 1);
    this.q('#prev').addEventListener('click', prev);
    this.q('#next').addEventListener('click', next);
    this.pageInput.addEventListener('change', () => this.goTo(Number(this.pageInput.value) - 1));

    const modeBtn = this.q<HTMLButtonElement>('#mode');
    const paintMode = () => {
      modeBtn.textContent = this.mode === 'safe' ? 'Aman' : 'Agresif';
      modeBtn.setAttribute('aria-label', `Mode crop: ${modeBtn.textContent}`);
    };
    paintMode();
    modeBtn.addEventListener('click', () => {
      this.setMode(this.mode === 'safe' ? 'aggressive' : 'safe');
      paintMode();
    });

    const trimBtn = this.q<HTMLButtonElement>('#trim');
    trimBtn.setAttribute('aria-pressed', String(this.trim));
    trimBtn.addEventListener('click', () => {
      this.trim = !this.trim;
      setPref('trim', this.trim);
      trimBtn.setAttribute('aria-pressed', String(this.trim));
      this.recompute();
      void this.renderPage();
    });

    const origBtn = this.q<HTMLButtonElement>('#original');
    origBtn.addEventListener('click', () => {
      this.original = !this.original;
      origBtn.setAttribute('aria-pressed', String(this.original));
      this.setOriginal(this.original);
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') next();
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
    });

    // Swipe horizontal = pindah halaman; gerakan vertikal tetap scroll di dalam halaman.
    let sx = 0;
    let sy = 0;
    let multi = false;
    this.scroller.addEventListener(
      'touchstart',
      (e) => {
        multi = e.touches.length > 1;
        sx = e.touches[0]!.clientX;
        sy = e.touches[0]!.clientY;
      },
      { passive: true },
    );
    this.scroller.addEventListener(
      'touchend',
      (e) => {
        if (multi) return;
        const dx = e.changedTouches[0]!.clientX - sx;
        const dy = e.changedTouches[0]!.clientY - sy;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          if (dx < 0) next();
          else prev();
        }
      },
      { passive: true },
    );

    window.addEventListener('resize', () => void this.renderPage());
  }
}
