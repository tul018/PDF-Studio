import type { TextIndex } from "./folderSearch";

/**
 * Folder-search text index in IndexedDB: page texts per file version, so
 * searching the same catalogs again (even after a restart) is instant.
 * Kept to MAX_ENTRIES files; the least recently used are dropped first.
 */
const DB = "pdfstudio-text-index";
const STORE = "files";
const MAX_ENTRIES = 3000;

interface Entry {
  key: string;
  pages: string[];
  used: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("used", "used");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const indexedTextIndex: TextIndex = {
  async get(key) {
    try {
      const store = (await db()).transaction(STORE, "readwrite").objectStore(STORE);
      const e = (await request(store.get(key))) as Entry | undefined;
      if (!e) return undefined;
      e.used = Date.now();
      store.put(e);
      return e.pages;
    } catch {
      return undefined;
    }
  },
  async put(key, pages) {
    try {
      const store = (await db()).transaction(STORE, "readwrite").objectStore(STORE);
      await request(store.put({ key, pages, used: Date.now() } as Entry));
      if ((await request(store.count())) > MAX_ENTRIES) {
        // Drop the least recently used tenth.
        const old = store.index("used").openKeyCursor();
        let n = Math.ceil(MAX_ENTRIES / 10);
        old.onsuccess = () => {
          const c = old.result;
          if (!c || n-- <= 0) return;
          store.delete(c.primaryKey);
          c.continue();
        };
      }
    } catch {
      /* storage full / private mode: search still works, just not remembered */
    }
  },
};

/** For tests and when IndexedDB is unavailable. */
export function memoryTextIndex(): TextIndex {
  const m = new Map<string, string[]>();
  return {
    get: async (k) => m.get(k),
    put: async (k, v) => void m.set(k, v),
  };
}
