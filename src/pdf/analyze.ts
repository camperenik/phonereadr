import type { PDFDocumentProxy } from 'pdfjs-dist';
import { detectContentBox } from '../crop/detect';
import { samplePageIndices } from '../crop/aggregate';
import type { Box, RawBoxes } from '../crop/types';

const ANALYSIS_WIDTH = 420;

export interface AnalysisProgress {
  done: number;
  total: number;
}

/**
 * Menganalisis halaman dalam dua tahap: sampel tersebar dulu (hasil cepat),
 * lalu sisa halaman berurutan di latar belakang. Setiap halaman dirender kecil
 * satu kali, dan kedua mode (safe/aggressive) dideteksi dari piksel yang sama.
 */
export async function analyzeDocument(
  doc: PDFDocumentProxy,
  raw: RawBoxes,
  opts: {
    signal: AbortSignal;
    onPage: (index: number, progress: AnalysisProgress) => void;
  },
): Promise<void> {
  const total = doc.numPages;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const seen = new Set<number>();
  raw.safe.forEach((b, i) => b !== undefined && seen.add(i));

  const sample = samplePageIndices(total);
  const rest = Array.from({ length: total }, (_, i) => i).filter((i) => !sample.includes(i));
  const order = [...sample, ...rest].filter((i) => !seen.has(i));

  for (const i of order) {
    if (opts.signal.aborted) return;
    const boxes = await analyzePage(doc, i, canvas, ctx);
    if (opts.signal.aborted) return;
    raw.safe[i] = boxes.safe;
    raw.aggressive[i] = boxes.aggressive;
    seen.add(i);
    opts.onPage(i, { done: seen.size, total });
    // beri napas ke thread UI antar halaman
    await new Promise((r) => setTimeout(r, 0));
  }
}

async function analyzePage(
  doc: PDFDocumentProxy,
  index: number,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): Promise<Record<'safe' | 'aggressive', Box | null>> {
  const page = await doc.getPage(index + 1);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: ANALYSIS_WIDTH / base.width });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport, background: '#ffffff' }).promise;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return {
      safe: detectContentBox(img.data, img.width, img.height, 'safe'),
      aggressive: detectContentBox(img.data, img.width, img.height, 'aggressive'),
    };
  } finally {
    page.cleanup();
  }
}
