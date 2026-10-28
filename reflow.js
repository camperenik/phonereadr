// Turns pdf.js text items into reflowable blocks: [{type, text, page}].
// type: 'h1' | 'h2' | 'h3' | 'p' | 'li'. No DOM access, so it runs in Node too.

const LIGATURES = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
const BULLET = /^([•▪◦●■□‣∙·*]|[-–—]\s|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s+/;
const SENTENCE_END = /[.!?:;"”’')\]…]$/;

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function clean(str) {
  return str.replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] || c).replace(/ /g, ' ');
}

// Group raw items of one column/band into lines (top to bottom, left to right).
function groupLines(items, page) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 0.45 * Math.max(r.h, it.h));
    if (row) row.items.push(it);
    else rows.push({ y: it.y, h: it.h, items: [it] });
  }
  const lines = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd = null;
    let h = 0;
    for (const it of row.items) {
      if (prevEnd !== null) {
        const gap = it.x - prevEnd;
        if (gap > 0.12 * it.h && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
      }
      text += it.str;
      prevEnd = it.x + it.w;
      h = Math.max(h, it.h);
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const x0 = row.items[0].x;
    const x1 = row.items[row.items.length - 1].x + row.items[row.items.length - 1].w;
    lines.push({ text, y: row.y, h, x0, x1, page });
  }
  return lines.sort((a, b) => b.y - a.y);
}

// Detect a two-column layout. Returns the gutter x or null.
function findGutter(items, pageW) {
  const body = items.filter((i) => i.w < 0.55 * pageW && i.str.trim());
  if (body.length < 30) return null;
  let best = null;
  for (let gx = pageW * 0.35; gx <= pageW * 0.65; gx += 2) {
    let crossing = 0;
    let left = 0;
    let right = 0;
    for (const i of body) {
      if (i.x < gx && i.x + i.w > gx) crossing++;
      else if (i.x + i.w <= gx) left++;
      else right++;
    }
    if (crossing === 0 && left > 0.25 * body.length && right > 0.25 * body.length) {
      // keep the widest empty run
      if (best && Math.abs(best.end - (gx - 2)) < 0.5) best.end = gx;
      else if (!best || best.done) best = { start: gx, end: gx };
    } else if (best) best.done = true;
  }
  return best ? (best.start + best.end) / 2 : null;
}

export function pageLines(textContent, viewport, pageNum) {
  const pageW = viewport.width;
  const pageH = viewport.height;
  const items = [];
  for (const t of textContent.items) {
    if (!t.str || !t.transform) continue;
    const [a, b, , d, e, f] = t.transform;
    if (Math.abs(b) > 0.01 * Math.abs(a)) continue; // skip rotated text
    const h = Math.abs(d) || t.height || 0;
    if (!h) continue;
    items.push({ str: clean(t.str), x: e, y: f, w: t.width || 0, h });
  }
  const gutter = findGutter(items, pageW);
  let lines;
  if (gutter === null) {
    lines = groupLines(items, pageNum);
  } else {
    const cols = [[], []];
    const spanning = [];
    for (const i of items) {
      if (i.x < gutter && i.x + i.w > gutter) spanning.push(i);
      else cols[i.x + i.w / 2 < gutter ? 0 : 1].push(i);
    }
    const topY = Math.max(...cols.flat().map((i) => i.y));
    const above = spanning.filter((i) => i.y >= topY);
    const rest = spanning.filter((i) => i.y < topY);
    lines = [
      ...groupLines(above, pageNum),
      ...groupLines(cols[0].concat(rest), pageNum),
      ...groupLines(cols[1], pageNum),
    ];
  }
  for (const l of lines) l.edge = l.y > pageH * 0.92 ? 'top' : l.y < pageH * 0.08 ? 'bottom' : null;
  return lines;
}

// Drop running headers/footers and bare page numbers.
export function stripFurniture(pages) {
  const counts = new Map();
  const key = (l) => l.text.replace(/\d+/g, '#').toLowerCase();
  for (const lines of pages) {
    const seen = new Set();
    for (const l of lines) {
      if (!l.edge) continue;
      const k = key(l);
      if (!seen.has(k)) counts.set(k, (counts.get(k) || 0) + 1);
      seen.add(k);
    }
  }
  const min = Math.max(3, Math.ceil(pages.length * 0.4));
  return pages.map((lines) =>
    lines.filter((l) => {
      if (!l.edge) return true;
      if (/^[-–—\s]*(page\s+)?\d{1,4}([\s/]+(of\s+)?\d{1,4})?[-–—\s]*$/i.test(l.text)) return false;
      return (counts.get(key(l)) || 0) < min;
    }),
  );
}

export function buildBlocks(pages) {
  const all = pages.flat();
  if (!all.length) return [];
  // body size = most common height, weighted by amount of text
  const weight = new Map();
  for (const l of all) {
    const k = Math.round(l.h * 2) / 2;
    weight.set(k, (weight.get(k) || 0) + l.text.length);
  }
  const bodyH = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const pitches = [];
  for (const lines of pages) {
    for (let i = 1; i < lines.length; i++) {
      const dy = lines[i - 1].y - lines[i].y;
      if (dy > 0 && Math.abs(lines[i].h - bodyH) < 1 && Math.abs(lines[i - 1].h - bodyH) < 1) pitches.push(dy);
    }
  }
  const pitch = median(pitches) || bodyH * 1.2;
  const minX = median(all.map((l) => l.x0));
  const maxLen = (() => {
    const w = all.map((l) => l.x1 - l.x0).sort((a, b) => a - b);
    return w[Math.floor(w.length * 0.9)] || 1;
  })();

  const blocks = [];
  const level = (l) => {
    const r = l.h / bodyH;
    if (r >= 1.5) return 'h1';
    if (r >= 1.25) return 'h2';
    if (r >= 1.1 && l.text.length < 90) return 'h3';
    return 'p';
  };

  for (let pi = 0; pi < pages.length; pi++) {
    const lines = pages[pi];
    let cur = null;
    let prev = null;
    for (const l of lines) {
      const type = level(l);
      let start = !cur || !prev;
      if (!start) {
        const dy = prev.y - l.y;
        const sameCol = dy > 0;
        if (type !== (cur.type === 'li' ? 'p' : cur.type)) start = true;
        else if (type !== 'p') start = false; // consecutive heading lines join
        else if (!sameCol) start = SENTENCE_END.test(prev.text) || prev.page !== l.page; // moved to next column
        else if (dy > pitch * 1.55) start = true;
        else if (BULLET.test(l.text)) start = true;
        else if (l.x0 - minX > bodyH * 0.9 && l.x0 - prev.x0 > bodyH * 0.9) start = true;
        else if (prev.x1 - prev.x0 < maxLen * 0.6 && SENTENCE_END.test(prev.text)) start = true;
      }
      if (start) {
        cur = { type: type === 'p' && BULLET.test(l.text) ? 'li' : type, text: l.text, page: l.page };
        blocks.push(cur);
      } else if (/[A-Za-z]-$/.test(cur.text) && /^[a-z]/.test(l.text)) {
        cur.text = cur.text.slice(0, -1) + l.text;
      } else {
        cur.text += ' ' + l.text;
      }
      prev = l;
    }
  }

  // Merge paragraphs split by a page break.
  const out = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (last && last.type === 'p' && b.type === 'p' && last.page !== b.page &&
        (!SENTENCE_END.test(last.text) || /[A-Za-z]-$/.test(last.text)) && /^[a-z(]/.test(b.text)) {
      last.text = /[A-Za-z]-$/.test(last.text) ? last.text.slice(0, -1) + b.text : last.text + ' ' + b.text;
    } else out.push({ ...b });
  }
  return out;
}

export async function extractBlocks(pdf, onProgress) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    pages.push(pageLines(tc, viewport, n));
    page.cleanup();
    if (onProgress) onProgress(n, pdf.numPages);
  }
  return buildBlocks(stripFurniture(pages));
}
