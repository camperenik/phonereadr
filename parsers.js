// Parsers for non-PDF formats. Each returns { blocks: [{type, text, page}], pages }
// where "page" is a section number (chapter / page break) used for the position label.

const norm = (s) => s.replace(/\s+/g, ' ').trim();

function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('./vendor/jszip.min.js', import.meta.url).href;
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => reject(new Error('Could not load the zip reader'));
    document.head.append(s);
  });
}

function decodeText(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

const HEADING = /^(bab|chapter|part|bagian|prolog|epilog|prologue|epilogue)\b.{0,70}$/i;

export function parseTxt(buf) {
  const text = decodeText(buf).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const chunks = text.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
  // With blank-line separated paragraphs, single newlines are hard wraps; otherwise each line is a paragraph.
  const paras = chunks.length >= 3
    ? chunks.map((c) => norm(c.replace(/-\n(?=[a-z])/g, '')))
    : text.split('\n').map(norm).filter(Boolean);
  const blocks = [];
  let section = 1;
  for (const p of paras) {
    const heading = p.length < 80 && (HEADING.test(p) || (/[A-Z]/.test(p) && p === p.toUpperCase() && p.length > 3 && !/[.!?]$/.test(p)));
    if (heading && blocks.length) section++;
    blocks.push({ type: heading ? 'h2' : 'p', text: p, page: section });
  }
  return { blocks, pages: section };
}

export async function parseDocx(buf) {
  const zip = await (await loadJSZip()).loadAsync(buf);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Not a valid .docx file');
  const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const doc = parse(await docFile.async('string'));

  // style id -> heading level (1..3) from the style name or outline level
  const styleLevel = {};
  const listStyle = new Set();
  const stylesFile = zip.file('word/styles.xml');
  if (stylesFile) {
    const styles = parse(await stylesFile.async('string'));
    for (const st of styles.getElementsByTagNameNS(W, 'style')) {
      const id = st.getAttributeNS(W, 'styleId');
      const name = (st.getElementsByTagNameNS(W, 'name')[0]?.getAttributeNS(W, 'val') || '').toLowerCase();
      const outline = st.getElementsByTagNameNS(W, 'outlineLvl')[0]?.getAttributeNS(W, 'val');
      const m = name.match(/^(?:heading|judul)\s*(\d)/);
      if (/^(list|daftar)\b/.test(name) && !/^list\s*(of|table)/.test(name)) listStyle.add(id);
      if (name === 'title' || name === 'judul') styleLevel[id] = 1;
      else if (m) styleLevel[id] = Math.min(3, +m[1]);
      else if (outline !== undefined && outline !== null && outline !== '') styleLevel[id] = Math.min(3, +outline + 1);
    }
  }

  const blocks = [];
  let page = 1;
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    let text = '';
    let pageBreaks = 0;
    for (const n of p.getElementsByTagName('*')) {
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
      const styleId = ppr?.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val');
      const lvl = styleLevel[styleId];
      let type = lvl ? 'h' + lvl : 'p';
      if (type === 'p' && (listStyle.has(styleId) || ppr?.getElementsByTagNameNS(W, 'numPr')[0])) type = 'li';
      blocks.push({ type, text, page });
    }
    page += pageBreaks;
  }
  return { blocks, pages: Math.max(page, 1) };
}

const BLOCK_SEL = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,div';

export async function parseEpub(buf) {
  const zip = await (await loadJSZip()).loadAsync(buf);
  const read = async (path) => {
    const f = zip.file(path) || zip.file(decodeURIComponent(path));
    return f ? f.async('string') : null;
  };
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const container = await read('META-INF/container.xml');
  if (!container) throw new Error('Not a valid .epub file');
  const opfPath = xml(container).getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
  const opf = xml(await read(opfPath));
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = {};
  for (const it of opf.getElementsByTagName('item')) {
    manifest[it.getAttribute('id')] = { href: it.getAttribute('href'), props: it.getAttribute('properties') || '' };
  }
  const spine = [...opf.getElementsByTagName('itemref')].map((r) => manifest[r.getAttribute('idref')]).filter((m) => m && !/\bnav\b/.test(m.props));
  const title = opf.getElementsByTagName('dc:title')[0]?.textContent?.trim() || '';

  const blocks = [];
  let section = 0;
  for (const item of spine) {
    const html = await read(base + item.href);
    if (!html) continue;
    let d = new DOMParser().parseFromString(html, 'application/xhtml+xml');
    if (d.getElementsByTagName('parsererror').length) d = new DOMParser().parseFromString(html, 'text/html');
    const body = d.getElementsByTagName('body')[0];
    if (!body) continue;
    const found = [];
    for (const el of body.querySelectorAll(BLOCK_SEL)) {
      if (el.querySelector(BLOCK_SEL)) continue; // leaf blocks only
      const text = norm(el.textContent);
      if (!text) continue;
      const tag = el.localName.toLowerCase();
      const type = /^h[12]$/.test(tag) ? tag : /^h[3-6]$/.test(tag) ? 'h3' : tag === 'li' ? 'li' : 'p';
      found.push({ type, text });
    }
    if (!found.length) continue;
    section++;
    for (const f of found) blocks.push({ ...f, page: section });
  }
  return { blocks, pages: Math.max(section, 1), title };
}

export const FORMATS = { txt: parseTxt, docx: parseDocx, epub: parseEpub };
