// Build "legacy" pdf.js: berjalan di Safari/iOS yang lebih lama juga.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`;

/**
 * Transport yang membaca potongan file lokal sesuai permintaan pdf.js,
 * sehingga PDF ratusan MB tidak perlu dimuat utuh ke memori.
 */
class FileRangeTransport extends pdfjs.PDFDataRangeTransport {
  constructor(
    private readonly file: Blob,
    initial: Uint8Array,
  ) {
    super(file.size, initial);
  }
  override requestDataRange(begin: number, end: number): void {
    void this.file
      .slice(begin, Math.min(end, this.file.size))
      .arrayBuffer()
      .then((buf) => this.onDataRange(begin, new Uint8Array(buf)));
  }
}

export interface LoadedPdf {
  doc: pdfjs.PDFDocumentProxy;
  /** Sidik jari dokumen, dipakai sebagai kunci cache. */
  id: string;
  name: string;
}

export async function loadPdf(file: Blob, name = 'dokumen.pdf'): Promise<LoadedPdf> {
  const initial = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  const task = pdfjs.getDocument({
    range: new FileRangeTransport(file, initial),
    length: file.size,
    rangeChunkSize: 1024 * 1024,
    disableAutoFetch: true,
    disableStream: true,
    cMapUrl: `${ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
    wasmUrl: `${ASSET_BASE}wasm/`,
    iccUrl: `${ASSET_BASE}iccs/`,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  const doc = await task.promise;
  const id = doc.fingerprints[0] ?? `${name}:${file.size}`;
  return { doc, id, name };
}

export type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
