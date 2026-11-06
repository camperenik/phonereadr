import type { RawBoxes } from '../crop/types';

// Nama berbeda dari aplikasi PhoneReadr lama yang berbagi origin yang sama.
const DB = 'phonereadr-crop';
const STORE = 'analysis';

export interface CachedAnalysis {
  id: string;
  raw: RawBoxes;
  total: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadAnalysis(id: string): Promise<CachedAnalysis | undefined> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).get(id);
      r.onsuccess = () => resolve(r.result as CachedAnalysis | undefined);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return undefined; // mode privat / IndexedDB tidak tersedia: lanjut tanpa cache
  }
}

export async function saveAnalysis(entry: CachedAnalysis): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* abaikan */
  }
}

/** Preferensi ringan (halaman terakhir, mode) di localStorage. */
export function getPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`pr:${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function setPref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`pr:${key}`, JSON.stringify(value));
  } catch {
    /* abaikan */
  }
}
