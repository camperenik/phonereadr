import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { RenderTask } from 'pdfjs-dist';
import { computeCrops, FULL_PAGE } from './crop/aggregate';
import type { Box, CropMode, RawBoxes } from './crop/types';
import { analyzeDocument } from './pdf/analyze';
import { getPref, loadAnalysis, saveAnalysis, setPref } from './store/cache';
import {
  DOUBLE_TAP_ZOOM,
  clampZoom,
  pinchZoom,
  scrollForFocal,
  snapZoom,
  swipeDirection,
  type Edge,
} from './zoom';

const MAX_CANVAS_PIXELS = 16_000_000;

export class Viewer {
  private raw: RawBoxes = { safe: [], aggressive: [] };
  private crops: Box[] = [];
  private page = 0;
  private mode: CropMode;
  private original = false;
  private trim: boolean;
  private zoom = 1;
  private pinching = false;
  private wheelTimer: ReturnType<typeof setTimeout> | undefined;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  private renderTask: RenderTask | null = null;
  private renderToken = 0;
  private abort = new AbortController();
  private analyzed = 0;

  private readonly canvas: HTMLCanvasElement;
  private readonly scroller: HTMLElement;
  private readonly status: HTMLElement;
  private readonly pageInput: HTMLInputElement;
  private readonly pageTotal: HTMLElement;
  private readonly hint: HTMLElement;

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
    this.hint = this.q('#zoomhint');
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

  goTo(index: number): void {
    const next = Math.min(this.doc.numPages - 1, Math.max(0, index));
    if (next === this.page) {
      this.pageInput.value = String(next + 1); // kembalikan nilai input yang tidak valid
      return;
    }
    this.page = next;
    setPref(`page:${this.id}`, next);
    this.scroller.scrollTop = 0;
    this.scroller.scrollLeft = 0;
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
    if (this.pinching) return; // commitZoom akan merender setelah gestur selesai
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
    let scale = (cssWidth * this.zoom * dpr) / cropW;
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
    this.canvas.style.width = `${cssWidth * this.zoom}px`;
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

    this.bindGestures();
    this.bindDesktopZoom();

    window.addEventListener('resize', () => void this.renderPage());
  }

  // ---------- zoom & gestur ----------

  private edge(): Edge {
    const el = this.scroller;
    return {
      left: el.scrollLeft <= 1,
      right: el.scrollLeft >= el.scrollWidth - el.clientWidth - 1,
    };
  }

  /** Terapkan zoom langsung lewat CSS (umpan balik instan); render tajam menyusul. */
  private applyLiveZoom(z: number, fx: number, fy: number, px: number, py: number): void {
    const el = this.scroller;
    this.canvas.style.width = `${el.clientWidth * z}px`;
    el.scrollLeft = scrollForFocal(fx, px, this.canvas.clientWidth, el.clientWidth);
    el.scrollTop = scrollForFocal(fy, py, this.canvas.clientHeight, el.clientHeight);
    this.showHint(z);
  }

  private commitZoom(z: number): void {
    this.zoom = snapZoom(z);
    if (this.zoom === 1) this.scroller.scrollLeft = 0;
    this.showHint(this.zoom);
    void this.renderPage();
  }

  private showHint(z: number): void {
    this.hint.textContent = `${z.toFixed(1)}×`;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => (this.hint.textContent = ''), 900);
  }

  /** Pecahan posisi konten yang berada di bawah titik layar (px, py). */
  private focalAt(px: number, py: number): { fx: number; fy: number } {
    const el = this.scroller;
    return {
      fx: (el.scrollLeft + px) / Math.max(1, this.canvas.clientWidth),
      fy: (el.scrollTop + py) / Math.max(1, this.canvas.clientHeight),
    };
  }

  private bindGestures(): void {
    const el = this.scroller;
    const rel = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      return { x: cx - r.left, y: cy - r.top };
    };
    const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    let pinch: { d0: number; z0: number; fx: number; fy: number; z: number } | null = null;
    let swipe: { x: number; y: number; edge: Edge; moved: boolean } | null = null;
    let lastTap = { t: 0, x: 0, y: 0 };

    el.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 2) {
          const [a, b] = [e.touches[0]!, e.touches[1]!];
          const m = rel((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
          this.pinching = true;
          pinch = { d0: dist(a, b), z0: this.zoom, ...this.focalAt(m.x, m.y), z: this.zoom };
          swipe = null;
        } else if (e.touches.length === 1 && !pinch) {
          swipe = {
            x: e.touches[0]!.clientX,
            y: e.touches[0]!.clientY,
            edge: this.edge(),
            moved: false,
          };
        }
      },
      { passive: true },
    );

    el.addEventListener(
      'touchmove',
      (e) => {
        if (pinch && e.touches.length === 2) {
          e.preventDefault();
          const [a, b] = [e.touches[0]!, e.touches[1]!];
          const m = rel((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
          pinch.z = pinchZoom(pinch.z0, pinch.d0, dist(a, b));
          this.applyLiveZoom(pinch.z, pinch.fx, pinch.fy, m.x, m.y);
        } else if (swipe && !swipe.moved) {
          const t = e.touches[0]!;
          if (Math.hypot(t.clientX - swipe.x, t.clientY - swipe.y) > 10) swipe.moved = true;
        }
      },
      { passive: false },
    );

    el.addEventListener(
      'touchend',
      (e) => {
        if (pinch) {
          if (e.touches.length < 2) {
            const z = pinch.z;
            pinch = null;
            this.pinching = false;
            swipe = null;
            this.commitZoom(z);
          }
          return;
        }
        if (!swipe || e.changedTouches.length !== 1) return;
        const t = e.changedTouches[0]!;
        const dx = t.clientX - swipe.x;
        const dy = t.clientY - swipe.y;

        if (!swipe.moved) {
          // ketuk: dua ketukan cepat berdekatan = ganti 1x <-> zoom ketuk ganda
          const now = Date.now();
          if (now - lastTap.t < 300 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 40) {
            const p = rel(t.clientX, t.clientY);
            const f = this.focalAt(p.x, p.y);
            const target = this.zoom > 1.02 ? 1 : DOUBLE_TAP_ZOOM;
            this.applyLiveZoom(target, f.fx, f.fy, p.x, p.y);
            this.commitZoom(target);
            lastTap = { t: 0, x: 0, y: 0 };
          } else {
            lastTap = { t: now, x: t.clientX, y: t.clientY };
          }
          swipe = null;
          return;
        }

        const dir = swipeDirection({
          dx,
          dy,
          zoom: this.zoom,
          startEdge: swipe.edge,
          endEdge: this.edge(),
        });
        swipe = null;
        if (dir === 'next') this.goTo(this.page + 1);
        else if (dir === 'prev') this.goTo(this.page - 1);
      },
      { passive: true },
    );
  }

  /** Desktop: Ctrl+scroll dan tombol + / - / 0. */
  private bindDesktopZoom(): void {
    this.scroller.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const r = this.scroller.getBoundingClientRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        const f = this.focalAt(px, py);
        const z = clampZoom(this.zoom * Math.exp(-e.deltaY * 0.01));
        this.zoom = z;
        this.applyLiveZoom(z, f.fx, f.fy, px, py);
        clearTimeout(this.wheelTimer);
        this.wheelTimer = setTimeout(() => this.commitZoom(this.zoom), 180);
      },
      { passive: false },
    );

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey) return;
      const c = { x: this.scroller.clientWidth / 2, y: this.scroller.clientHeight / 2 };
      const f = this.focalAt(c.x, c.y);
      let z: number | null = null;
      if (e.key === '+' || e.key === '=') z = clampZoom(this.zoom * 1.25);
      else if (e.key === '-') z = clampZoom(this.zoom / 1.25);
      else if (e.key === '0') z = 1;
      if (z === null) return;
      this.applyLiveZoom(z, f.fx, f.fy, c.x, c.y);
      this.commitZoom(z);
    });
  }
}
