import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Pages melayani dari subpath (/phonereadr/); di lokal tetap '/'.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: { target: 'es2022' },
  worker: { format: 'es' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      workbox: {
        // Aset pdf.js (font/cmap/wasm) di-cache saat dipakai, bukan di-precache.
        globPatterns: ['**/*.{js,css,html,svg,mjs}'],
        globIgnores: ['pdfjs/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/pdfjs/'),
            handler: 'CacheFirst',
            options: { cacheName: 'pdfjs-assets', expiration: { maxEntries: 400 } },
          },
        ],
      },
      manifest: {
        name: 'PhoneReadr',
        short_name: 'PhoneReadr',
        description: 'Pembaca PDF yang memotong margin tanpa mengubah layout.',
        lang: 'id',
        display: 'standalone',
        background_color: '#111111',
        theme_color: '#111111',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
});
