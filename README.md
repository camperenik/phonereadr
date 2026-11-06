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
