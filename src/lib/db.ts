import type { Block, Format } from './types';

/**
 * Perpustakaan dokumen. Skema SAMA dengan aplikasi PhoneReadr lama
 * (IndexedDB 'phonereadr' v1, store 'docs') agar daftar bacaan lama tetap terbaca.
 * Field tambahan (mode, page, progress) bersifat opsional.
 */
export interface DocRecord {
  id: string;
  name: string;
  format?: Format; // dokumen lama tanpa field ini = pdf
  pages: number;
  blob: Blob | null;
  blocks: Block[];
  anchor: number;
  opened: number;
  /** Mode baca terakhir untuk PDF. */
  mode?: 'text' | 'page';
  /** Halaman terakhir (1-based) pada mode halaman. */
  page?: number;
  /** Progres baca 0..1 (dipakai daftar Recent). */
  progress?: number;
  /** true bila file asli tidak muat disimpan (mis. kuota penuh); harus dipilih ulang saat dibuka. */
  unstored?: boolean;
}

const STORE = 'docs';
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('phonereadr', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const putDoc = (doc: DocRecord) => tx('readwrite', (s) => s.put(doc));
export const getDoc = (id: string) => tx<DocRecord | undefined>('readonly', (s) => s.get(id));
export const allDocs = () => tx<DocRecord[]>('readonly', (s) => s.getAll());

// ---------- file asli (PDF) ----------
// Disimpan di database TERPISAH supaya record dokumen tetap kecil: memperbarui posisi
// baca tidak menulis ulang file ratusan MB. DB 'phonereadr' v1 juga tidak diubah,
// sehingga aplikasi lama (/legacy/) tetap bisa membukanya.
const FILES_DB = 'phonereadr-files';
const FILES = 'files';
let fdbp: Promise<IDBDatabase> | null = null;

function openFiles(): Promise<IDBDatabase> {
  if (!fdbp) {
    fdbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(FILES_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(FILES);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return fdbp;
}

async function ftx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await openFiles();
  return new Promise((resolve, reject) => {
    const t = d.transaction(FILES, mode);
    const r = fn(t.objectStore(FILES));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** Simpan file asli. Mengembalikan false jika gagal (mis. kuota penuh). */
export async function putFile(id: string, blob: Blob): Promise<boolean> {
  try {
    await ftx('readwrite', (s) => s.put(blob, id));
    return true;
  } catch {
    return false;
  }
}

/** Ambil file asli: dari penyimpanan baru, atau dari record lama yang menyimpannya langsung. */
export async function getFile(doc: DocRecord): Promise<Blob | null> {
  try {
    const b = await ftx<Blob | undefined>('readonly', (s) => s.get(doc.id));
    if (b) return b;
  } catch {
    /* lanjut ke blob bawaan record */
  }
  return doc.blob ?? null;
}

export async function delDoc(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
  try {
    await ftx('readwrite', (s) => s.delete(id));
  } catch {
    /* abaikan */
  }
}

/** Hitung progres 0..1 untuk tampilan Recent (dokumen lama hanya punya anchor). */
export function progressOf(d: DocRecord): number {
  if (typeof d.progress === 'number') return d.progress;
  return d.blocks.length ? d.anchor / d.blocks.length : 0;
}
