/** Matematika zoom/pan murni (tanpa DOM) agar mudah diuji. */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
export const DOUBLE_TAP_ZOOM = 2.5;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Zoom yang hampir 1 dianggap 1 supaya halaman kembali pas lebar layar. */
export function snapZoom(z: number): number {
  const c = clampZoom(z);
  return c < 1.08 ? 1 : c;
}

/** Zoom baru dari rasio jarak dua jari. */
export function pinchZoom(startZoom: number, startDist: number, dist: number): number {
  if (startDist <= 0) return startZoom;
  return clampZoom((startZoom * dist) / startDist);
}

/**
 * Posisi scroll agar titik konten (pecahan 0..1 dari ukuran konten) berada
 * tepat di bawah titik layar `point` (relatif ke viewport).
 */
export function scrollForFocal(
  fraction: number,
  point: number,
  contentSize: number,
  viewportSize: number,
): number {
  const max = Math.max(0, contentSize - viewportSize);
  return Math.min(max, Math.max(0, fraction * contentSize - point));
}
