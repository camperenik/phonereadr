import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { computeCrops, FULL_PAGE } from './crop/aggregate';
import type { Box, CropMode, RawBoxes } from './crop/types';
import { pageAtOffset } from './layout';
import { analyzeDocument } from './pdf/analyze';
import { getPref, loadAnalysis, saveAnalysis, setPref, type PageSizes } from './store/cache';
import {
  DOUBLE_TAP_ZOOM,
  clampZoom,
  pinchZoom,
  scrollForFocal,
  snapZoom,
} from './zoom';

/** Batas piksel per kanvas dan total semua kanvas yang sedang hidup. */
const MAX_CANVAS_PIXELS = 16_000_000;
const PIXEL_BUDGET = 48_000_000;
const DEFAULT_SIZE: [number, number] = [595, 842];

interface Slot {
  el: HTMLDivElement;
  canvas: HTMLCanvasElement | null;
  /** Kunci render terakhir yang berhasil (crop + resolusi + mode asli). */
  key: string;
  /** Kunci yang gagal dirender, agar tidak diulang terus-menerus. */
  failKey: string;
  pixels: number;
  aspect: string;
}

/**
 * Pembaca scroll kontinu: semua halaman disusun vertikal dengan lebar konten
 * = lebar layar. Hanya halaman di sekitar layar yang dirender; sisanya hanya
 * kerangka kosong berukuran tepat (dari rasio crop) sehingga scroll stabil.
 */
export class Viewer {
  private raw: RawBoxes = { safe: [], aggressive: [] };
  private sizes: PageSizes = [];
  private crops: Box[] = [];
  private mode: CropMode;
  private trim: boolean;
  private original = false;
  private zoom = 1; // zoom yang sudah di-commit (dipakai render)
  private liveZoom = 1; // zoom saat gestur berlangsung
  private pinching = false;

  private slots: Slot[] = [];
  private rendered = new Set<number>();
  private totalPixels = 0;
  private current = 0;
  private cur: { i: number; task: RenderTask } | null = null;
  private pumping = false;
  private destroyed = false;
  private rafPending = false;
  private layoutTimer: ReturnType<typeof setTimeout> | undefined;
  private wheelTimer: ReturnType<typeof setTimeout> | undefined;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  private abort = new AbortController();

  private readonly scroller: HTMLElement;
  private readonly pages: HTMLElement;
  private readonly status: HTMLElement;
  private readonly pageInput: HTMLInputElement;
  private readonly pageTotal: HTMLElement;
  private readonly hint: HTMLElement;

  constructor(
    private readonly doc: PDFDocumentProxy,
    private readonly id: string,
    private readonly root: HTMLElement,
  ) {
    this.scroller = this.q('#scroller');
    this.pages = this.q('#pages');
    this.status = this.q('#status');
    this.pageInput = this.q('#page-input');
    this.pageTotal = this.q('#page-total');
    this.hint = this.q('#zoomhint');
    this.mode = getPref<CropMode>('mode', 'safe');
    this.trim = getPref<boolean>('trim', false);
    this.current = Math.min(doc.numPages - 1, Math.max(0, getPref<number>(`page:${id}`, 0)));
  }

  private q<T extends Element>(sel: string): T {
    return this.root.querySelector<T>(sel)!;
  }

  async start(): Promise<void> {
    const n = this.doc.numPages;
    this.pageTotal.textContent = `/ ${n}`;
    this.pageInput.max = String(n);

    const cached = await loadAnalysis(this.id);
    if (cached && cached.total === n) {
      this.raw = cached.raw;
      this.sizes = cached.sizes;
    }
    if (!this.sizes[0]) {
      const p = await this.doc.getPage(1);
      const v = p.getViewport({ scale: 1 });
      this.sizes[0] = [v.width, v.height];
      p.cleanup();
    }

    this.buildSlots();
    this.recompute();
    this.setWidth();
    this.applyLayout(false);
    this.scroller.scrollTop = this.slots[this.current]!.el.offsetTop;
    this.bindUi();
    this.scroller.tabIndex = 0;
    this.scroller.focus({ preventScroll: true });
    this.refresh();

    void this.runAnalysis();
  }

  destroy(): void {
    this.destroyed = true;
    this.abort.abort();
    this.cur?.task.cancel();
    clearTimeout(this.layoutTimer);
    clearTimeout(this.wheelTimer);
    clearTimeout(this.hintTimer);
    for (const i of [...this.rendered]) this.free(i);
    void this.doc.loadingTask.destroy();
  }

  // ---------- analisis ----------

  private async runAnalysis(): Promise<void> {
    let lastSave = 0;
    await analyzeDocument(this.doc, this.raw, this.sizes, {
      signal: this.abort.signal,
      onPage: (_index, p) => {
        this.status.textContent = p.done >= p.total ? '' : `Menganalisis ${p.done}/${p.total}`;
        // Susun ulang tidak lebih sering dari tiap 400 ms agar scroll tetap halus.
        if (!this.layoutTimer) {
          this.layoutTimer = setTimeout(() => {
            this.layoutTimer = undefined;
            this.relayout();
          }, 400);
        }
        if (Date.now() - lastSave > 3000) {
          lastSave = Date.now();
          void this.persist();
        }
      },
    });
    if (this.abort.signal.aborted) return;
    this.status.textContent = '';
    clearTimeout(this.layoutTimer);
    this.layoutTimer = undefined;
    this.relayout();
    await this.persist();
  }

  private persist(): Promise<void> {
    return saveAnalysis({
      id: this.id,
      raw: this.raw,
      sizes: this.sizes,
      total: this.doc.numPages,
    });
  }

  // ---------- tata letak ----------

  private buildSlots(): void {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < this.doc.numPages; i++) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.dataset.page = String(i + 1);
      frag.appendChild(el);
      this.slots.push({ el, canvas: null, key: '', failKey: '', pixels: 0, aspect: '' });
    }
    this.pages.replaceChildren(frag);
  }

  private cssWidth(): number {
    return this.scroller.clientWidth || window.innerWidth;
  }

  private setWidth(zoom = this.zoom): void {
    this.pages.style.setProperty('--pw', `${this.cssWidth() * zoom}px`);
  }

  private recompute(): void {
    this.crops = computeCrops(this.raw[this.mode], {
      splitParity: this.doc.numPages > 4,
      trimBottom: this.trim,
    });
  }

  private cropFor(i: number): Box {
    return this.original ? FULL_PAGE : (this.crops[i] ?? FULL_PAGE);
  }

  private sizeOf(i: number): [number, number] {
    return this.sizes[i] ?? this.sizes[0] ?? DEFAULT_SIZE;
  }

  /** Rasio lebar/tinggi area crop halaman i, dalam satuan poin PDF. */
  private aspectOf(i: number): string {
    const c = this.cropFor(i);
    const [w, h] = this.sizeOf(i);
    const aw = Math.max(1e-3, (c.right - c.left) * w);
    const ah = Math.max(1e-3, (c.bottom - c.top) * h);
    return `${aw.toFixed(3)} / ${ah.toFixed(3)}`;
  }

  private pageAt(y: number): number {
    return pageAtOffset(this.slots.length, (i) => this.slots[i]!.el.offsetTop, y);
  }

  /** Titik acuan baca: halaman di tepi atas layar dan fraksi yang sudah terlewati. */
  private anchor(): { i: number; f: number } {
    const top = this.scroller.scrollTop;
    const i = this.pageAt(top);
    const el = this.slots[i]!.el;
    return { i, f: el.offsetHeight ? (top - el.offsetTop) / el.offsetHeight : 0 };
  }

  private restore(a: { i: number; f: number }): void {
    const el = this.slots[a.i]!.el;
    this.scroller.scrollTop = el.offsetTop + a.f * el.offsetHeight;
  }

  /** Terapkan rasio halaman; posisi baca dijaga agar tidak melompat. */
  private applyLayout(keepAnchor = true): void {
    const a = keepAnchor ? this.anchor() : null;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      const asp = this.aspectOf(i);
      if (asp !== s.aspect) {
        s.aspect = asp;
        s.el.style.aspectRatio = asp;
      }
    }
    if (a) this.restore(a);
  }

  private relayout(): void {
    if (this.destroyed) return;
    this.recompute();
    this.applyLayout();
    this.refresh();
  }

  // ---------- navigasi ----------

  goTo(index: number): void {
    const i = Math.min(this.slots.length - 1, Math.max(0, index));
    this.scroller.scrollTop = this.slots[i]!.el.offsetTop;
    this.refresh();
  }

  private onScroll(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.refresh();
    });
  }

  /** Perbarui nomor halaman aktif dan halaman mana yang perlu dirender. */
  private refresh(): void {
    if (this.destroyed || this.slots.length === 0) return;
    const el = this.scroller;
    const p = this.pageAt(el.scrollTop + el.clientHeight * 0.25);
    if (p !== this.current) {
      this.current = p;
      setPref(`page:${this.id}`, p);
    }
    if (document.activeElement !== this.pageInput) this.pageInput.value = String(p + 1);
    this.update();
  }

  // ---------- render (virtualisasi) ----------

  private range(): [number, number] {
    const el = this.scroller;
    const h = el.clientHeight;
    const margin = this.zoom > 1.02 ? h * 0.3 : h;
    return [this.pageAt(el.scrollTop - margin), this.pageAt(el.scrollTop + h + margin)];
  }

  private renderKey(i: number): string {
    const c = this.cropFor(i);
    const w = Math.round(this.cssWidth() * this.zoom * (window.devicePixelRatio || 1));
    return `${c.left.toFixed(4)},${c.top.toFixed(4)},${c.right.toFixed(4)},${c.bottom.toFixed(4)}|${w}|${this.original ? 1 : 0}`;
  }

  private update(): void {
    if (this.destroyed || this.pinching) return;
    const [lo, hi] = this.range();
    const keep = this.zoom > 1.02 ? 1 : 2;
    if (this.cur && (this.cur.i < lo || this.cur.i > hi)) this.cur.task.cancel();
    for (const i of [...this.rendered]) if (i < lo - keep || i > hi + keep) this.free(i);
    void this.pump();
  }

  private free(i: number): void {
    const s = this.slots[i]!;
    if (s.canvas) {
      s.canvas.width = 0; // lepaskan memori bitmap segera
      s.canvas.height = 0;
    }
    s.el.replaceChildren();
    this.totalPixels -= s.pixels;
    s.canvas = null;
    s.key = '';
    s.pixels = 0;
    this.rendered.delete(i);
  }

  /** Halaman di sekitar layar yang kunci render-nya sudah usang; terdekat ke tengah layar dulu. */
  private nextWanted(): number | undefined {
    const [lo, hi] = this.range();
    const el = this.scroller;
    const center = this.pageAt(el.scrollTop + el.clientHeight / 2);
    let best: number | undefined;
    for (let i = lo; i <= hi; i++) {
      const s = this.slots[i]!;
      const key = this.renderKey(i);
      if (s.key === key || s.failKey === key) continue;
      if (best === undefined || Math.abs(i - center) < Math.abs(best - center)) best = i;
    }
    return best;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        if (this.destroyed || this.pinching) break;
        const next = this.nextWanted();
        if (next === undefined) break;
        await this.renderSlot(next);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async renderSlot(i: number): Promise<void> {
    const slot = this.slots[i]!;
    const key = this.renderKey(i);
    let page;
    try {
      page = await this.doc.getPage(i + 1);
    } catch {
      slot.failKey = key;
      return;
    }
    if (this.destroyed) return;

    const base = page.getViewport({ scale: 1 });
    const known = this.sizes[i];
    if (!known || Math.abs(known[0] - base.width) > 0.5 || Math.abs(known[1] - base.height) > 0.5) {
      this.sizes[i] = [base.width, base.height];
      if (!this.layoutTimer) {
        this.layoutTimer = setTimeout(() => {
          this.layoutTimer = undefined;
          this.relayout();
        }, 300);
      }
    }

    const crop = this.cropFor(i);
    const cropW = (crop.right - crop.left) * base.width;
    const cropH = (crop.bottom - crop.top) * base.height;
    const dpr = window.devicePixelRatio || 1;
    let scale = (this.cssWidth() * this.zoom * dpr) / cropW;
    const px = cropW * scale * (cropH * scale);
    if (px > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / px);

    const viewport = page.getViewport({ scale });
    const w = Math.max(1, Math.round(cropW * scale));
    const h = Math.max(1, Math.round(cropH * scale));
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
    this.cur = { i, task };
    try {
      await task.promise;
    } catch (e) {
      if ((e as { name?: string } | null)?.name !== 'RenderingCancelledException') {
        slot.failKey = key;
      }
      off.width = off.height = 0;
      return;
    } finally {
      page.cleanup();
      if (this.cur?.task === task) this.cur = null;
    }

    if (this.destroyed || this.renderKey(i) !== key) {
      off.width = off.height = 0; // usang: loop akan merender ulang bila masih perlu
      return;
    }

    if (slot.canvas) this.free(i);
    off.className = 'pg';
    slot.el.replaceChildren(off);
    slot.canvas = off;
    slot.key = key;
    slot.pixels = w * h;
    this.totalPixels += slot.pixels;
    this.rendered.add(i);
    this.enforceBudget();
  }

  /** Jaga total memori kanvas: lepaskan halaman terjauh dari layar bila melebihi anggaran. */
  private enforceBudget(): void {
    if (this.totalPixels <= PIXEL_BUDGET) return;
    const [lo, hi] = this.range();
    const center = this.pageAt(this.scroller.scrollTop + this.scroller.clientHeight / 2);
    const far = [...this.rendered]
      .filter((i) => i < lo || i > hi)
      .sort((a, b) => Math.abs(b - center) - Math.abs(a - center));
    for (const i of far) {
      if (this.totalPixels <= PIXEL_BUDGET) break;
      this.free(i);
    }
  }

  // ---------- UI ----------

  private bindUi(): void {
    const prev = () => this.goTo(this.current - 1);
    const next = () => this.goTo(this.current + 1);
    this.q('#prev').addEventListener('click', prev);
    this.q('#next').addEventListener('click', next);
    this.pageInput.addEventListener('change', () => {
      const n = Number(this.pageInput.value);
      if (Number.isFinite(n)) this.goTo(Math.round(n) - 1);
      this.pageInput.value = String(this.current + 1);
    });
    this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });

    const modeBtn = this.q<HTMLButtonElement>('#mode');
    const paintMode = () => {
      modeBtn.textContent = this.mode === 'safe' ? 'Aman' : 'Agresif';
      modeBtn.setAttribute('aria-label', `Mode crop: ${modeBtn.textContent}`);
    };
    paintMode();
    modeBtn.addEventListener('click', () => {
      this.mode = this.mode === 'safe' ? 'aggressive' : 'safe';
      setPref('mode', this.mode);
      paintMode();
      this.relayout();
    });

    const trimBtn = this.q<HTMLButtonElement>('#trim');
    trimBtn.setAttribute('aria-pressed', String(this.trim));
    trimBtn.addEventListener('click', () => {
      this.trim = !this.trim;
      setPref('trim', this.trim);
      trimBtn.setAttribute('aria-pressed', String(this.trim));
      this.relayout();
    });

    const origBtn = this.q<HTMLButtonElement>('#original');
    origBtn.addEventListener('click', () => {
      this.original = !this.original;
      origBtn.setAttribute('aria-pressed', String(this.original));
      this.relayout();
    });

    window.addEventListener('keydown', (e) => {
      if (this.destroyed || e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    });

    window.addEventListener('resize', () => {
      const a = this.anchor();
      this.setWidth();
      this.restore(a);
      this.refresh();
    });

    this.bindGestures();
    this.bindDesktopZoom();
  }

  // ---------- zoom & gestur ----------

  /** Terapkan zoom langsung lewat CSS (umpan balik instan); render tajam menyusul. */
  private applyLiveZoom(z: number, fx: number, fy: number, px: number, py: number): void {
    const el = this.scroller;
    this.liveZoom = z;
    this.setWidth(z);
    el.scrollLeft = scrollForFocal(fx, px, el.scrollWidth, el.clientWidth);
    el.scrollTop = scrollForFocal(fy, py, el.scrollHeight, el.clientHeight);
    this.showHint(z);
  }

  private commitZoom(z: number): void {
    this.pinching = false;
    this.zoom = snapZoom(z);
    this.liveZoom = this.zoom;
    this.setWidth();
    if (this.zoom === 1) this.scroller.scrollLeft = 0;
    this.showHint(this.zoom);
    this.refresh();
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
      fx: (el.scrollLeft + px) / Math.max(1, el.scrollWidth),
      fy: (el.scrollTop + py) / Math.max(1, el.scrollHeight),
    };
  }

  private beginZoomGesture(): void {
    this.pinching = true;
    this.cur?.task.cancel();
  }

  private bindGestures(): void {
    const el = this.scroller;
    const rel = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      return { x: cx - r.left, y: cy - r.top };
    };
    const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    let pinch: { d0: number; z0: number; fx: number; fy: number; z: number } | null = null;
    let tap: { x: number; y: number; moved: boolean } | null = null;
    let lastTap = { t: 0, x: 0, y: 0 };

    el.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 2) {
          const [a, b] = [e.touches[0]!, e.touches[1]!];
          const m = rel((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
          this.beginZoomGesture();
          pinch = { d0: dist(a, b), z0: this.zoom, ...this.focalAt(m.x, m.y), z: this.zoom };
          tap = null;
        } else if (e.touches.length === 1 && !pinch) {
          tap = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY, moved: false };
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
        } else if (tap && !tap.moved) {
          const t = e.touches[0]!;
          if (Math.hypot(t.clientX - tap.x, t.clientY - tap.y) > 10) tap.moved = true;
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
            tap = null;
            this.commitZoom(z);
          }
          return;
        }
        if (!tap || tap.moved || e.changedTouches.length !== 1) {
          tap = null;
          return;
        }
        tap = null;
        const t = e.changedTouches[0]!;
        // dua ketukan cepat berdekatan = ganti 1x <-> zoom ketuk ganda.
        // Pakai waktu kejadian sentuhan (bukan waktu handler berjalan): saat thread
        // utama sibuk merender, handler bisa tertunda dan Date.now() jadi menyesatkan.
        const now = e.timeStamp;
        if (now - lastTap.t < 300 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 40) {
          const p = rel(t.clientX, t.clientY);
          const f = this.focalAt(p.x, p.y);
          const target = this.zoom > 1.02 ? 1 : DOUBLE_TAP_ZOOM;
          this.beginZoomGesture();
          this.applyLiveZoom(target, f.fx, f.fy, p.x, p.y);
          this.commitZoom(target);
          lastTap = { t: 0, x: 0, y: 0 };
        } else {
          lastTap = { t: now, x: t.clientX, y: t.clientY };
        }
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
        if (!this.pinching) this.beginZoomGesture();
        const z = clampZoom(this.liveZoom * Math.exp(-e.deltaY * 0.01));
        this.applyLiveZoom(z, f.fx, f.fy, px, py);
        clearTimeout(this.wheelTimer);
        this.wheelTimer = setTimeout(() => this.commitZoom(this.liveZoom), 180);
      },
      { passive: false },
    );

    window.addEventListener('keydown', (e) => {
      if (this.destroyed || e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey) return;
      const c = { x: this.scroller.clientWidth / 2, y: this.scroller.clientHeight / 2 };
      const f = this.focalAt(c.x, c.y);
      let z: number | null = null;
      if (e.key === '+' || e.key === '=') z = clampZoom(this.zoom * 1.25);
      else if (e.key === '-') z = clampZoom(this.zoom / 1.25);
      else if (e.key === '0') z = 1;
      if (z === null) return;
      this.beginZoomGesture();
      this.applyLiveZoom(z, f.fx, f.fy, c.x, c.y);
      this.commitZoom(z);
    });
  }
}
