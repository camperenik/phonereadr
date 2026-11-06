# PhoneReadr

Pembaca PDF (PWA) untuk HP yang memotong margin kosong di keempat sisi, sehingga isi halaman
tampil lebih besar. Layout dan gambar PDF tetap utuh: yang dipotong hanya ruang kosong.
Semua diproses di perangkat, file tidak diunggah.

Spesifikasi lengkap: [docs/SPEC.md](docs/SPEC.md)

## Menjalankan

```bash
npm install
npm run dev        # server pengembangan
npm test           # unit test
npm run build      # build produksi (dist/)
npm run preview    # coba hasil build
```

## Struktur

- `src/crop/` — deteksi kotak konten dan agregasi crop (logika murni, teruji)
- `src/pdf/` — pemuatan PDF per-range dan analisis halaman
- `src/store/` — cache analisis (IndexedDB) dan preferensi
- `src/viewer.ts` — render ber-crop, navigasi swipe, mode Aman/Agresif

## Deploy (GitHub Pages)

Workflow `.github/workflows/deploy.yml` menjalankan tes, build, dan deploy otomatis setiap push ke `main`.

Pengaturan satu kali: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Alamat hasilnya: `https://<pemilik>.github.io/phonereadr/`. Buka di HP, lalu pilih "Tambahkan ke layar utama" untuk memasangnya sebagai aplikasi.

Build lokal dengan base path yang sama: `BASE_PATH=/phonereadr/ npm run build`.
