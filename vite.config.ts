import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Pages melayani dari subpath (/phonereadr/); di lokal tetap '/'.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  // Turunkan sintaks agar terbaca Safari/iOS yang lebih lama juga.
  build: { target: ['es2020', 'safari14', 'chrome87'] },
  worker: { format: 'es' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      workbox: {
        // Semua aset (termasuk font/cmap/wasm pdf.js, ±4 MB) di-precache agar
        // aplikasi dan semua jenis PDF bisa dibuka sepenuhnya offline setelah dipasang.
        globPatterns: ['**/*.{js,css,html,svg,png,mjs,wasm,bcmap,pfb,ttf,icc,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        // /legacy/ (aplikasi lama) dan /next/ (alamat uji lama) bukan bagian dari aplikasi ini.
        navigateFallbackDenylist: [/\/legacy\//, /\/next\//],
      },
      manifest: {
        id: process.env.BASE_PATH ?? '/',
        name: 'PhoneReadr',
        short_name: 'PhoneReadr',
        description: 'Baca PDF tanpa margin kosong atau sebagai teks yang disusun ulang; juga EPUB, DOCX, Markdown, TXT.',
        lang: 'id',
        display: 'standalone',
        orientation: 'any',
        background_color: '#111111',
        theme_color: '#111111',
        categories: ['books', 'productivity'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
});
