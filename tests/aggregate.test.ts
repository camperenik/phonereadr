import { describe, expect, it } from 'vitest';
import { computeCrops, samplePageIndices } from '../src/crop/aggregate';
import type { Box } from '../src/crop/types';

const normal: Box = { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 };

describe('computeCrops', () => {
  it('pencilan tidak melebarkan crop halaman lain', () => {
    const boxes: Box[] = Array.from({ length: 20 }, () => normal);
    boxes[3] = { left: 0, top: 0, right: 1, bottom: 1 }; // gambar full-bleed
    const crops = computeCrops(boxes);
    expect(crops[0]).toEqual(normal);
    expect(crops[3]).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it('tidak pernah memotong konten satu halaman pun', () => {
    const boxes: Box[] = Array.from({ length: 30 }, (_, i) => ({
      left: 0.05 + (i % 7) * 0.01,
      top: 0.05 + (i % 5) * 0.01,
      right: 0.95 - (i % 6) * 0.01,
      bottom: 0.95 - (i % 4) * 0.01,
    }));
    const crops = computeCrops(boxes, { splitParity: true });
    boxes.forEach((b, i) => {
      const c = crops[i]!;
      expect(c.left).toBeLessThanOrEqual(b.left);
      expect(c.top).toBeLessThanOrEqual(b.top);
      expect(c.right).toBeGreaterThanOrEqual(b.right);
      expect(c.bottom).toBeGreaterThanOrEqual(b.bottom);
    });
  });

  it('halaman kosong/belum dianalisis memakai crop seragam', () => {
    const boxes: (Box | null)[] = Array.from({ length: 10 }, () => normal);
    boxes[4] = null;
    boxes[5] = undefined as unknown as null;
    const crops = computeCrops(boxes);
    expect(crops[4]).toEqual(normal);
    expect(crops[5]).toEqual(normal);
  });

  it('crop ganjil dan genap bisa berbeda (margin dalam buku)', () => {
    const boxes: Box[] = Array.from({ length: 12 }, (_, i) =>
      i % 2 === 0
        ? { left: 0.15, top: 0.1, right: 0.92, bottom: 0.9 }
        : { left: 0.08, top: 0.1, right: 0.85, bottom: 0.9 },
    );
    const crops = computeCrops(boxes, { splitParity: true });
    expect(crops[0]!.left).toBeCloseTo(0.15);
    expect(crops[1]!.left).toBeCloseTo(0.08);
  });

  it('trimBottom memotong sisa kosong di bawah tanpa memotong konten', () => {
    const boxes: Box[] = Array.from({ length: 20 }, (_, i) => ({
      left: 0.1,
      top: 0.1,
      right: 0.9,
      bottom: i === 0 ? 0.4 : 0.9, // halaman 1 pendek (cover)
    }));
    const crops = computeCrops(boxes, { trimBottom: true });
    expect(crops[0]!.bottom).toBeCloseTo(0.4);
    expect(crops[1]!.bottom).toBeCloseTo(0.9);
    // sisi lain tetap seragam
    expect(crops[0]!.left).toBeCloseTo(0.1);
    expect(crops[0]!.right).toBeCloseTo(0.9);
    boxes.forEach((b, i) => expect(crops[i]!.bottom).toBeGreaterThanOrEqual(b.bottom));
  });

  it('trimBottom: halaman tanpa deteksi memakai crop seragam', () => {
    const boxes: (Box | null)[] = Array.from({ length: 10 }, () => normal);
    boxes[2] = null;
    expect(computeCrops(boxes, { trimBottom: true })[2]).toEqual(normal);
  });

  it('semua halaman kosong -> halaman penuh', () => {
    expect(computeCrops([null, null])[0]).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });
});

describe('samplePageIndices', () => {
  it('menyertakan halaman pertama dan terakhir, tersebar merata', () => {
    const s = samplePageIndices(1000, 24);
    expect(s[0]).toBe(0);
    expect(s.at(-1)).toBe(999);
    expect(s.length).toBe(24);
  });
  it('dokumen kecil dianalisis seluruhnya', () => {
    expect(samplePageIndices(5)).toEqual([0, 1, 2, 3, 4]);
  });
});
