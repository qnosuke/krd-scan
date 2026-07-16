// IndexedDB ラッパー。1レコード = 1回の測定（日時 + 7項目）。
// 値は文字列のまま保存する（"62.7" など。未計測は null）。

// 旧アプリ名のまま（変更すると既存の記録が読めなくなるため）
const DB_NAME = 'karadascan';
const DB_VERSION = 1;
const STORE = 'measurements';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('measuredAt', 'measuredAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = fn(store);
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    // error イベントなしで abort されるケース（明示的 abort や容量超過の一部）で
    // Promise が永久に pending にならないようにする
    t.onabort = () => reject(t.error ?? new DOMException('aborted', 'AbortError'));
  });
}

/** @param {object} record { measuredAt: ISO文字列, weight, bodyFat, ... } */
export async function addMeasurement(record) {
  const db = await openDB();
  return tx(db, 'readwrite', (store) => store.add(record));
}

/**
 * 複数レコードを1トランザクションで追加（CSVインポート用）。
 * 途中で失敗した場合はトランザクションごと abort され、部分書き込みは起きない。
 */
export async function addMeasurements(records) {
  const db = await openDB();
  return tx(db, 'readwrite', (store) => {
    for (const r of records) store.add(r);
  });
}

/** 新しい順で全件取得 */
export async function listMeasurements() {
  const db = await openDB();
  const records = await tx(db, 'readonly', (store) => store.getAll());
  return (records ?? []).sort((a, b) => (a.measuredAt < b.measuredAt ? 1 : -1));
}

export async function deleteMeasurement(id) {
  const db = await openDB();
  return tx(db, 'readwrite', (store) => store.delete(id));
}
