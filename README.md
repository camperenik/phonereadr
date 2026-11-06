# PhoneReadr

Pembaca dokumen untuk HP (PWA). Semua diproses di perangkat, tanpa unggah ke server, dan bisa dipakai offline setelah dipasang.

**Dua cara membaca PDF** (bisa berganti kapan saja, posisi baca ikut terbawa):

- **Halaman**: tata letak asli PDF, dengan margin kosong di keempat sisi dipotong otomatis sehingga isi tampil lebih besar. Layout dan gambar tidak berubah. Scroll vertikal kontinu, pinch-zoom, ketuk dua kali untuk zoom.
- **Teks**: teks diambil dan disusun ulang (reflow) sesuai lebar layar, dengan ukuran huruf, tema, dan jarak yang bisa diatur, plus daftar isi.

Juga membuka **EPUB, DOCX, Markdown, dan TXT** (mode teks). Daftar "Terakhir dibuka" mengingat posisi baca tiap dokumen.

Spesifikasi: [docs/SPEC.md](docs/SPEC.md)

## Menjalankan

```bash
npm install
npm run dev        # server pengembangan
npm test           # unit test
npm run build      # build produksi (dist/)
npm run preview    # coba hasil build
```

## Struktur

- `src/crop/` deteksi kotak konten dan agregasi crop (mode halaman)
- `src/viewer.ts` pembaca halaman: scroll kontinu, virtualisasi, zoom/gestur
- `src/reflow/` reflow teks PDF dan parser EPUB/DOCX/Markdown/TXT (mode teks)
- `src/text/` pembaca teks: pengaturan, tema, daftar isi
- `src/lib/db.ts` perpustakaan dokumen (IndexedDB)
- `src/pdf/` pemuatan PDF per-range dan analisis halaman
- `src/main.ts` beranda, perpustakaan, dan perpindahan antar mode

## Deploy (GitHub Pages dari branch)

Pages repo ini disajikan dari branch `claude/iphone-pdf-reader-ucatys`. Untuk men-deploy:

```bash
scripts/deploy-pages.sh
```

Skrip membangun dengan base path `/phonereadr/`, mengganti isi root branch Pages, dan mempertahankan aplikasi PhoneReadr lama di `/phonereadr/legacy/` sebagai jalur rollback. Alamat `/phonereadr/next/` (alamat uji sebelumnya) dialihkan ke aplikasi utama.

## Catatan kompatibilitas

- Memakai build pdf.js "legacy" dan sintaks yang diturunkan agar jalan di Safari/iOS yang lebih lama. Kode sumber tidak memakai regex *lookbehind*, `Array.at`, dan sejenisnya. Belum diuji di iPhone sungguhan.
- Perpustakaan memakai IndexedDB `phonereadr` (skema sama dengan aplikasi lama, sehingga daftar bacaan lama tetap terbaca) dan `phonereadr-files` untuk salinan PDF asli.
