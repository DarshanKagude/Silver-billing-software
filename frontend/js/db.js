/* ── IndexedDB wrapper for Silver Billing ──────────────────────────────────
   Stores: bills, catalog_items, sync_queue
   ────────────────────────────────────────────────────────────────────────── */

const DB_NAME = "silver_billing";
const DB_VERSION = 1;

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains("bills")) {
        const bills = db.createObjectStore("bills", { keyPath: "id" });
        bills.createIndex("created_at", "created_at");
        bills.createIndex("customer_name", "customer_name");
      }

      if (!db.objectStoreNames.contains("catalog_items")) {
        const items = db.createObjectStore("catalog_items", { keyPath: "id" });
        items.createIndex("name", "name");
      }

      if (!db.objectStoreNames.contains("sync_queue")) {
        const sq = db.createObjectStore("sync_queue", { keyPath: "localId" });
        sq.createIndex("status", "status");
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(storeName, mode = "readonly") {
  return _db.transaction(storeName, mode).objectStore(storeName);
}

function wrap(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

// ── Bills ────────────────────────────────────────────────────────────────────

export async function saveBill(bill) {
  await openDB();
  if (!bill.id) bill.id = `bill_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  if (!bill.created_at) bill.created_at = new Date().toISOString();
  await wrap(tx("bills", "readwrite").put(bill));
  // Add to sync queue if not already synced
  if (!bill.synced) {
    await addToSyncQueue(bill.id);
  }
  return bill;
}

export async function getBill(id) {
  await openDB();
  return wrap(tx("bills").get(id));
}

export async function getAllBills() {
  await openDB();
  return wrap(tx("bills").getAll());
}

export async function deleteBill(id) {
  await openDB();
  await wrap(tx("bills", "readwrite").delete(id));
  await wrap(tx("sync_queue", "readwrite").delete(id));
}

export async function markBillSynced(localId, serverId) {
  await openDB();
  const bill = await getBill(localId);
  if (bill) {
    bill.synced = true;
    bill.server_id = serverId;
    await wrap(tx("bills", "readwrite").put(bill));
  }
  await wrap(tx("sync_queue", "readwrite").delete(localId));
}

// ── Catalog Items ─────────────────────────────────────────────────────────────

export async function getCatalogItems() {
  await openDB();
  return wrap(tx("catalog_items").getAll());
}

export async function saveCatalogItem(item) {
  await openDB();
  if (!item.id) item.id = `item_${Date.now()}`;
  await wrap(tx("catalog_items", "readwrite").put(item));
  return item;
}

export async function deleteCatalogItem(id) {
  await openDB();
  return wrap(tx("catalog_items", "readwrite").delete(id));
}

// ── Sync Queue ──────────────────────────────────────────────────────────────

export async function addToSyncQueue(localId) {
  await openDB();
  await wrap(tx("sync_queue", "readwrite").put({ localId, status: "pending", addedAt: new Date().toISOString() }));
}

export async function getPendingSyncItems() {
  await openDB();
  const all = await wrap(tx("sync_queue").getAll());
  return all.filter((i) => i.status === "pending");
}

export async function removeSyncQueueItem(localId) {
  await openDB();
  return wrap(tx("sync_queue", "readwrite").delete(localId));
}
