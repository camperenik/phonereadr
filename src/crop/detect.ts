import type { Box, CropMode } from './types';

/**
 * Mendeteksi kotak konten dari piksel RGBA sebuah halaman.
 *
 * "Margin" = area di tepi yang warnanya sama dengan warna latar dominan di tepi
 * halaman (bukan hanya putih), sehingga latar krem, abu-abu, atau hitam juga
 * bisa dipotong. Mengembalikan null jika tidak ada konten (halaman kosong).
 */
export function detectContentBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  mode: CropMode,
): Box | null {
  if (width < 4 || height < 4) return null;

  const bg = estimateBackground(data, width, height);
  const tol = mode === 'safe' ? 24 : 40;

  const rowInk = new Uint32Array(height);
  const colInk = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3]!;
      // piksel transparan dianggap sama dengan latar
      if (a < 16) continue;
      const d = Math.max(
        Math.abs(data[i]! - bg[0]),
        Math.abs(data[i + 1]! - bg[1]),
        Math.abs(data[i + 2]! - bg[2]),
      );
      if (d > tol) {
        rowInk[y]!++;
        colInk[x]!++;
      }
    }
  }

  // Penyaring bintik: garis dianggap berisi hanya jika punya cukup piksel "tinta".
  const minRow = mode === 'safe' ? 2 : Math.max(3, Math.round(width * 0.01));
  const minCol = mode === 'safe' ? 2 : Math.max(3, Math.round(height * 0.01));

  let top = firstAtLeast(rowInk, minRow);
  let bottom = lastAtLeast(rowInk, minRow);
  let left = firstAtLeast(colInk, minCol);
  let right = lastAtLeast(colInk, minCol);
  if (top < 0 || bottom < 0 || left < 0 || right < 0) return null;

  if (mode === 'aggressive') {
    // Abaikan pita tipis (header/footer/nomor halaman) yang terpisah dari isi utama.
    const t = trimThinBand(rowInk, minRow, top, bottom, 'start');
    top = t;
    bottom = trimThinBand(rowInk, minRow, top, bottom, 'end');
    // Kolom dihitung ulang hanya pada rentang baris yang tersisa.
    const cols = recountColumns(data, width, bg, tol, top, bottom);
    left = firstAtLeast(cols, minCol);
    right = lastAtLeast(cols, minCol);
    if (left < 0 || right < 0) return null;
  }

  // Padding ~0,6% (min. 2 piksel) agar baris anti-alias tipis di tepi teks kecil
  // (yang lolos di bawah ambang penyaring bintik) tidak ikut terpotong.
  const padX = Math.max(2, Math.round(width * 0.006));
  const padY = Math.max(2, Math.round(height * 0.006));
  return {
    left: Math.max(0, left - padX) / width,
    top: Math.max(0, top - padY) / height,
    right: Math.min(width, right + 1 + padX) / width,
    bottom: Math.min(height, bottom + 1 + padY) / height,
  };
}

/** Median per kanal dari cincin piksel di tepi gambar. */
export function estimateBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number] {
  const ring = Math.max(1, Math.round(Math.min(width, height) * 0.01));
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const push = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (data[i + 3]! < 16) {
      r.push(255);
      g.push(255);
      b.push(255);
    } else {
      r.push(data[i]!);
      g.push(data[i + 1]!);
      b.push(data[i + 2]!);
    }
  };
  for (let y = 0; y < height; y++) {
    for (let k = 0; k < ring; k++) {
      push(k, y);
      push(width - 1 - k, y);
    }
  }
  for (let x = ring; x < width - ring; x++) {
    for (let k = 0; k < ring; k++) {
      push(x, k);
      push(x, height - 1 - k);
    }
  }
  return [median(r), median(g), median(b)];
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[values.length >> 1] ?? 255;
}

function firstAtLeast(arr: Uint32Array, min: number): number {
  for (let i = 0; i < arr.length; i++) if (arr[i]! >= min) return i;
  return -1;
}

function lastAtLeast(arr: Uint32Array, min: number): number {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i]! >= min) return i;
  return -1;
}

/**
 * Jika pita konten di ujung (start/end) tipis (<= 6% tinggi) dan dipisahkan dari
 * isi lain oleh celah >= 2,5% tinggi, kembalikan batas baru tanpa pita itu.
 */
function trimThinBand(
  rowInk: Uint32Array,
  min: number,
  top: number,
  bottom: number,
  side: 'start' | 'end',
): number {
  const h = rowInk.length;
  const maxBand = Math.round(h * 0.06);
  const minGap = Math.max(2, Math.round(h * 0.025));
  const mergeGap = Math.max(1, Math.round(h * 0.006));

  // Bangun "run" baris berisi, menyatukan celah kecil.
  const runs: Array<[number, number]> = [];
  let start = -1;
  let last = -1;
  for (let y = top; y <= bottom; y++) {
    if (rowInk[y]! >= min) {
      if (start < 0) start = y;
      else if (y - last > mergeGap + 1) {
        runs.push([start, last]);
        start = y;
      }
      last = y;
    }
  }
  if (start >= 0) runs.push([start, last]);
  if (runs.length < 2) return side === 'start' ? top : bottom;

  if (side === 'start') {
    const [s0, e0] = runs[0]!;
    const [s1] = runs[1]!;
    if (e0 - s0 + 1 <= maxBand && s1 - e0 - 1 >= minGap) return s1;
    return top;
  }
  const [s0, e0] = runs[runs.length - 1]!;
  const [, ePrev] = runs[runs.length - 2]!;
  if (e0 - s0 + 1 <= maxBand && s0 - ePrev - 1 >= minGap) return ePrev;
  return bottom;
}

function recountColumns(
  data: Uint8ClampedArray,
  width: number,
  bg: [number, number, number],
  tol: number,
  top: number,
  bottom: number,
): Uint32Array {
  const cols = new Uint32Array(width);
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3]! < 16) continue;
      const d = Math.max(
        Math.abs(data[i]! - bg[0]),
        Math.abs(data[i + 1]! - bg[1]),
        Math.abs(data[i + 2]! - bg[2]),
      );
      if (d > tol) cols[x]!++;
    }
  }
  return cols;
}
