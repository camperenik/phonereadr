// Parser format non-PDF. Masing-masing mengembalikan { blocks, pages } dengan
// "page" = nomor bab/bagian (dipakai untuk label posisi).
import type { Block, Format, ParsedDoc } from '../lib/types';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const last = <T>(a: T[]): T | undefined => a[a.length - 1];

async function loadZip(buf: ArrayBuffer) {
  const { default: JSZip } = await import('jszip');
  return JSZip.loadAsync(buf);
}

function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

const HEADING = /^(bab|chapter|part|bagian|prolog|epilog|prologue|epilogue)\b.{0,70}$/i;

export function parseTxt(buf: ArrayBuffer): ParsedDoc {
  const text = decodeText(buf).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const chunks = text.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
  // Dengan paragraf dipisah baris kosong, baris tunggal adalah pemotongan baris keras;
  // jika tidak, setiap baris adalah satu paragraf.
  const paras =
    chunks.length >= 3
      ? chunks.map((c) => norm(c.replace(/-\n(?=[a-z])/g, '')))
      : text.split('\n').map(norm).filter(Boolean);
  const blocks: Block[] = [];
  let section = 1;
  for (const p of paras) {
    const heading =
      p.length < 80 &&
      (HEADING.test(p) || (/[A-Z]/.test(p) && p === p.toUpperCase() && p.length > 3 && !/[.!?]$/.test(p)));
    if (heading && blocks.length) section++;
    blocks.push({ type: heading ? 'h2' : 'p', text: p, page: section });
  }
  return { blocks, pages: section };
}

export async function parseDocx(buf: ArrayBuffer): Promise<ParsedDoc> {
  const zip = await loadZip(buf);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Bukan file .docx yang valid');
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const doc = parse(await docFile.async('string'));

  // id gaya -> tingkat judul (1..3) dari nama gaya atau outline level
  const styleLevel: Record<string, number> = {};
  const listStyle = new Set<string>();
  const stylesFile = zip.file('word/styles.xml');
  if (stylesFile) {
    const styles = parse(await stylesFile.async('string'));
    const all = Array.from(styles.getElementsByTagNameNS(W, 'style'));
    for (const st of all) {
      const id = st.getAttributeNS(W, 'styleId') || '';
      const name = (st.getElementsByTagNameNS(W, 'name')[0]?.getAttributeNS(W, 'val') || '').toLowerCase();
      const outline = st.getElementsByTagNameNS(W, 'outlineLvl')[0]?.getAttributeNS(W, 'val');
      const m = name.match(/^(?:heading|judul)\s*(\d)/);
      if (/^(list|daftar)\b/.test(name) && !/^list\s*(of|table)/.test(name)) listStyle.add(id);
      if (name === 'title' || name === 'judul') styleLevel[id] = 1;
      else if (m) styleLevel[id] = Math.min(3, +m[1]!);
      else if (outline !== undefined && outline !== null && outline !== '') styleLevel[id] = Math.min(3, +outline + 1);
    }
  }

  const blocks: Block[] = [];
  let page = 1;
  for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
    let text = '';
    let pageBreaks = 0;
    for (const n of Array.from(p.getElementsByTagName('*'))) {
      if (n.namespaceURI !== W) continue;
      if (n.localName === 't') text += n.textContent;
      else if (n.localName === 'tab') text += ' ';
      else if (n.localName === 'br') {
        if (n.getAttributeNS(W, 'type') === 'page') pageBreaks++;
        else text += ' ';
      } else if (n.localName === 'lastRenderedPageBreak') pageBreaks++;
    }
    text = norm(text);
    if (text) {
      const ppr = p.getElementsByTagNameNS(W, 'pPr')[0];
      const styleId = ppr?.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') || '';
      const lvl = styleLevel[styleId];
      let type = (lvl ? 'h' + lvl : 'p') as Block['type'];
      if (type === 'p' && (listStyle.has(styleId) || ppr?.getElementsByTagNameNS(W, 'numPr')[0])) type = 'li';
      blocks.push({ type, text, page });
    }
    page += pageBreaks;
  }
  return { blocks, pages: Math.max(page, 1) };
}

const BLOCK_SEL = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,div';

export async function parseEpub(buf: ArrayBuffer): Promise<ParsedDoc> {
  const zip = await loadZip(buf);
  const read = async (path: string): Promise<string | null> => {
    const f = zip.file(path) || zip.file(decodeURIComponent(path));
    return f ? f.async('string') : null;
  };
  const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
  const container = await read('META-INF/container.xml');
  if (!container) throw new Error('Bukan file .epub yang valid');
  const opfPath = xml(container).getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('Bukan file .epub yang valid');
  const opfSrc = await read(opfPath);
  if (!opfSrc) throw new Error('Bukan file .epub yang valid');
  const opf = xml(opfSrc);
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest: Record<string, { href: string; props: string }> = {};
  for (const it of Array.from(opf.getElementsByTagName('item'))) {
    manifest[it.getAttribute('id') || ''] = {
      href: it.getAttribute('href') || '',
      props: it.getAttribute('properties') || '',
    };
  }
  const spine = Array.from(opf.getElementsByTagName('itemref'))
    .map((r) => manifest[r.getAttribute('idref') || ''])
    .filter((m): m is { href: string; props: string } => !!m && !/\bnav\b/.test(m.props));
  const title = opf.getElementsByTagName('dc:title')[0]?.textContent?.trim() || '';

  const blocks: Block[] = [];
  let section = 0;
  for (const item of spine) {
    const html = await read(base + item.href);
    if (!html) continue;
    let d = new DOMParser().parseFromString(html, 'application/xhtml+xml');
    if (d.getElementsByTagName('parsererror').length) d = new DOMParser().parseFromString(html, 'text/html');
    const body = d.getElementsByTagName('body')[0];
    if (!body) continue;
    const found: { type: Block['type']; text: string }[] = [];
    for (const el of Array.from(body.querySelectorAll(BLOCK_SEL))) {
      if (el.querySelector(BLOCK_SEL)) continue; // hanya blok daun
      const text = norm(el.textContent || '');
      if (!text) continue;
      const tag = el.localName.toLowerCase();
      const type: Block['type'] = /^h[12]$/.test(tag)
        ? (tag as 'h1' | 'h2')
        : /^h[3-6]$/.test(tag)
          ? 'h3'
          : tag === 'li'
            ? 'li'
            : 'p';
      found.push({ type, text });
    }
    if (!found.length) continue;
    section++;
    for (const f of found) blocks.push({ ...f, page: section });
  }
  return { blocks, pages: Math.max(section, 1), title };
}

// Catatan: tanpa regex lookbehind agar tetap berjalan di Safari lama (< 16.4).
const inlineMd = (t: string): string =>
  norm(
    t
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(^|[\s(])([*_])(?=\S)(.*?\S)\2(?=$|[\s).,;:!?])/g, '$1$3')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\\([\\`*_{}[\]()#+\-.!>|])/g, '$1'),
  );

export function parseMd(buf: ArrayBuffer): ParsedDoc {
  let lines = decodeText(buf).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] === '---') {
    // front matter YAML
    const end = lines.indexOf('---', 1);
    if (end > 0) lines = lines.slice(end + 1);
  }
  const blocks: Block[] = [];
  let section = 1;
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'p', text: inlineMd(para.join(' ')), page: section });
    para = [];
  };
  const push = (type: Block['type'], raw: string) => {
    const text = inlineMd(raw);
    if (text) blocks.push({ type, text, page: section });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let m: RegExpExecArray | null;
    if ((m = /^\s*(```|~~~)/.exec(line))) {
      // blok kode berpagar: satu blok
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trim().startsWith(m[1]!); i++) code.push(lines[i]!.trim());
      push('p', code.filter(Boolean).join(' '));
    } else if (!line.trim()) flush();
    else if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      flush();
      if (m[1]!.length <= 2 && blocks.length) section++;
      push(m[1]!.length === 1 ? 'h1' : m[1]!.length === 2 ? 'h2' : 'h3', m[2]!);
    } else if (para.length && /^\s{0,3}(=+|-+)\s*$/.test(line)) {
      // judul setext
      const level = line.trim()[0] === '=' ? 'h1' : 'h2';
      const text = para.join(' ');
      para = [];
      if (blocks.length) section++;
      push(level, text);
    } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) flush();
    else if ((m = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line))) {
      push('li', m[1]!);
      para = [];
    } else if (/^\s*\|/.test(line)) {
      // baris tabel: baris pemisah header dibuang
      flush();
      if (!/^[\s|:-]+$/.test(line))
        push('p', line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean).join(' · '));
    } else if (/^\s*>/.test(line)) para.push(line.replace(/^\s*(>\s?)+/, ''));
    else if (para.length === 0 && /^\s+\S/.test(line) && last(blocks)?.type === 'li') {
      const lb = last(blocks)!;
      lb.text = norm(lb.text + ' ' + inlineMd(line)); // lanjutan item daftar
    } else para.push(line.trim());
  }
  flush();
  return { blocks, pages: section };
}

export const PARSERS: Record<Exclude<Format, 'pdf'>, (buf: ArrayBuffer) => ParsedDoc | Promise<ParsedDoc>> = {
  txt: parseTxt,
  md: parseMd,
  docx: parseDocx,
  epub: parseEpub,
};

export function formatOf(name: string): Format {
  const m = /\.(txt|epub|docx|md|markdown)$/i.exec(name);
  if (!m) return 'pdf';
  const f = m[1]!.toLowerCase();
  return (f === 'markdown' ? 'md' : f) as Format;
}
