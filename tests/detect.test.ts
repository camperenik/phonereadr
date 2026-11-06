import { describe, expect, it } from 'vitest';
import { detectContentBox } from '../src/crop/detect';

function canvas(w: number, h: number, bg: [number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = bg[0];
    d[i * 4 + 1] = bg[1];
    d[i * 4 + 2] = bg[2];
    d[i * 4 + 3] = 255;
  }
  const rect = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        d[i] = c[0];
        d[i + 1] = c[1];
        d[i + 2] = c[2];
      }
  };
  return { d, rect };
}

describe('detectContentBox', () => {
  it('memotong margin putih di keempat sisi', () => {
    const { d, rect } = canvas(200, 300, [255, 255, 255]);
    rect(40, 60, 160, 240, [0, 0, 0]);
    const b = detectContentBox(d, 200, 300, 'safe')!;
    expect(b.left).toBeCloseTo(0.2, 1);
    expect(b.right).toBeCloseTo(0.8, 1);
    expect(b.top).toBeCloseTo(0.2, 1);
    expect(b.bottom).toBeCloseTo(0.8, 1);
  });

  it('mendukung latar berwarna (bukan hanya putih)', () => {
    const { d, rect } = canvas(200, 300, [250, 240, 220]);
    rect(20, 30, 180, 270, [20, 20, 20]);
    const b = detectContentBox(d, 200, 300, 'safe')!;
    expect(b.left).toBeCloseTo(0.1, 1);
    expect(b.bottom).toBeCloseTo(0.9, 1);
  });

  it('mendukung latar gelap', () => {
    const { d, rect } = canvas(200, 300, [10, 10, 10]);
    rect(50, 50, 150, 250, [240, 240, 240]);
    const b = detectContentBox(d, 200, 300, 'safe')!;
    expect(b.left).toBeCloseTo(0.25, 1);
  });

  it('halaman kosong mengembalikan null', () => {
    const { d } = canvas(100, 100, [255, 255, 255]);
    expect(detectContentBox(d, 100, 100, 'safe')).toBeNull();
  });

  it('mode safe mempertahankan footer, aggressive mengabaikannya', () => {
    const { d, rect } = canvas(200, 400, [255, 255, 255]);
    rect(30, 40, 170, 330, [0, 0, 0]); // isi utama
    rect(90, 380, 110, 388, [0, 0, 0]); // nomor halaman kecil di bawah
    const safe = detectContentBox(d, 200, 400, 'safe')!;
    const aggr = detectContentBox(d, 200, 400, 'aggressive')!;
    expect(safe.bottom).toBeGreaterThan(0.95);
    expect(aggr.bottom).toBeLessThan(0.86);
  });

  it('mode safe tidak memotong gambar yang menempel di tepi', () => {
    const { d, rect } = canvas(200, 300, [255, 255, 255]);
    rect(0, 0, 200, 120, [90, 120, 200]); // gambar full-bleed di atas
    const b = detectContentBox(d, 200, 300, 'safe')!;
    expect(b.left).toBe(0);
    expect(b.top).toBe(0);
    expect(b.right).toBe(1);
  });
});
