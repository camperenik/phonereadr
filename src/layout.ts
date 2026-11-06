/**
 * Mencari halaman yang memuat posisi vertikal `y`: indeks terbesar dengan
 * top <= y (minimal 0). `topOf` membaca posisi atas halaman (naik monoton).
 */
export function pageAtOffset(n: number, topOf: (i: number) => number, y: number): number {
  if (n <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (topOf(mid) <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
