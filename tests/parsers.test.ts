import { describe, expect, it } from 'vitest';
import { formatOf, parseMd, parseTxt } from '../src/reflow/parsers';

const buf = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('formatOf', () => {
  it('mengenali format dari nama file', () => {
    expect(formatOf('a.PDF')).toBe('pdf');
    expect(formatOf('b.epub')).toBe('epub');
    expect(formatOf('c.markdown')).toBe('md');
    expect(formatOf('d.docx')).toBe('docx');
    expect(formatOf('tanpa-ekstensi')).toBe('pdf');
  });
});

describe('parseTxt', () => {
  it('menggabungkan baris yang dipatahkan dan mengenali judul Bab', () => {
    const t = 'Bab 1\n\nIni baris pertama\nyang dipatah paksa.\n\nParagraf dua.\n\nBab 2\n\nIsi bab dua.';
    const { blocks, pages } = parseTxt(buf(t));
    expect(blocks.map((b) => b.type)).toEqual(['h2', 'p', 'p', 'h2', 'p']);
    expect(blocks[1]!.text).toBe('Ini baris pertama yang dipatah paksa.');
    expect(pages).toBe(2);
  });
  it('jatuh ke satu paragraf per baris bila tidak ada baris kosong', () => {
    const { blocks } = parseTxt(buf('satu\ndua\ntiga'));
    expect(blocks.map((b) => b.text)).toEqual(['satu', 'dua', 'tiga']);
  });
  it('membaca windows-1252 bila bukan UTF-8 valid', () => {
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" di windows-1252
    expect(parseTxt(bytes.buffer).blocks[0]!.text).toBe('café');
  });
});

describe('parseMd', () => {
  const md = [
    '---',
    'title: x',
    '---',
    '# Judul',
    '',
    'Teks dengan **tebal**, *miring*, `kode`, dan [tautan](http://x.y).',
    '',
    '## Bagian',
    '- butir satu',
    '- butir dua',
    '  lanjutan',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '> kutipan',
  ].join('\n');
  const { blocks, pages } = parseMd(buf(md));

  it('membuang front matter dan menandai judul', () => {
    expect(blocks[0]).toMatchObject({ type: 'h1', text: 'Judul' });
    expect(blocks.find((b) => b.text === 'Bagian')?.type).toBe('h2');
  });
  it('membersihkan penekanan, kode, dan tautan', () => {
    expect(blocks[1]!.text).toBe('Teks dengan tebal, miring, kode, dan tautan.');
  });
  it('daftar, lanjutan daftar, tabel, dan kutipan', () => {
    const li = blocks.filter((b) => b.type === 'li').map((b) => b.text);
    expect(li).toEqual(['butir satu', 'butir dua lanjutan']);
    expect(blocks.some((b) => b.text === 'A · B')).toBe(true);
    expect(blocks.some((b) => b.text === '1 · 2')).toBe(true);
    expect(blocks.some((b) => b.text === 'kutipan')).toBe(true);
  });
  it('menghitung bagian dari judul tingkat 1-2', () => {
    expect(pages).toBe(2);
  });
  it('tidak memakai regex lookbehind (aman untuk Safari lama)', () => {
    // kode sumber parser tidak boleh mengandung "(?<=" atau "(?<!"
    expect(parseMd.toString()).not.toMatch(/\(\?<[=!]/);
  });
});
