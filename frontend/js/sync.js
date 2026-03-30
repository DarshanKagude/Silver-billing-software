/* ── Background sync: push offline bills to FastAPI backend ──────────────── */
import { getPendingSyncItems, getBill, markBillSynced, removeSyncQueueItem } from "./db.js";

let _apiBase = localStorage.getItem("api_base") || "";

export function setApiBase(url) {
  _apiBase = url.replace(/\/$/, "");
  localStorage.setItem("api_base", _apiBase);
}

export function getApiBase() {
  return _apiBase;
}

export async function isOnline() {
  if (!navigator.onLine) return false;
  try {
    const res = await fetch(`${_apiBase}/`, { method: "GET", signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function syncPending(onProgress) {
  if (!await isOnline()) return { synced: 0, failed: 0 };
  const queue = await getPendingSyncItems();
  let synced = 0, failed = 0;

  for (const qi of queue) {
    const bill = await getBill(qi.localId);
    if (!bill) { await removeSyncQueueItem(qi.localId); continue; }

    try {
      const serverBill = {
        local_id: bill.id,
        customer_name: bill.customer_name || "Unknown",
        customer_mobile: bill.customer_mobile || "",
        customer_address: bill.customer_address || "",
        barcode_no: bill.barcode_no || "",
        bill_date: (bill.created_at || new Date().toISOString()).replace('T', ' ').substring(0, 19),
        items: (bill.items || []).map(i => ({
          name: i.item_name || "Item",
          barcode: i.barcode_no || "",
          weight: i.weight_g || 0,
          rate: i.rate_per_g || 0,
          making: i.making_charges || 0,
          discount: i.discount || 0,
          total: i.line_total || 0,
        })),
        subtotal: bill.subtotal || 0,
        tax_pct: bill.gst_percent || 0,
        tax_amount: bill.gst_amount || 0,
        total_discount: bill.total_discount || 0,
        old_jewellery_adjustment: bill.old_jewellery_adjustment || 0,
        grand_total: bill.grand_total || 0,
        received_amount: bill.received_amount || 0,
        balance_due: bill.balance_due || 0,
        payment_mode: "Cash",
        remarks: bill.notes || "",
      };

      const res = await fetch(`${_apiBase}/bills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serverBill),
      });

      if (res.ok) {
        const data = await res.json();
        await markBillSynced(qi.localId, data.id);
        synced++;
      } else if (res.status === 409) {
        // Already on server, mark synced
        await markBillSynced(qi.localId, null);
        synced++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }

    onProgress && onProgress({ synced, failed, total: queue.length });
  }

  return { synced, failed };
}

export async function saveBillDirect(bill) {
  if (!bill.id) bill.id = `bill_${Date.now()}`;
  if (!bill.created_at) bill.created_at = new Date().toISOString();

  const serverBill = {
    local_id: bill.id,
    customer_name: bill.customer_name || "Unknown",
    customer_mobile: bill.customer_mobile || "",
    customer_address: bill.customer_address || "",
    barcode_no: bill.barcode_no || "",
    bill_date: bill.created_at.replace('T', ' ').substring(0, 19),
    items: (bill.items || []).map(i => ({
      name: i.item_name || "Item",
      barcode: i.barcode_no || "",
      weight: i.weight_g || 0,
      rate: i.rate_per_g || 0,
      making: i.making_charges || 0,
      discount: i.discount || 0,
      total: i.line_total || 0,
    })),
    subtotal: bill.subtotal || 0,
    tax_pct: bill.gst_percent || 0,
    tax_amount: bill.gst_amount || 0,
    total_discount: bill.total_discount || 0,
    old_jewellery_adjustment: bill.old_jewellery_adjustment || 0,
    grand_total: bill.grand_total || 0,
    received_amount: bill.received_amount || 0,
    balance_due: bill.balance_due || 0,
    payment_mode: "Cash",
    remarks: bill.notes || "",
  };

  const url = _apiBase ? `${_apiBase}/bills` : "/bills";
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serverBill),
      // Short timeout to prevent long hangs on poor connection
      signal: AbortSignal.timeout(5000)
    });

    if (res.ok) {
      const data = await res.json();
      bill.synced = true;
      bill.server_id = data.id;
      return bill;
    }
  } catch (err) {
    console.warn("API save failed, saving locally for sync later:", err);
  }

  // If we reach here, it failed (offline or server error)
  bill.synced = false;
  
  // Register for Background Sync if available
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register("sync-bills");
      console.log("[Sync] Background sync registered");
    } catch (e) {
      console.error("[Sync] Registration failed", e);
    }
  }

  return bill;
}

export async function deleteBillFromServer(id) {
  const url = _apiBase ? `${_apiBase}/bills/${id}` : `/bills/${id}`;
  try {
    const res = await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch (err) {
    console.error("Server delete failed:", err);
    return false;
  }
}

export async function fetchBillsFromServer(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${_apiBase}/bills${qs ? "?" + qs : ""}`);
  if (!res.ok) throw new Error("Server error");
  return res.json();
}
