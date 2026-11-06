// Membuat semua ikon dari satu definisi vektor.
// Pakai:  node scripts/make-icons.cjs   (butuh paket "playwright" dengan Chromium)
// Hasil: design/*.svg (sumber) dan public/*.png (dipakai PWA)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');

/** Glif: halaman + tanda potong di keempat sudut. Koordinat pada kanvas 1024. */
function glyph({ mono = false } = {}) {
  const ink = mono ? '#000' : '#fff';
  const head = mono ? '#000' : '#1B2B6B';
  const line = mono ? '#000' : '#C9D3F5';
  // tanda potong: huruf L tebal di tiap sudut, mengapit halaman
  const arm = 132;
  const [x0, y0, x1, y1] = [216, 176, 808, 848];
  const brackets = `
    <g fill="none" stroke="${ink}" stroke-width="44" stroke-linecap="round" stroke-linejoin="round">
      <path d="M${x0} ${y0 + arm} V${y0} H${x0 + arm}"/>
      <path d="M${x1 - arm} ${y0} H${x1} V${y0 + arm}"/>
      <path d="M${x1} ${y1 - arm} V${y1} H${x1 - arm}"/>
      <path d="M${x0 + arm} ${y1} H${x0} V${y1 - arm}"/>
    </g>`;
  const page = mono
    ? `<rect x="296" y="256" width="432" height="512" rx="36" fill="none" stroke="#000" stroke-width="30"/>`
    : `<rect x="296" y="256" width="432" height="512" rx="36" fill="#fff" filter="url(#sh)"/>`;
  const content = mono
    ? `
    <rect x="344" y="312" width="200" height="32" rx="16" fill="#000"/>
    <rect x="344" y="372" width="336" height="24" rx="12" fill="#000"/>
    <rect x="344" y="660" width="336" height="24" rx="12" fill="#000"/>
    <rect x="344" y="708" width="232" height="24" rx="12" fill="#000"/>
    <rect x="344" y="432" width="336" height="196" rx="24" fill="#000"/>`
    : `
    <rect x="344" y="312" width="200" height="34" rx="17" fill="${head}"/>
    <rect x="344" y="372" width="336" height="24" rx="12" fill="${line}"/>
    <rect x="344" y="432" width="336" height="196" rx="24" fill="url(#img)"/>
    <circle cx="610" cy="486" r="22" fill="#fff" fill-opacity=".9"/>
    <path d="M344 628 V592 L440 512 L520 580 L572 540 L680 612 V628 Z" fill="#fff" fill-opacity=".38"/>
    <rect x="344" y="660" width="336" height="24" rx="12" fill="${line}"/>
    <rect x="344" y="708" width="232" height="24" rx="12" fill="${line}"/>`;
  return `${brackets}${page}${content}`;
}

const DEFS = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6A97FF"/><stop offset="1" stop-color="#1F3FD6"/>
    </linearGradient>
    <radialGradient id="glow" cx=".25" cy=".15" r=".8">
      <stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="img" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#9DB9FF"/><stop offset="1" stop-color="#4F7CFF"/>
    </linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#0B1B6B" flood-opacity=".35"/>
    </filter>
  </defs>`;

/** variant: any = kotak membulat (transparan di sudut); full = kotak penuh; mono = glif hitam transparan. */
function svg(variant, scale = 1) {
  const t = scale === 1 ? '' : ` transform="translate(512 512) scale(${scale}) translate(-512 -512)"`;
  if (variant === 'mono') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g${t}>${glyph({ mono: true })}</g></svg>`;
  }
  const bg =
    variant === 'any'
      ? `<rect width="1024" height="1024" rx="228" fill="url(#bg)"/><rect width="1024" height="1024" rx="228" fill="url(#glow)"/>`
      : `<rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#glow)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${DEFS}${bg}<g${t}>${glyph()}</g></svg>`;
}

const OUT = [
  // [berkas, varian, skala glif, ukuran px]
  ['icon-512.png', 'any', 1, 512],
  ['icon-192.png', 'any', 1, 192],
  ['icon-32.png', 'any', 1, 32],
  ['icon-maskable-512.png', 'full', 0.84, 512], // glif di zona aman (lingkaran 80%)
  ['apple-touch-icon.png', 'full', 1, 180], // iOS menolak transparansi (sudut jadi hitam)
  ['icon-monochrome-512.png', 'mono', 0.9, 512], // untuk ikon bertema Android 13+
];

(async () => {
  fs.mkdirSync(path.join(ROOT, 'design'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'design/icon.svg'), svg('any'));
  fs.writeFileSync(path.join(ROOT, 'design/icon-maskable.svg'), svg('full', 0.84));
  fs.writeFileSync(path.join(ROOT, 'design/icon-monochrome.svg'), svg('mono', 0.9));
  fs.copyFileSync(path.join(ROOT, 'design/icon.svg'), path.join(ROOT, 'public/icon.svg'));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [file, variant, scale, size] of OUT) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${svg(variant, scale).replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body></html>`,
    );
    await page.screenshot({ path: path.join(ROOT, 'public', file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('dibuat', file, `${size}x${size}`);
  }
  await browser.close();
})();
