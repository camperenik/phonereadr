/** Kotak dalam koordinat ternormalisasi halaman (0..1), asal di kiri-atas. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** safe: semua konten dipertahankan. aggressive: header/footer tipis di tepi diabaikan. */
export type CropMode = 'safe' | 'aggressive';

export const CROP_MODES: readonly CropMode[] = ['safe', 'aggressive'];

/** Hasil deteksi mentah per halaman untuk kedua mode; null = halaman kosong. */
export type RawBoxes = Record<CropMode, (Box | null)[]>;
