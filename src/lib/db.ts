// IndexedDB 小封装：账本（事件流水）+ 发件箱 + 冲突队列 + 元数据
import type { ConflictRecord, LedgerEvent, MigrationSummary, OutboxItem } from "./types";

const DB_NAME = "lighting-cue-desk";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("events")) {
        const s = db.createObjectStore("events", { keyPath: "id" });
        s.createIndex("entity", "entity", { unique: false });
        s.createIndex("entityId", "entityId", { unique: false });
        s.createIndex("batchId", "batchId", { unique: false });
      }
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("conflicts")) {
        const s = db.createObjectStore("conflicts", { keyPath: "id" });
        s.createIndex("status", "status", { unique: false });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function getAll<T>(store: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function get<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function put(store: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function del(store: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    Promise.resolve(fn(t))
      .then((r) => {
        t.oncomplete = () => resolve(r);
        t.onerror = () => reject(t.error);
      })
      .catch(reject);
  });
}

// ---- 便捷访问 ----

export const eventsStore = {
  all: () => getAll<LedgerEvent>("events"),
  put: (e: LedgerEvent) => put("events", e),
  has: (id: string) => get<LedgerEvent>("events", id),
};

export const outboxStore = {
  all: () => getAll<OutboxItem>("outbox"),
  get: (id: string) => get<OutboxItem>("outbox", id),
  put: (item: OutboxItem) => put("outbox", item),
  del: (id: string) => del("outbox", id),
};

export const conflictsStore = {
  all: () => getAll<ConflictRecord>("conflicts"),
  put: (c: ConflictRecord) => put("conflicts", c),
};

export interface MetaMap {
  migrated?: "v1";
  migration?: MigrationSummary;
}

export async function getMeta(): Promise<MetaMap> {
  const rows = await getAll<{ key: string; value: unknown }>("meta");
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.key] = r.value;
  return out as MetaMap;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await put("meta", { key, value });
}
