import type { Box } from './types';

export interface AggregateOptions {
  /** Kuantil yang diabaikan sebagai pencilan saat menentukan crop seragam (0..1). */
  percentile?: number;
  /** Hitung crop terpisah untuk halaman ganjil dan genap (margin dalam buku). */
  splitParity?: boolean;
  /**
   * Potong sisa kosong di bawah: batas bawah tiap halaman mengikuti konten halaman
   * itu sendiri (bukan crop seragam). Sisi lain tetap seragam agar skala stabil.
   */
  trimBottom?: boolean;
}

export const FULL_PAGE: Box = { left: 0, top: 0, right: 1, bottom: 1 };

/**
 * Menghasilkan kotak crop final untuk setiap halaman.
 *
 * 1. Crop seragam per grup (semua / ganjil / genap) memakai kuantil sehingga
 *    beberapa halaman pencilan tidak melebarkan crop seluruh dokumen.
 * 2. Halaman yang kontennya melewati crop seragam dikembalikan ke gabungan
 *    (union) dengan kotaknya sendiri, jadi tidak ada konten yang pernah terpotong.
 * 3. Halaman kosong / belum terdeteksi memakai crop seragam grupnya.
 * 4. Opsional `trimBottom`: batas bawah mengikuti konten halaman itu sendiri.
 */
export function computeCrops(
  boxes: ReadonlyArray<Box | null | undefined>,
  opts: AggregateOptions = {},
): Box[] {
  const percentile = opts.percentile ?? 0.9;
  const groups = opts.splitParity ? 2 : 1;
  const groupOf = (i: number) => (opts.splitParity ? i % 2 : 0);

  const uniform: Box[] = [];
  for (let g = 0; g < groups; g++) {
    const members = boxes.filter((b, i) => groupOf(i) === g && b) as Box[];
    uniform.push(members.length ? uniformBox(members, percentile) : FULL_PAGE);
  }

  return boxes.map((own, i) => {
    const base = uniform[groupOf(i)]!;
    if (!own) return base;
    const merged = union(base, own);
    return opts.trimBottom ? { ...merged, bottom: own.bottom } : merged;
  });
}

export function uniformBox(boxes: Box[], percentile: number): Box {
  const n = boxes.length;
  // Dengan sampel kecil, pencilan tidak bisa dibedakan: pakai gabungan penuh.
  if (n < 5) return boxes.reduce(union);
  const lo = (1 - percentile) * (n - 1);
  const hi = percentile * (n - 1);
  const q = (vals: number[], pos: number) => {
    const s = [...vals].sort((a, b) => a - b);
    const i = Math.floor(pos);
    const f = pos - i;
    return s[i]! + ((s[Math.min(i + 1, n - 1)]! - s[i]!) * f || 0);
  };
  return {
    left: q(boxes.map((b) => b.left), lo),
    top: q(boxes.map((b) => b.top), lo),
    right: q(boxes.map((b) => b.right), hi),
    bottom: q(boxes.map((b) => b.bottom), hi),
  };
}

export function union(a: Box, b: Box): Box {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/** Indeks halaman yang dianalisis lebih dulu: tersebar merata, maksimal `count`. */
export function samplePageIndices(total: number, count = 24): number[] {
  if (total <= count) return Array.from({ length: total }, (_, i) => i);
  const out = new Set<number>();
  for (let k = 0; k < count; k++) out.add(Math.round((k * (total - 1)) / (count - 1)));
  return [...out].sort((a, b) => a - b);
}
