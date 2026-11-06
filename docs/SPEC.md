# PhoneReadr — Spesifikasi MVP

## Tujuan
Pembaca PDF berbasis web (PWA) untuk HP yang **menghilangkan margin kosong di keempat sisi**
sehingga isi halaman tampil lebih besar, **tanpa mengubah layout, tanpa reflow, dan tanpa
menghilangkan gambar**. Berbeda dari reader sebelumnya yang hanya mengambil teks, PhoneReadr
tetap merender halaman PDF asli; yang berubah hanya area yang ditampilkan (crop) dan skalanya.

## Prinsip
1. **Render asli, bukan ekstraksi.** Halaman dirender oleh pdf.js; crop hanya mengatur jendela tampilan.
2. **Tidak pernah memotong konten.** Pada mode Aman, tidak ada piksel konten yang boleh terpotong.
3. **Privat.** Semua pemrosesan terjadi di perangkat; file tidak pernah diunggah.
4. **Mampu file ratusan MB.** File dibaca per potongan (range), bukan dimuat utuh.

## Keputusan produk
| Aspek | Keputusan |
|---|---|
| Platform | PWA, pdf.js, semua di browser |
| Mode baca | Per halaman (swipe), lebar konten = lebar layar; scroll vertikal di dalam halaman jika lebih tinggi dari layar |
| Definisi margin | Warna latar dominan di tepi halaman (bukan hanya putih) |
| Crop | Seragam per dokumen (ganjil/genap dipisah), tahan pencilan |
| Header/footer | Toggle: **Aman** (dipertahankan) / **Agresif** (pita tipis di tepi diabaikan) |
| Jenis PDF | Digital dan scan, lewat deteksi berbasis piksel yang sama |
| Analisis | Sampel 24 halaman tersebar dulu, sisanya di latar belakang; cache di IndexedDB |
| Sisa kosong di bawah | Toggle **Rapat**: batas bawah mengikuti konten halaman itu sendiri; sisi lain tetap seragam |
| Output | Viewer saja (ekspor PDF ter-crop: pasca-MVP) |

## Algoritma crop

### 1. Deteksi per halaman (`src/crop/detect.ts`)
- Render halaman kecil (lebar 420 px) sekali; kedua mode dideteksi dari piksel yang sama.
- Warna latar = median per kanal dari cincin piksel di tepi.
- Piksel "tinta" = selisih kanal maksimum terhadap latar > toleransi (Aman 24, Agresif 40).
- Garis dihitung konten jika punya >= N piksel tinta (penyaring bintik/noda).
- **Agresif**: pita tipis (<= 6% tinggi) di atas/bawah yang terpisah dari isi oleh celah >= 2,5% tinggi diabaikan.
- Hasil: kotak ternormalisasi 0..1; `null` untuk halaman kosong.

### 2. Agregasi dokumen (`src/crop/aggregate.ts`)
- Crop seragam per grup (ganjil/genap) memakai kuantil ke-10/90 pada tiap sisi, sehingga beberapa pencilan tidak melebarkan crop seluruh dokumen. Sampel < 5 halaman memakai gabungan penuh.
- Halaman yang kontennya melewati crop seragam memakai **union** dengan kotaknya sendiri → konten tidak pernah terpotong; hanya halaman pencilan itu yang tampil sedikit lebih kecil.
- Halaman kosong atau belum dianalisis memakai crop seragam grupnya.

### 2b. Opsi Rapat (`trimBottom`)
- Batas bawah tiap halaman = bawah konten halaman itu (tidak pernah memotong konten). Kiri, kanan, dan atas tetap seragam sehingga skala teks stabil.
- Halaman pendek (cover, akhir bab) jadi lebih rendah; sisa layar diisi latar gelap sebagai penanda akhir halaman.
- **Bergantung pada mode**: di mode Aman, footer dihitung sebagai konten sehingga batas bawah tetap di footer dan Rapat nyaris tidak berefek. Gunakan bersama mode Agresif (footer diabaikan). Contoh pada dokumen uji: halaman cover 636 → 205 px, halaman 5 636 → 524 px.
- Padding deteksi ~0,6% (min. 2 px) menjaga baris anti-alias tipis pada teks kecil agar tidak terpotong.

### 2c. Zoom dan gestur (`src/zoom.ts`, `src/viewer.ts`)
- **Pinch**: dua jari mengubah zoom 1×–5×; titik di antara jari tetap berada di bawah jari (sekaligus panning). Selama gestur, tampilan di-skala lewat CSS (instan); setelah jari diangkat halaman dirender ulang pada resolusi sebenarnya agar tajam. Zoom < 1,08 menempel ke 1×.
- **Ketuk dua kali**: bergantian 1× ↔ 2,5× pada titik yang diketuk.
- **Panning**: scroll bawaan browser (`touch-action: pan-x pan-y`, pinch bawaan browser dimatikan).
- **Swipe pindah halaman**: aktif penuh pada 1×. Saat di-zoom, hanya jika gerakan dimulai dan berakhir di tepi yang sama (konten sudah mentok), sehingga tidak bentrok dengan panning.
- Level zoom dipertahankan antar halaman; scroll kembali ke kiri-atas saat pindah halaman.
- Desktop: Ctrl+scroll, serta tombol `+` / `-` / `0`.

### 3. Render (`src/viewer.ts`)
- Skala = lebar layar × DPR / lebar area crop; canvas dibatasi 16 juta piksel.
- Render ke canvas luar layar, lalu disalin, agar tidak berkedip.
- Navigasi: swipe horizontal, tombol, input nomor halaman, panah keyboard. Posisi terakhir tersimpan per dokumen.
- Tombol **Asli** menampilkan halaman tanpa crop sebagai pembanding.

## Penanganan file besar
- `FileRangeTransport` (`src/pdf/loader.ts`) memberi pdf.js potongan `File.slice()` sesuai permintaan.
- Hanya halaman yang dibaca dan halaman yang sedang dianalisis yang dirender; tidak ada render massal.
- Terukur: PDF 405 MB / 300 halaman tampil dalam ~1,4 dtk dengan heap JS ~12 MB (Chromium headless, emulasi Pixel 7).

## Batasan MVP yang diketahui
- Zoom 1×–5×. Kanvas dibatasi 16 juta piksel, jadi pada zoom tinggi di halaman tinggi resolusinya turun (agak buram). Solusinya render per-tile (belum ada).
- Gestur diuji lewat Chromium headless (multi-touch via CDP); belum diuji di iOS Safari maupun HP sungguhan.
- PDF scan: memakai deteksi piksel yang sama; scan miring, bayangan, atau tepi hitam scanner belum ditangani khusus.
- PDF berproteksi sandi belum didukung.
- Halaman pencilan menyebabkan skala teks berubah di halaman itu saja (konsekuensi dari "tidak memotong konten").
- Belum ada ekspor PDF ter-crop, penanda baca, atau pencarian teks.
- Jalur cepat untuk PDF digital (bounding box dari operator list tanpa render) belum dibuat; deteksi piksel dipakai untuk semuanya.

## Peta jalan
1. **MVP (ini):** viewer, crop otomatis seragam, toggle Aman/Agresif, Rapat, pinch-zoom, cache, PWA.
2. Render per-tile untuk zoom tinggi; penyesuaian crop manual per halaman/rentang.
3. Penanganan scan: deskew, abaikan tepi gelap scanner, ambang adaptif.
4. Ekspor PDF ter-crop (ubah CropBox lewat pdf-lib, tetap vektor dan bisa dicari).
5. Daftar bacaan terbaru, penanda baca, tema gelap/invert, buka lewat file handler PWA.

## Pengujian
- `npm test`: unit test deteksi (margin putih/berwarna/gelap, halaman kosong, Aman vs Agresif, gambar full-bleed) dan agregasi (pencilan, tidak pernah memotong konten, ganjil/genap, sampling).
- `tests/zoom.test.ts`: matematika zoom, titik fokus, dan aturan swipe saat di-zoom.
- Uji manual end-to-end dengan Playwright (emulasi HP) dilakukan selama pengembangan: crop, halaman pencilan, mode Agresif, Rapat, file 405 MB, dan gestur multi-touch (pinch, panning, swipe dari tepi, ketuk dua kali, pinch-in dijepit ke 1×).
