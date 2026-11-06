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

## Aplikasi gabungan (PhoneReadr lama + pembaca crop)

PhoneReadr lama (reflow teks; EPUB/DOCX/MD/TXT; perpustakaan offline) dan pembaca crop disatukan menjadi satu aplikasi.

| Aspek | Keputusan |
|---|---|
| Bentuk | Satu aplikasi. PDF punya dua mode, **Halaman** (crop, layout asli) dan **Teks** (reflow), dengan tombol ganti; format lain hanya mode Teks |
| Mode bawaan PDF | **Halaman** (tidak perlu ekstraksi teks di muka; juga bekerja untuk PDF scan). Mode terakhir diingat per dokumen |
| Ekstraksi teks | Malas: baru dijalankan saat pertama kali pindah ke Teks (progres + tombol Batal), hasilnya disimpan di dokumen |
| Posisi antar mode | Halaman N ↔ blok teks pertama dari halaman N (dan sebaliknya) |
| Perangkat | Android dan iPhone. pdf.js build *legacy*, sintaks diturunkan (`safari14`), tanpa regex lookbehind. Belum diuji di iPhone sungguhan |
| Penyimpanan | Record dokumen di IndexedDB `phonereadr` (skema sama dengan versi lama); PDF asli di `phonereadr-files` agar menyimpan posisi baca tidak menulis ulang file besar |
| File tak muat disimpan | Dibaca dari file yang dipilih; bila ditutup, saat dibuka dari daftar pengguna diminta memilih file yang sama |
| Data lama | Record lama tetap terbaca; PDF yang tersimpan di dalam record dimigrasikan ke `phonereadr-files` saat dibuka |
| Alamat | Menggantikan aplikasi lama di `/phonereadr/`. Aplikasi lama tersimpan di `/phonereadr/legacy/` (rollback); `/phonereadr/next/` dialihkan |

Kendali mode halaman (Aman/Agresif, Rapat, Asli) dipindah ke lembar pengaturan (⚙) agar bilah bawah tetap lega di layar sempit.

## Keputusan produk
| Aspek | Keputusan |
|---|---|
| Platform | PWA, pdf.js, semua di browser |
| Mode baca | **Scroll vertikal kontinu**, lebar konten = lebar layar. Semua halaman bersambung; hanya halaman di sekitar layar yang dirender. (Mode per-halaman dengan swipe dicoba lalu diganti: swipe terasa bentrok dengan membaca halaman yang lebih tinggi dari layar.) |
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
- **Panning**: scroll bawaan browser (`touch-action: pan-x pan-y`, pinch bawaan browser dimatikan). Scroll vertikal melintasi halaman; saat di-zoom, scroll horizontal tersedia.
- Zoom mengubah lebar semua halaman sekaligus lewat satu variabel CSS, jadi titik fokus tetap di bawah jari dan halaman aktif tidak berubah.
- Level zoom dipertahankan saat berpindah halaman.
- Waktu ketukan memakai `event.timeStamp` (waktu sentuhan sebenarnya), bukan waktu handler berjalan, agar double-tap tetap andal saat thread utama sibuk merender.
- Desktop: Ctrl+scroll, serta tombol `+` / `-` / `0`.

### 3. Render scroll kontinu (`src/viewer.ts`, `src/layout.ts`)
- Setiap halaman punya kerangka (`.slot`) berukuran tepat dari rasio area crop (`aspect-ratio` CSS) dan lebar `--pw` (= lebar layar × zoom). Total tinggi dokumen dan posisi tiap halaman langsung diketahui, tanpa merender apa pun.
- **Virtualisasi**: hanya halaman yang berada dalam ±1 tinggi layar (±0,3 saat di-zoom) yang dirender. Halaman di luar jangkauan dilepas (bitmap dikosongkan) dan total piksel kanvas dijaga ≤ 48 juta.
- Antrean render berurutan, terdekat ke tengah layar lebih dulu; render halaman yang sudah keluar layar dibatalkan.
- **Posisi baca stabil**: saat crop, ukuran halaman, mode, atau lebar berubah, titik acuan (halaman di tepi atas + fraksi yang terlewati) dipulihkan sehingga tampilan tidak melompat.
- Ukuran halaman dipelajari dari analisis/render dan disimpan di cache; sebelum diketahui dipakai ukuran halaman 1.
- Nomor halaman aktif = halaman pada 25% dari atas layar. Posisi terakhir tersimpan per dokumen.
- Navigasi: scroll, tombol sebelumnya/berikutnya, input nomor halaman, panah kiri/kanan.
- Tombol **Asli** menampilkan halaman tanpa crop sebagai pembanding.

## Penanganan file besar
- `FileRangeTransport` (`src/pdf/loader.ts`) memberi pdf.js potongan `File.slice()` sesuai permintaan.
- Hanya halaman di sekitar layar dan satu halaman yang sedang dianalisis yang dirender; tidak ada render massal.
- Terukur (Chromium headless, emulasi Pixel 7): PDF 405 MB / 300 halaman, kanvas pertama tampil ~2,5 dtk; scroll cepat 40× tidak pernah menyisakan lebih dari 5 kanvas dan heap JS maksimum ~32 MB; lompat ke halaman 250 langsung terender.

## Batasan MVP yang diketahui
- Zoom 1×–5×. Kanvas dibatasi 16 juta piksel, jadi pada zoom tinggi di halaman tinggi resolusinya turun (agak buram). Solusinya render per-tile (belum ada).
- Gestur diuji lewat Chromium headless (multi-touch via CDP); belum diuji di iOS Safari maupun HP sungguhan.
- PDF scan: memakai deteksi piksel yang sama; scan miring, bayangan, atau tepi hitam scanner belum ditangani khusus.
- PDF berproteksi sandi belum didukung.
- Halaman pencilan menyebabkan skala teks berubah di halaman itu saja (konsekuensi dari "tidak memotong konten").
- Pemisah antar halaman hanya garis tipis; pada dokumen yang halamannya hampir tanpa margin, batas halaman bisa kurang terlihat.
- Sebelum seluruh halaman dianalisis, tinggi halaman bisa berubah sedikit (posisi baca dijaga, tapi total panjang scroll berubah).
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
- `tests/zoom.test.ts`: matematika zoom dan titik fokus. `tests/layout.test.ts`: pencarian halaman dari posisi scroll.
- Uji manual end-to-end dengan Playwright (emulasi HP) dilakukan selama pengembangan: crop, halaman pencilan, mode Agresif, Rapat, file 405 MB, dan scroll kontinu (scroll sentuh, lompat halaman, jumlah kanvas hidup, posisi baca stabil saat ganti mode), dan gestur multi-touch (pinch, ketuk dua kali).
