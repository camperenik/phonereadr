// Menyalin aset runtime pdf.js (cmaps, font standar, wasm, icc) ke public/pdfjs.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/pdfjs-dist';
const dst = 'public/pdfjs';
mkdirSync(dst, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (existsSync(`${src}/${dir}`)) cpSync(`${src}/${dir}`, `${dst}/${dir}`, { recursive: true });
}
console.log('pdf.js assets copied to', dst);
