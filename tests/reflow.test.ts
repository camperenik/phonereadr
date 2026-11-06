import { describe, expect, it } from 'vitest';
import { buildBlocks, pageLines, stripFurniture } from '../src/reflow/reflow';

const VP = { width: 600, height: 800 };
/** Item teks pdf.js sederhana: huruf h, posisi (x,y) dengan y dari bawah halaman. */
const item = (str: string, x: number, y: number, h = 12, width = str.length * h * 0.5) => ({
  str,
  transform: [h, 0, 0, h, x, y],
  width,
  height: h,
});

function pageOf(items: ReturnType<typeof item>[], n = 1) {
  return pageLines({ items }, VP, n);
}

describe('pageLines + buildBlocks', () => {
  it('menyusun baris menjadi satu paragraf dan mengenali judul', () => {
    const lines = pageOf([
      item('Bab Satu', 60, 700, 24),
      item('Ini kalimat pertama dalam paragraf', 60, 650),
      item('yang berlanjut di baris kedua.', 60, 636),
      // paragraf kedua: beberapa baris agar jarak baris normal (14) jadi median
      item('Paragraf baru dimulai setelah jarak.', 60, 590),
      item('Barisnya cukup banyak supaya pitch', 60, 576),
      item('terukur dengan benar oleh algoritma.', 60, 562),
      item('Baris keempat melengkapi sampel.', 60, 548),
    ]);
    const blocks = buildBlocks([lines]);
    expect(blocks[0]).toMatchObject({ type: 'h1', text: 'Bab Satu' });
    expect(blocks[1]!.text).toBe('Ini kalimat pertama dalam paragraf yang berlanjut di baris kedua.');
    expect(blocks[2]!.text).toBe(
      'Paragraf baru dimulai setelah jarak. Barisnya cukup banyak supaya pitch terukur dengan benar oleh algoritma. Baris keempat melengkapi sampel.',
    );
  });

  it('mengenali butir daftar', () => {
    const lines = pageOf([
      item('Isi biasa di awal halaman ini.', 60, 700),
      item('• butir pertama', 60, 660),
      item('• butir kedua', 60, 646),
    ]);
    const types = buildBlocks([lines]).map((b) => b.type);
    expect(types).toContain('li');
  });

  it('menyambung kata yang terpotong tanda hubung, tapi mempertahankan kata ulang', () => {
    const lines = pageOf([
      item('Kami membahas peng-', 60, 700),
      item('gunaan teknologi baru.', 60, 686),
      item('Para teman-', 60, 640),
      item('temanku datang.', 60, 626),
    ]);
    const text = buildBlocks([lines]).map((b) => b.text).join(' | ');
    expect(text).toContain('penggunaan teknologi baru.');
    expect(text).toContain('teman-temanku datang.');
  });

  it('mengganti ligatur', () => {
    const lines = pageOf([item('ﬁnal ﬂow oﬃce', 60, 700)]);
    expect(buildBlocks([lines])[0]!.text).toBe('final flow office');
  });

  it('mengabaikan teks yang diputar dan item kosong', () => {
    const rotated = { str: 'miring', transform: [0, 12, -12, 0, 100, 100], width: 30, height: 12 };
    const lines = pageLines({ items: [item('normal', 60, 700), rotated, { str: '' }] }, VP, 1);
    expect(lines.map((l) => l.text)).toEqual(['normal']);
  });
});

describe('dua kolom', () => {
  it('membaca kolom kiri penuh baru kolom kanan', () => {
    const items: ReturnType<typeof item>[] = [];
    for (let i = 0; i < 20; i++) {
      items.push(item(`kiri ${i}`, 60, 700 - i * 14, 12, 120));
      items.push(item(`kanan ${i}`, 340, 700 - i * 14, 12, 120));
    }
    const lines = pageOf(items);
    const order = lines.map((l) => l.text);
    expect(order.indexOf('kiri 19')).toBeLessThan(order.indexOf('kanan 0'));
  });
});

describe('stripFurniture', () => {
  it('membuang header berulang dan nomor halaman, menyimpan isi', () => {
    const pages = Array.from({ length: 5 }, (_, i) =>
      pageOf(
        [
          item('Judul Buku', 60, 780),
          item(`Isi halaman ${i + 1} yang cukup panjang untuk dibaca.`, 60, 500),
          item(String(i + 1), 300, 20),
        ],
        i + 1,
      ),
    );
    const kept = stripFurniture(pages).map((p) => p.map((l) => l.text));
    for (const p of kept) {
      expect(p).toHaveLength(1);
      expect(p[0]).toMatch(/^Isi halaman/);
    }
  });
});

describe('paragraf lintas halaman', () => {
  it('menggabungkan paragraf yang terpotong pergantian halaman', () => {
    const p1 = pageOf([item('Kalimat ini belum selesai dan', 60, 100)], 1);
    const p2 = pageOf([item('dilanjutkan di halaman berikutnya.', 60, 700)], 2);
    const blocks = buildBlocks([p1, p2]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe('Kalimat ini belum selesai dan dilanjutkan di halaman berikutnya.');
  });
  it('halaman kosong menghasilkan daftar kosong', () => {
    expect(buildBlocks([[]])).toEqual([]);
  });
});
