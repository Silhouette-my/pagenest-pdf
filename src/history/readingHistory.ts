import type { PageTheme } from "../theme/pageTheme";
import type { ZoomMode } from "../pdf/viewer";

// Nothing in this module makes a network request. IndexedDB stores metadata
// and serializable FileSystemFileHandles; OPFS stores optional local PDF bytes.
const DATABASE_NAME = "gemini-pdf-reader.history";
const DATABASE_VERSION = 2;
const CACHE_PREFIX = "pdf-";

export interface ReadingPosition {
  page: number;
  scrollTop: number;
  scrollLeft: number;
  zoomMode: ZoomMode;
  zoomScale: number;
  pageTheme: PageTheme;
  lastReadAt: number;
}

export interface HistoryRecord extends ReadingPosition {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  fileHandle?: FileSystemFileHandle;
  cacheKey?: string;
}

export interface HistorySettings {
  restorePreviousSession: boolean;
  cacheLocalFiles: boolean;
}

export const DEFAULT_HISTORY_SETTINGS: HistorySettings = {
  restorePreviousSession: true,
  cacheLocalFiles: true,
};

interface SettingRecord {
  key: string;
  value: unknown;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("documents")) {
          db.createObjectStore("documents", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
        // v2: active reading seconds per local day and document.
        if (!db.objectStoreNames.contains("readingTime")) {
          db.createObjectStore("readingTime", { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("History database is busy in another tab."));
    }).catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

async function read<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const request = tx.objectStore(store).get(key);
    tx.oncomplete = () => resolve(request.result as T | undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("History read aborted."));
  });
}

async function put<T>(store: string, value: T): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("History write aborted."));
  });
}

async function remove(store: string, key: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("History deletion aborted."));
  });
}

// Merge in a single readwrite transaction to avoid overwriting a newer scroll
// checkpoint or the cache/handle written by another asynchronous operation.
async function modifyDocument(
  id: string,
  update: (record: HistoryRecord | undefined) => HistoryRecord | undefined,
): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("documents", "readwrite");
    const store = tx.objectStore("documents");
    const request = store.get(id);
    request.onsuccess = () => {
      const next = update(request.result as HistoryRecord | undefined);
      if (next) store.put(next);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("History update aborted."));
  });
}

export async function getHistorySettings(): Promise<HistorySettings> {
  const entry = await read<SettingRecord>("settings", "preferences");
  const candidate = (entry?.value ?? {}) as Partial<HistorySettings>;
  return {
    restorePreviousSession:
      typeof candidate.restorePreviousSession === "boolean"
        ? candidate.restorePreviousSession
        : DEFAULT_HISTORY_SETTINGS.restorePreviousSession,
    cacheLocalFiles:
      typeof candidate.cacheLocalFiles === "boolean"
        ? candidate.cacheLocalFiles
        : DEFAULT_HISTORY_SETTINGS.cacheLocalFiles,
  };
}

export function setHistorySettings(value: HistorySettings): Promise<void> {
  return put("settings", { key: "preferences", value });
}

export async function getActiveDocumentId(): Promise<string | null> {
  const entry = await read<SettingRecord>("settings", "activeDocument");
  return typeof entry?.value === "string" ? entry.value : null;
}

export function setActiveDocumentId(id: string | null): Promise<void> {
  return put("settings", { key: "activeDocument", value: id });
}

export function getDocument(id: string): Promise<HistoryRecord | undefined> {
  return read<HistoryRecord>("documents", id);
}

export async function listDocuments(): Promise<HistoryRecord[]> {
  const db = await openDatabase();
  const records = await new Promise<HistoryRecord[]>((resolve, reject) => {
    const tx = db.transaction("documents", "readonly");
    const request = tx.objectStore("documents").getAll();
    tx.oncomplete = () => resolve(request.result as HistoryRecord[]);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("History listing aborted."));
  });
  return records.sort((a, b) => b.lastReadAt - a.lastReadAt);
}

export function rememberDocument(record: HistoryRecord): Promise<void> {
  return modifyDocument(record.id, (existing) => ({
    ...record,
    // Preserve a previous handle/cache unless this opener has a new one.
    fileHandle: record.fileHandle ?? existing?.fileHandle,
    cacheKey: existing?.cacheKey ?? record.cacheKey,
    // A delayed "remember" must never erase a later progress checkpoint.
    ...(existing && existing.lastReadAt > record.lastReadAt
      ? {
          page: existing.page,
          scrollTop: existing.scrollTop,
          scrollLeft: existing.scrollLeft,
          zoomMode: existing.zoomMode,
          zoomScale: existing.zoomScale,
          pageTheme: existing.pageTheme,
          lastReadAt: existing.lastReadAt,
        }
      : {}),
  }));
}

export function savePosition(
  id: string,
  position: ReadingPosition,
): Promise<void> {
  return modifyDocument(id, (existing) =>
    existing && position.lastReadAt >= existing.lastReadAt
      ? { ...existing, ...position }
      : undefined,
  );
}

function fileNameForCacheKey(key: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(key)) {
    throw new Error("Invalid local PDF cache key.");
  }
  return CACHE_PREFIX + key + ".pdf";
}

async function cacheRoot(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) {
    throw new Error("Local PDF caching is not supported by this browser.");
  }
  return navigator.storage.getDirectory();
}

async function deleteCacheKey(key: string): Promise<void> {
  const root = await cacheRoot();
  try {
    await root.removeEntry(fileNameForCacheKey(key));
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) {
      throw error;
    }
  }
}

export async function readCachedDocument(record: HistoryRecord): Promise<File | null> {
  if (!record.cacheKey) return null;
  try {
    const root = await cacheRoot();
    const handle = await root.getFileHandle(fileNameForCacheKey(record.cacheKey));
    const file = await handle.getFile();
    if (file.size !== record.size || !(await file.slice(0, 1024).text()).includes("%PDF-")) {
      throw new Error("Cached PDF is incomplete or corrupt.");
    }
    return file;
  } catch {
    // A missing/invalid cache must not block use of the original file handle.
    await modifyDocument(record.id, (current) =>
      current && current.cacheKey === record.cacheKey
        ? { ...current, cacheKey: undefined }
        : undefined,
    );
    await deleteCacheKey(record.cacheKey).catch(() => {});
    return null;
  }
}

export async function cacheDocument(id: string, blob: Blob): Promise<void> {
  const existing = await getDocument(id);
  if (!existing || existing.cacheKey || !blob.size) return;
  // Avoid long-running copies and significant storage pressure for giant PDFs.
  if (blob.size > 256 * 1024 * 1024) return;

  // Copy as a stream: do not allocate a second PDF-sized ArrayBuffer. A fresh
  // key is published in IndexedDB only after the OPFS stream is fully closed.
  const estimate = await navigator.storage?.estimate?.();
  if (
    estimate?.quota !== undefined &&
    estimate.usage !== undefined &&
    estimate.quota - estimate.usage < blob.size
  ) {
    throw new DOMException("Not enough browser storage for this PDF.", "QuotaExceededError");
  }

  const key = crypto.randomUUID();
  const root = await cacheRoot();
  const name = fileNameForCacheKey(key);
  try {
    const handle = await root.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await blob.stream().pipeTo(writable);
    let accepted = false;
    await modifyDocument(id, (current) => {
      if (!current || current.cacheKey || current.size !== blob.size) return undefined;
      accepted = true;
      return { ...current, cacheKey: key };
    });
    if (!accepted) await deleteCacheKey(key);
  } catch (error) {
    await deleteCacheKey(key).catch(() => {});
    throw error;
  }
}

export async function clearCachedDocument(id: string): Promise<void> {
  const record = await getDocument(id);
  if (!record?.cacheKey) return;
  await deleteCacheKey(record.cacheKey);
  await modifyDocument(id, (current) =>
    current && current.cacheKey === record.cacheKey
      ? { ...current, cacheKey: undefined }
      : undefined,
  );
}

export async function clearCachedDocuments(): Promise<void> {
  for (const record of await listDocuments()) {
    if (!record.cacheKey) continue;
    await deleteCacheKey(record.cacheKey);
    await modifyDocument(record.id, (current) =>
      current && current.cacheKey === record.cacheKey
        ? { ...current, cacheKey: undefined }
        : undefined,
    );
  }
}

export async function forgetDocument(id: string): Promise<void> {
  const record = await getDocument(id);
  if (record?.cacheKey) await deleteCacheKey(record.cacheKey);
  await remove("documents", id);
  if ((await getActiveDocumentId()) === id) await setActiveDocumentId(null);
}

export function describeStorageError(error: unknown): string {
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return "Browser storage is full. Clear the local PDF cache or free disk space.";
  }
  return error instanceof Error ? error.message : "Local history storage is unavailable.";
}

// ---- Per-window last document -------------------------------------------

const WINDOW_KEY_PREFIX = "window:";
const MAX_WINDOW_ENTRIES = 30;

interface WindowDocumentRecord extends SettingRecord {
  value: string | null;
  updatedAt: number;
}

/** Last document opened in a given Chrome window (ids come from the extension). */
export async function getWindowDocumentId(windowId: number): Promise<string | null> {
  const entry = await read<WindowDocumentRecord>("settings", WINDOW_KEY_PREFIX + windowId);
  return typeof entry?.value === "string" ? entry.value : null;
}

export async function setWindowDocumentId(windowId: number, id: string | null): Promise<void> {
  await put<WindowDocumentRecord>("settings", {
    key: WINDOW_KEY_PREFIX + windowId,
    value: id,
    updatedAt: Date.now(),
  });

  // Window ids are not reused across browser restarts; keep the newest few.
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("settings", "readwrite");
    const store = tx.objectStore("settings");
    const request = store.getAll();
    request.onsuccess = () => {
      const entries = (request.result as WindowDocumentRecord[])
        .filter((entry) => entry.key.startsWith(WINDOW_KEY_PREFIX))
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      for (const stale of entries.slice(MAX_WINDOW_ENTRIES)) store.delete(stale.key);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Window history update aborted."));
  });
}

// ---- Reading time ---------------------------------------------------------

export interface ReadingTimeRecord {
  /** `${date}|${documentId}` */
  key: string;
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  documentId: string;
  name: string;
  seconds: number;
  updatedAt: number;
}

export function localDateKey(time: Date = new Date()): string {
  const year = time.getFullYear();
  const month = String(time.getMonth() + 1).padStart(2, "0");
  const day = String(time.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Add active reading seconds for several (day, document) buckets at once. */
export async function addReadingTime(
  entries: Array<{ date: string; documentId: string; name: string; seconds: number }>,
): Promise<void> {
  if (!entries.length) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("readingTime", "readwrite");
    const store = tx.objectStore("readingTime");
    for (const entry of entries) {
      const key = `${entry.date}|${entry.documentId}`;
      const request = store.get(key);
      request.onsuccess = () => {
        const current = request.result as ReadingTimeRecord | undefined;
        store.put({
          key,
          date: entry.date,
          documentId: entry.documentId,
          name: entry.name || current?.name || "",
          seconds: (current?.seconds ?? 0) + entry.seconds,
          updatedAt: Date.now(),
        } satisfies ReadingTimeRecord);
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Reading time update aborted."));
  });
}

export async function listReadingTime(): Promise<ReadingTimeRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("readingTime", "readonly");
    const request = tx.objectStore("readingTime").getAll();
    tx.oncomplete = () => resolve(request.result as ReadingTimeRecord[]);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearReadingTime(): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("readingTime", "readwrite");
    tx.objectStore("readingTime").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
