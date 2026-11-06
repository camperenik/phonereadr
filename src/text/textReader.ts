// Pembaca teks (reflow): hasil pemindahan dari PhoneReadr lama.
// Memakai scroll jendela (window) dan elemen yang didefinisikan di index.html.
import type { DocRecord } from '../lib/db';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

interface Settings {
  fontSize: number;
  lineHeight: number;
  margin: number;
  paraGap: number;
  font: 'serif' | 'sans' | 'rounded';
  theme: 'light' | 'sepia' | 'dark';
  align: 'left' | 'justify';
}
type NumKey = 'fontSize' | 'lineHeight' | 'margin' | 'paraGap';

const DEFAULTS: Settings = {
  fontSize: 20,
  lineHeight: 1.55,
  margin: 20,
  paraGap: 0.9,
  font: 'serif',
  theme: 'light',
  align: 'left',
};
const LIMITS: Record<NumKey, [number, number, number]> = {
  fontSize: [12, 40, 0],
  lineHeight: [1.2, 2.2, 2],
  margin: [4, 48, 0],
  paraGap: [0.2, 2, 1],
};
const THEME_COLOR = { light: '#fbfaf7', sepia: '#f4ecd8', dark: '#111112' };

export interface TextReaderHooks {
  onBack(): void;
  /** Hanya PDF: pindah ke mode halaman pada nomor halaman (1-based) ini. */
  onSwitchToPage(page: number): void;
  /** Posisi baca berubah (sudah di-debounce): simpan record. */
  onChange(doc: DocRecord): void;
}

export class TextReader {
  private settings: Settings = { ...DEFAULTS };
  private current: DocRecord | null = null;
  private els: HTMLElement[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private chromeTimer: ReturnType<typeof setTimeout> | undefined;
  private ticking = false;

  constructor(private readonly hooks: TextReaderHooks) {
    try {
      Object.assign(this.settings, JSON.parse(localStorage.getItem('settings') || '{}'));
    } catch {
      /* pakai bawaan */
    }
    this.bindStatic();
    this.applySettings();
  }

  /** Terapkan tema ke seluruh aplikasi (beranda juga mengikuti). */
  applySettings(): void {
    const r = document.documentElement.style;
    const s = this.settings;
    r.setProperty('--fs', s.fontSize + 'px');
    r.setProperty('--lh', String(s.lineHeight));
    r.setProperty('--mx', s.margin + 'px');
    r.setProperty('--pg', s.paraGap + 'em');
    document.body.dataset.theme = s.theme;
    document.body.dataset.font = s.font;
    $('text').dataset.align = s.align;
    const meta = document.querySelector<HTMLMetaElement>('meta[name=theme-color]');
    if (meta) meta.content = THEME_COLOR[s.theme];
    for (const k of Object.keys(LIMITS) as NumKey[]) {
      const el = $('v-' + k);
      el.textContent =
        k === 'fontSize' ? s[k] + ' pt' : k === 'margin' ? String(s[k]) : Number(s[k]).toFixed(LIMITS[k][2]);
    }
    document.querySelectorAll<HTMLElement>('#sheet .seg').forEach((seg) =>
      seg.querySelectorAll('button').forEach((b) => {
        const key = seg.dataset.key as keyof Settings;
        b.classList.toggle('on', b.dataset.v === s[key]);
      }),
    );
    try {
      localStorage.setItem('settings', JSON.stringify(s));
    } catch {
      /* abaikan */
    }
  }

  // ---------- posisi ----------

  private currentIndex(): number {
    const y = window.scrollY + 70;
    let lo = 0;
    let hi = this.els.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.els[mid]!.offsetTop <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private scrollToIndex(i: number): void {
    const el = this.els[Math.max(0, Math.min(this.els.length - 1, i))];
    if (el) window.scrollTo(0, Math.max(0, el.offsetTop - 70));
  }

  // ---------- buka / tutup ----------

  open(doc: DocRecord, startBlock = doc.anchor): void {
    this.current = doc;
    doc.opened = Date.now();
    $('tv-title').textContent = doc.name;
    $('to-page').hidden = doc.format !== 'pdf' && !!doc.format;
    document.body.classList.remove('chrome-hidden');

    const frag = document.createDocumentFragment();
    this.els = doc.blocks.map((b) => {
      const el = document.createElement(b.type === 'li' ? 'li' : b.type);
      el.textContent = b.type === 'li' ? '• ' + b.text.replace(/^([•▪◦●■□‣∙·*]|[-–—])\s+/, '') : b.text;
      frag.append(el);
      return el;
    });
    const pad = document.createElement('div');
    pad.className = 'pad';
    frag.append(pad);
    $('text').replaceChildren(frag);
    this.applySettings();
    window.addEventListener('scroll', this.onScroll, { passive: true });
    requestAnimationFrame(() => {
      this.scrollToIndex(startBlock);
      this.updatePos();
      clearTimeout(this.chromeTimer);
      this.chromeTimer = setTimeout(() => document.body.classList.add('chrome-hidden'), 1200);
    });
  }

  /** Simpan posisi terakhir dan lepas pendengar scroll. */
  close(): void {
    window.removeEventListener('scroll', this.onScroll);
    clearTimeout(this.saveTimer);
    clearTimeout(this.chromeTimer);
    if (this.current) this.hooks.onChange(this.current);
    this.current = null;
    this.els = [];
    $('text').replaceChildren();
    document.body.classList.remove('chrome-hidden');
  }

  getCurrentBlockPage(): number {
    return this.current?.blocks[this.currentIndex()]?.page || 1;
  }

  private onScroll = (): void => {
    if (!this.current || this.ticking) return;
    this.ticking = true;
    requestAnimationFrame(() => {
      this.ticking = false;
      this.updatePos();
    });
  };

  private updatePos(): void {
    const cur = this.current;
    if (!cur) return;
    const i = this.currentIndex();
    cur.anchor = i;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const frac = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    cur.progress = frac;
    ($('seek') as HTMLInputElement).value = String(Math.round(frac * 1000));
    const page = cur.blocks[i] ? cur.blocks[i]!.page : 1;
    const unit = !cur.format || cur.format === 'pdf' ? 'Halaman' : cur.format === 'epub' ? 'Bab' : 'Bagian';
    $('pos').textContent =
      cur.format === 'txt' ? `${Math.round(frac * 100)}%` : `${unit} ${page} dari ${cur.pages} · ${Math.round(frac * 100)}%`;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.current && this.hooks.onChange(this.current), 400);
  }

  // ---------- kontrol (diikat sekali) ----------

  private change(fn: () => void): void {
    const i = this.current ? this.currentIndex() : 0;
    fn();
    this.applySettings();
    if (this.current) requestAnimationFrame(() => this.scrollToIndex(i));
  }

  private bindStatic(): void {
    $('seek').addEventListener('input', (e) => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, (Number((e.target as HTMLInputElement).value) / 1000) * max);
    });

    $('text').addEventListener('click', () => {
      if (String(getSelection())) return;
      document.body.classList.toggle('chrome-hidden');
    });

    $('tv-back').addEventListener('click', () => this.hooks.onBack());
    $('to-page').addEventListener('click', () => this.hooks.onSwitchToPage(this.getCurrentBlockPage()));

    // pengaturan teks
    const sheet = $('sheet');
    $('aa-btn').addEventListener('click', () => (sheet.hidden = false));
    $('sheet-close').addEventListener('click', () => (sheet.hidden = true));
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) sheet.hidden = true;
    });
    document.querySelectorAll<HTMLElement>('#sheet [data-step]').forEach((b) =>
      b.addEventListener('click', () =>
        this.change(() => {
          const k = b.dataset.step as NumKey;
          const [lo, hi] = LIMITS[k];
          const v = Math.min(hi, Math.max(lo, Number(this.settings[k]) + Number(b.dataset.d)));
          this.settings[k] = Number(v.toFixed(2));
        }),
      ),
    );
    document.querySelectorAll<HTMLElement>('#sheet .seg').forEach((seg) =>
      seg.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () =>
          this.change(() => {
            (this.settings as unknown as Record<string, string>)[seg.dataset.key!] = b.dataset.v!;
          }),
        ),
      ),
    );

    // daftar isi
    const toc = $('toc');
    $('toc-btn').addEventListener('click', () => {
      const cur = this.current;
      if (!cur) return;
      const list = $('toc-list');
      list.textContent = '';
      const headCount = cur.blocks.filter((x) => x.type === 'h1' || x.type === 'h2').length;
      cur.blocks.forEach((b, i) => {
        if (!/^h[12]$/.test(b.type) && !(b.type === 'h3' && b.text.length < 60 && headCount < 3)) return;
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.className = 'l' + b.type[1];
        btn.textContent = b.text;
        btn.onclick = () => {
          toc.hidden = true;
          this.scrollToIndex(i);
        };
        li.append(btn);
        list.append(li);
      });
      if (!list.children.length) list.innerHTML = '<li class="muted">Tidak ada judul di dokumen ini.</li>';
      toc.hidden = false;
    });
    $('toc-close').addEventListener('click', () => (toc.hidden = true));
    toc.addEventListener('click', (e) => {
      if (e.target === toc) toc.hidden = true;
    });
  }
}
