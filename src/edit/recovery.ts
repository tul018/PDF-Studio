import type { EditState, StoredImage } from "./model";

/**
 * Crash recovery. While there are unsaved edits, the (small) edit model is
 * written to IndexedDB every few seconds. If the app is killed - by the OS,
 * a power cut, or a crash - reopening the same file offers to restore them.
 */
const DB = "pdfstudio-recovery";
const STORE = "drafts";
const MAIN = "$main";

interface Draft {
  key: string;
  savedAt: number;
  /** Size + modified time of the file the edits were made to. */
  version?: string;
  state: EditState;
  images: Record<string, Omit<StoredImage, "url">>;
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function saveDraft(
  fileKey: string,
  version: string,
  mainDocId: string,
  state: EditState,
  images: Map<string, StoredImage>,
): Promise<void> {
  try {
    // Only pages of the main file can be restored (merged files aren't stored).
    const pages = state.pages.filter((p) => p.docId === mainDocId || p.docId === null);
    const ids = new Set(pages.map((p) => p.id));
    const portable: EditState = {
      pages: pages.map((p) => (p.docId ? { ...p, docId: MAIN } : p)),
      annotations: state.annotations.filter((a) => ids.has(a.pageId)),
      formValues: Object.fromEntries(
        Object.entries(state.formValues)
          .filter(([k]) => k.startsWith(mainDocId + "|"))
          .map(([k, v]) => [MAIN + k.slice(mainDocId.length), v]),
      ),
    };
    const imgs: Draft["images"] = {};
    for (const a of portable.annotations) {
      if (a.type === "image") {
        const im = images.get(a.imageId);
        if (im) imgs[a.imageId] = { bytes: im.bytes, mime: im.mime, width: im.width, height: im.height };
      }
    }
    await tx("readwrite", (s) => s.put({ key: fileKey, savedAt: Date.now(), version, state: portable, images: imgs } as Draft));
  } catch (e) {
    console.warn("draft save failed", e);
  }
}

export async function loadDraft(
  fileKey: string,
  version: string,
  mainDocId: string,
): Promise<{ state: EditState; images: Draft["images"]; savedAt: number } | null> {
  try {
    const d = (await tx("readonly", (s) => s.get(fileKey))) as Draft | undefined;
    if (!d) return null;
    // The file changed on disk since (saved elsewhere, replaced): the edits'
    // page numbers and positions no longer apply to it.
    if (d.version !== version) {
      void clearDraft(fileKey);
      return null;
    }
    const st = d.state;
    return {
      savedAt: d.savedAt,
      images: d.images,
      state: {
        pages: st.pages.map((p) => (p.docId === MAIN ? { ...p, docId: mainDocId } : p)),
        annotations: st.annotations,
        formValues: Object.fromEntries(
          Object.entries(st.formValues).map(([k, v]) => [mainDocId + k.slice(MAIN.length), v]),
        ),
      },
    };
  } catch {
    return null;
  }
}

export async function clearDraft(fileKey: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(fileKey));
  } catch {
    /* ignore */
  }
}
