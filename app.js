/* ═══════════════════════════════════════════════════════════════════════════
   SILVER BILLING — Unified Application Script
   Everything in one file: DB, Sync, Router, and Page Logics.
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Shared UI Style Components ──────────────────────────────────────────────
const S_CARD = `background:rgba(26,26,26,0.85);border:1px solid rgba(201,168,76,0.18);border-radius:18px;box-shadow:0 4px 30px rgba(0,0,0,0.6),0 1px 0 rgba(201,168,76,0.08) inset;backdrop-filter:blur(12px);padding:24px;`;
const S_TITLE = `font-family:'Cinzel',serif;font-size:14px;color:#c0c0c0;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:20px;display:flex;align-items:center;gap:8px;`;
const S_BAR = `display:inline-block;width:3px;height:16px;background:linear-gradient(180deg,#e5e4e2,#a9a9a9);border-radius:2px;flex-shrink:0;`;
const S_BTN_PRI = `display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 22px;border-radius:8px;border:none;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.04em;cursor:pointer;transition:0.2s ease;background:linear-gradient(135deg,#c0c0c0,#e5e4e2);color:#080808;box-shadow:0 4px 15px rgba(201,168,76,0.25);`;
const S_BTN_GHOST = `display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 22px;border-radius:8px;border:1px solid rgba(201,168,76,0.18);font-family:'Inter',sans-serif;font-size:13px;font-weight:600;letter-spacing:0.04em;cursor:pointer;transition:0.2s ease;background:transparent;color:#9e907a;`;
const S_INP = `background:rgba(255,255,255,0.035);border:1px solid rgba(201,168,76,0.18);border-radius:8px;color:#f0e6d3;font-family:'Inter',sans-serif;font-size:14px;padding:10px 14px;outline:none;width:100%;transition:0.2s ease;`;

// ── 1. Database (db.js) ─────────────────────────────────────────────────────
const DB_NAME = "silver_billing";
const DB_VERSION = 1;
let _db = null;

function openDB() {
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

function tx(storeName, mode = "readonly") { return _db.transaction(storeName, mode).objectStore(storeName); }
function wrap(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }

async function saveBillToDB(bill) {
  await openDB();
  if (!bill.id) bill.id = `bill_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  bill.created_at = bill.created_at || new Date().toISOString();
  await wrap(tx("bills", "readwrite").put(bill));
  if (!bill.synced) await addToSyncQueue(bill.id);
  return bill;
}
async function getBill(id) { await openDB(); return wrap(tx("bills").get(id)); }
async function getAllBills() { await openDB(); return wrap(tx("bills").getAll()); }
async function deleteBill(id) {
  await openDB();
  await wrap(tx("bills", "readwrite").delete(id));
  await wrap(tx("sync_queue", "readwrite").delete(id));
}
async function markBillSynced(localId, serverId) {
  await openDB();
  const bill = await getBill(localId);
  if (bill) { bill.synced = true; bill.server_id = serverId; await wrap(tx("bills", "readwrite").put(bill)); }
  await wrap(tx("sync_queue", "readwrite").delete(localId));
}
async function getCatalogItems() { await openDB(); return wrap(tx("catalog_items").getAll()); }
async function saveCatalogItem(item) {
  await openDB();
  if (!item.id) item.id = `item_${Date.now()}`;
  await wrap(tx("catalog_items", "readwrite").put(item));
  return item;
}
async function deleteCatalogItem(id) { await openDB(); return wrap(tx("catalog_items", "readwrite").delete(id)); }
async function addToSyncQueue(localId) { await openDB(); await wrap(tx("sync_queue", "readwrite").put({ localId, status: "pending", addedAt: new Date().toISOString() })); }
async function getPendingSyncItems() { await openDB(); const all = await wrap(tx("sync_queue").getAll()); return all.filter(i => i.status === "pending"); }
async function removeSyncQueueItem(localId) { await openDB(); return wrap(tx("sync_queue", "readwrite").delete(localId)); }

// ── 2. Sync (sync.js) ───────────────────────────────────────────────────────
let _apiBase = localStorage.getItem("api_base") || "";
function setApiBase(url) { _apiBase = url.replace(/\/$/, ""); localStorage.setItem("api_base", _apiBase); }
function getApiBase() { return _apiBase; }

async function isOnline() {
  if (!navigator.onLine) return false;
  try {
    const res = await fetch(`${_apiBase}/`, { method: "GET", signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
}

async function syncPending(onProgress) {
  if (!await isOnline()) return { synced: 0, failed: 0 };
  const queue = await getPendingSyncItems();
  let synced = 0, failed = 0;
  for (const qi of queue) {
    const bill = await getBill(qi.localId);
    if (!bill) { await removeSyncQueueItem(qi.localId); continue; }
    try {
      const serverBill = {
        local_id: bill.id, customer_name: bill.customer_name || "Unknown", customer_mobile: bill.customer_mobile || "", customer_address: bill.customer_address || "", barcode_no: bill.barcode_no || "",
        bill_date: (bill.created_at || new Date().toISOString()).replace('T', ' ').substring(0, 19),
        items: (bill.items || []).map(i => ({ name: i.item_name || "Item", barcode: i.barcode_no || "", weight: i.weight_g || 0, rate: i.rate_per_g || 0, making: i.making_charges || 0, discount: i.discount || 0, total: i.line_total || 0 })),
        subtotal: bill.subtotal || 0, tax_pct: bill.gst_percent || 0, tax_amount: bill.gst_amount || 0, total_discount: 0, old_jewellery_adjustment: bill.old_jewellery_adjustment || 0, grand_total: bill.grand_total || 0, received_amount: bill.received_amount || 0, balance_due: bill.balance || 0, payment_mode: "Cash", remarks: ""
      };
      const res = await fetch(`${_apiBase}/bills`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(serverBill) });
      if (res.ok) { const data = await res.json(); await markBillSynced(qi.localId, data.id); synced++; }
      else if (res.status === 409) { await markBillSynced(qi.localId, null); synced++; }
      else failed++;
    } catch { failed++; }
    onProgress && onProgress({ synced, failed, total: queue.length });
  }
  return { synced, failed };
}

async function saveBillDirect(bill) {
  if (!bill.id) bill.id = `bill_${Date.now()}`;
  bill.created_at = bill.created_at || new Date().toISOString();
  const url = _apiBase ? `${_apiBase}/bills` : "/bills";
  try {
    const serverBill = {
      local_id: bill.id, customer_name: bill.customer_name, customer_mobile: bill.customer_mobile, customer_address: bill.customer_address, barcode_no: bill.barcode_no,
      bill_date: bill.created_at.replace('T', ' ').substring(0, 19),
      items: bill.items.map(i => ({ name: i.item_name, barcode: "", weight: i.weight_g, rate: i.rate_per_g, making: i.making_charges, discount: i.discount, total: i.line_total })),
      subtotal: bill.subtotal, tax_pct: bill.gst_percent, tax_amount: bill.gst_amount, total_discount: 0, old_jewellery_adjustment: bill.old_jewellery_adjustment, grand_total: bill.grand_total, received_amount: bill.received_amount, balance_due: bill.balance, payment_mode: "Cash", remarks: ""
    };
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(serverBill), signal: AbortSignal.timeout(5000) });
    if (res.ok) { const data = await res.json(); bill.synced = true; bill.server_id = data.id; return bill; }
  } catch (err) { console.warn("Sync failed:", err); }
  bill.synced = false;
  return bill;
}

async function deleteBillFromServer(id) { 
  const url = _apiBase ? `${_apiBase}/bills/${id}` : `/bills/${id}`;
  try { const res = await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(5000) }); return res.ok; } catch { return false; }
}

// ── 3. Application Kernel ───────────────────────────────────────────────────
function toast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  const styles = { success: { bg: "rgba(10,25,18,0.95)", color: "#5cbe8a" }, error: { bg: "rgba(25,10,10,0.95)", color: "#e05c5c" }, info: { bg: "rgba(20,18,10,0.95)", color: "#c0c0c0" } };
  const s = styles[type] || styles.info;
  el.style.cssText = `padding:12px 18px;border-radius:12px;font-size:14px;backdrop-filter:blur(16px);display:flex;align-items:center;gap:10px;min-width:220px;background:${s.bg};color:${s.color};animation:slideUp 0.3s ease, fadeOut 0.4s ease 2.6s forwards;border:1px solid rgba(255,255,255,0.05);`;
  el.innerHTML = `<span>◈</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

let _lastOnline = null;
async function updateConnBadge() {
  const badge = document.getElementById("conn-badge");
  if (!badge) return;
  const online = await isOnline();
  if (online === _lastOnline) return;
  _lastOnline = online;
  badge.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:${online ? "#5cbe8a" : "#e05c5c"};display:inline-block;"></span> ${online ? "Online" : "Offline"}`;
  if (online) syncPending().then(r => r.synced > 0 && toast(`Synced ${r.synced} bills!`, "success"));
}
setInterval(updateConnBadge, 10000);

const routes = { billing: { label: "Billing", init: initBillingPage }, reports: { label: "Reports", init: initReportsPage }, catalog: { label: "Catalog", init: initCatalogPage }, settings: { label: "Settings", init: initSettingsPage } };
const NAV_ICONS = {
  billing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="20"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  reports: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="20"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2m0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  catalog: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="20"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="20"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
};

function buildSidebar() {
  const sb = document.getElementById("sidebar");
  sb.innerHTML = `<div style="width:44px;height:44px;background:linear-gradient(135deg,#c0c0c0,#e5e4e2);border-radius:12px;display:flex;align-items:center;justify-content:center;font-family:'Cinzel',serif;font-weight:700;font-size:20px;color:#080808;margin-bottom:16px;">S</div>
    ${Object.entries(routes).map(([k,v]) => `<button class="nav-item" data-route="${k}" style="width:52px;height:52px;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;border:none;background:transparent;color:#5a5040;transition:0.2s;">${NAV_ICONS[k]}<span style="font-size:9px;text-transform:uppercase;">${v.label}</span></button>`).join("")}
    <div style="flex:1;"></div><span id="conn-badge" style="font-size:9px;color:#5a5040;"></span>`;
  sb.querySelectorAll(".nav-item").forEach(b => b.onclick = () => navigate(b.dataset.route));
}

function navigate(route) {
  location.hash = route; document.querySelectorAll(".nav-item").forEach(b => { b.style.background = b.dataset.route === route ? "rgba(201,168,76,0.14)" : "transparent"; b.style.color = b.dataset.route === route ? "#c0c0c0" : "#5a5040"; });
  routes[route].init(document.getElementById("app"));
}

// ── 4. Billing Page ─────────────────────────────────────────────────────────
let billingGstEnabled = false, billingGstRate = 3, currentModAdjustment = 0;
function initBillingPage(container) {
  container.innerHTML = `
    <div style="padding:28px 32px 0;"><div style="font-family:'Cinzel',serif;font-size:26px;background:linear-gradient(90deg,#e5e4e2,#ffffff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">New Bill</div></div>
    <div style="padding:24px 32px 40px;display:flex;flex-direction:column;gap:20px;">
      <div style="${S_CARD}"><div style="${S_TITLE}"><span style="${S_BAR}"></span>Customer</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
          <input id="cust-name" placeholder="Name" style="${S_INP}"/><input id="cust-mobile" placeholder="Mobile" style="${S_INP}"/><input id="barcode-no" placeholder="Bill No" style="${S_INP}"/>
          <textarea id="cust-address" placeholder="Address" style="${S_INP};grid-column:1/-1;"></textarea>
        </div>
      </div>
      <div style="${S_CARD}"><div style="${S_TITLE}"><span style="${S_BAR}"></span>Items</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr>${["Item","Weight","Rate","Making","Disc","Total",""].map(h=>`<th style="text-align:left;padding:8px;color:#5a5040;">${h}</th>`).join("")}</tr></thead><tbody id="items-body"></tbody></table>
        <button id="add-row-btn" style="${S_BTN_GHOST};margin-top:12px;">+ Add Item</button>
      </div>
      <div style="${S_CARD} shadow:none;"><div style="${S_TITLE}"><span style="${S_BAR}"></span>Old Jewellery</div>
        <div style="display:flex;gap:12px;"><input id="old-fine" type="number" step="0.001" placeholder="Fine Weight" style="${S_INP}"/><input id="old-rate" type="number" placeholder="Rate" style="${S_INP}"/><button id="apply-mod-btn" style="${S_BTN_PRI}">Apply</button></div>
        <div id="mod-summary" class="hidden" style="margin-top:8px;font-size:12px;color:#5cbe8a;">Adjustment: <span id="old-final-disp">₹0</span></div>
      </div>
      <div style="${S_CARD}"><div style="${S_TITLE}"><span style="${S_BAR}"></span>Summary</div>
        <div style="display:flex;gap:24px;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;"><input id="daily-rate-all" type="number" placeholder="Set Daily Rate" style="${S_INP};margin-bottom:12px;"/>
            <div id="gst-toggle" style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#9e907a;font-size:13px;"><div style="width:36px;height:20px;background:#242424;border-radius:10px;position:relative;"><span class="thumb" style="position:absolute;top:2px;left:2px;width:16px;height:16px;background:#5a5040;border-radius:50%;transition:0.2s;"></span></div> GST (3%)</div>
          </div>
          <div style="width:300px;background:rgba(201,168,76,0.06);padding:20px;border-radius:12px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;color:#9e907a;"><span>Subtotal</span><span id="sub-disp">₹0.00</span></div>
            <div id="gst-row" class="hidden" style="display:flex;justify-content:space-between;margin-bottom:8px;color:#9e907a;"><span>GST</span><span id="gst-disp">₹0.00</span></div>
            <div style="display:flex;justify-content:space-between;margin:12px 0;font-size:20px;font-weight:700;color:#fff;"><span>Total</span><span id="total-disp">₹0.00</span></div>
            <div style="display:flex;justify-content:space-between;margin-top:12px;align-items:center;"><span>Paid</span><input id="paid-amt" type="number" style="${S_INP};width:100px;text-align:right;"/></div>
            <div style="display:flex;justify-content:space-between;margin:12px 0;font-weight:600;color:#e0a03c;"><span>Balance</span><span id="bal-disp">₹0.00</span></div>
            <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">
              <button id="save-btn" style="${S_BTN_PRI};width:100%;">Save Bill</button>
              <div style="display:flex;gap:8px;">
                <button id="print-btn" class="hidden" style="${S_BTN_GHOST};flex:1;">Print</button>
                <button id="clear-btn" style="${S_BTN_GHOST};flex:1;">Clear</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div><datalist id="cat-list"></datalist>`;
  
  billingGstEnabled = false; currentModAdjustment = 0;
  loadCatalogSuggestionsForBilling(container);
  const recalc = () => {
    const rows = [...container.querySelectorAll("#items-body tr")];
    const sub = rows.reduce((a,r) => a + (parseFloat(r.querySelector(".i-t").value)||0), 0);
    const gst = billingGstEnabled ? sub * 0.03 : 0;
    const grand = sub + gst - currentModAdjustment;
    const paid = parseFloat(container.querySelector("#paid-amt").value)||0;
    container.querySelector("#sub-disp").textContent = `₹${sub.toFixed(2)}`;
    container.querySelector("#gst-disp").textContent = `₹${gst.toFixed(2)}`;
    container.querySelector("#total-disp").textContent = `₹${grand.toFixed(2)}`;
    container.querySelector("#bal-disp").textContent = `₹${(grand - paid).toFixed(2)}`;
  };
  const addRow = () => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input class="i-n" list="cat-list" style="${S_INP}"/></td><td><input class="i-w" type="number" step="0.001" style="${S_INP}"/></td><td><input class="i-r" type="number" style="${S_INP}"/></td><td><input class="i-m" type="number" style="${S_INP}"/></td><td><input class="i-d" type="number" style="${S_INP}"/></td><td><input class="i-t" readonly style="${S_INP};background:transparent;border:0"/></td><td><button class="del">✕</button></td>`;
    tr.querySelectorAll("input").forEach(i => i.oninput = () => {
      const w=parseFloat(tr.querySelector(".i-w").value)||0, r=parseFloat(tr.querySelector(".i-r").value)||0, m=parseFloat(tr.querySelector(".i-m").value)||0, d=parseFloat(tr.querySelector(".i-d").value)||0;
      tr.querySelector(".i-t").value = (w*r + m - d).toFixed(2); recalc();
    });
    tr.querySelector(".del").onclick = () => { tr.remove(); recalc(); };
    container.querySelector("#items-body").appendChild(tr);
  };
  container.querySelector("#add-row-btn").onclick = addRow;
  container.querySelector("#apply-mod-btn").onclick = () => {
    currentModAdjustment = (parseFloat(container.querySelector("#old-fine").value)||0) * (parseFloat(container.querySelector("#old-rate").value)||0);
    container.querySelector("#old-final-disp").textContent = `₹${currentModAdjustment.toFixed(2)}`;
    container.querySelector("#mod-summary").classList.remove("hidden"); recalc();
  };
  container.querySelector("#gst-toggle").onclick = () => {
    billingGstEnabled = !billingGstEnabled; container.querySelector("#gst-toggle .thumb").style.transform = billingGstEnabled ? "translateX(16px)" : "translateX(0)";
    container.querySelector("#gst-row").classList.toggle("hidden", !billingGstEnabled); recalc();
  };
  container.querySelector("#paid-amt").oninput = recalc;
  container.querySelector("#save-btn").onclick = async () => {
    const rows = [...container.querySelectorAll("#items-body tr")]; if(!rows.length) return toast("Empty bill", "error");
    const bill = {
      customer_name: container.querySelector("#cust-name").value, customer_mobile: container.querySelector("#cust-mobile").value, customer_address: container.querySelector("#cust-address").value, barcode_no: container.querySelector("#barcode-no").value,
      subtotal: parseFloat(container.querySelector("#sub-disp").textContent.replace("₹","")),
      gst_percent: billingGstEnabled ? 3 : 0, gst_amount: parseFloat(container.querySelector("#gst-disp").textContent.replace("₹","")),
      old_fine_weight: parseFloat(container.querySelector("#old-fine").value)||0, old_metal_rate: parseFloat(container.querySelector("#old-rate").value)||0, old_jewellery_adjustment: currentModAdjustment,
      grand_total: parseFloat(container.querySelector("#total-disp").textContent.replace("₹","")), received_amount: parseFloat(container.querySelector("#paid-amt").value)||0, balance: parseFloat(container.querySelector("#bal-disp").textContent.replace("₹","")),
      items: rows.map(r => ({ item_name: r.querySelector(".i-n").value, weight_g: parseFloat(r.querySelector(".i-w").value)||0, rate_per_g: parseFloat(r.querySelector(".i-r").value)||0, making_charges: parseFloat(r.querySelector(".i-m").value)||0, discount: parseFloat(r.querySelector(".i-d").value)||0, line_total: parseFloat(r.querySelector(".i-t").value)||0 }))
    };
    const saved = await saveBillDirect(bill); await saveBillToDB(saved); toast("Bill Saved!");
    container.querySelector("#print-btn").classList.remove("hidden");
    container.querySelector("#print-btn").onclick = () => printUnifiedInvoice(saved);
  };
  container.querySelector("#clear-btn").onclick = () => initBillingPage(container);
  addRow();
}

async function loadCatalogSuggestionsForBilling(container) {
  const items = await getCatalogItems(); document.getElementById("cat-list").innerHTML = items.map(i => `<option value="${i.name}">`).join("");
}

function printUnifiedInvoice(bill) {
  const s = JSON.parse(localStorage.getItem("shop_settings") || "{}");
  const win = window.open("", "PRINT", "width=900,height=900");
  const dateStr = new Date(bill.created_at).toLocaleDateString();
  const timeStr = new Date(bill.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  win.document.write(`
    <html>
      <head>
        <title>Invoice - ${bill.customer_name}</title>
        <style>
          @page { size: auto; margin: 0; }
          body { font-family: 'Inter', sans-serif; padding: 40px; color: #1a1a1a; margin: 0; }
          .header { display: flex; justify-content: space-between; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
          .shop-info h1 { margin: 0; font-family: 'Cinzel', serif; font-size: 28px; letter-spacing: 1px; }
          .shop-info p { margin: 5px 0 0; color: #666; font-size: 14px; }
          .inv-title { text-align: right; }
          .inv-title h2 { margin: 0; font-size: 24px; color: #333; }
          .inv-title p { margin: 5px 0 0; font-weight: 600; }
          
          .details { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 30px; line-height: 1.6; }
          .cust-info h4 { margin: 0 0 10px; text-transform: uppercase; font-size: 11px; color: #888; letter-spacing: 1px; }
          .cust-info p { margin: 0; font-size: 15px; }

          table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
          th { background: #f8f8f8; padding: 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #666; border-bottom: 1px solid #eee; }
          td { padding: 12px; border-bottom: 1px solid #eee; font-size: 14px; }
          
          .summary { display: flex; justify-content: flex-end; }
          .summary-table { width: 300px; }
          .summary-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
          .summary-row.total { border-top: 2px solid #333; margin-top: 10px; padding-top: 15px; font-weight: 800; font-size: 18px; }
          .summary-row.balance { color: #e0a03c; font-weight: 700; border-top: 1px dashed #ddd; margin-top: 5px; padding-top: 10px; }
          
          .footer { margin-top: 60px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 20px; }
        </style>
        <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700&family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
      </head>
      <body>
        <div class="header">
          <div class="shop-info">
            <h1>${s.shop_name || "SILVER JEWELLRY SHOP"}</h1>
            <p>${s.address || "Your Shop Address Here"}</p>
          </div>
          <div class="inv-title">
            <h2>TAX INVOICE</h2>
            <p># ${bill.barcode_no || "N/A"}</p>
            <p style="font-size:12px; color:#666; font-weight:400;">Date: ${dateStr} ${timeStr}</p>
          </div>
        </div>

        <div class="details">
          <div class="cust-info">
            <h4>Billed To</h4>
            <p><strong>${bill.customer_name}</strong></p>
            <p>${bill.customer_mobile || "No Mobile Provided"}</p>
            <p style="white-space: pre-wrap;">${bill.customer_address || ""}</p>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Item Description</th>
              <th>Weight (g)</th>
              <th>Rate (₹)</th>
              <th>Making (₹)</th>
              <th>Disc (₹)</th>
              <th style="text-align:right;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${bill.items.map(i => `
              <tr>
                <td><strong>${i.item_name}</strong></td>
                <td>${i.weight_g.toFixed(3)}</td>
                <td>${i.rate_per_g.toFixed(0)}</td>
                <td>${i.making_charges.toFixed(0)}</td>
                <td>${i.discount.toFixed(0)}</td>
                <td style="text-align:right;">₹${i.line_total.toFixed(2)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <div class="summary">
          <div class="summary-table">
            <div class="summary-row"><span>Items Subtotal</span><span>₹${bill.subtotal.toFixed(2)}</span></div>
            ${bill.gst_percent > 0 ? `<div class="summary-row"><span>GST (${bill.gst_percent}%)</span><span>₹${bill.gst_amount.toFixed(2)}</span></div>` : ""}
            ${bill.old_jewellery_adjustment > 0 ? `<div class="summary-row" style="color:#e05c5c;"><span>Buy-Back Adjustment</span><span>- ₹${bill.old_jewellery_adjustment.toFixed(2)}</span></div>` : ""}
            <div class="summary-row total"><span>Grand Total</span><span>₹${bill.grand_total.toFixed(2)}</span></div>
            <div class="summary-row"><span>Amount Received</span><span>₹${bill.received_amount.toFixed(2)}</span></div>
            <div class="summary-row balance"><span>Balance Remaining</span><span>₹${bill.balance.toFixed(2)}</span></div>
          </div>
        </div>

        <div class="footer">
          <p>Thank you for your business! Items once sold are subject to terms & conditions.</p>
          <p style="font-size:10px;">Computer Generated Invoice - No Signature Required</p>
        </div>

        <script>
          window.print();
          window.onafterprint = () => window.close();
        </script>
      </body>
    </html>
  `);
  win.document.close();
}

// ── 5. Catalog Page ─────────────────────────────────────────────────────────
function initCatalogPage(container) {
  container.innerHTML = `
    <div style="padding:28px 32px 0;"><div style="font-family:'Cinzel',serif;font-size:26px;background:linear-gradient(90deg,#e5e4e2,#ffffff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">Catalog</div></div>
    <div style="padding:24px 32px;"><div style="${S_CARD}"><div style="${S_TITLE}">Add Product</div>
      <div style="display:flex;gap:12px;"><input id="n-name" placeholder="Name" style="${S_INP}"/><input id="n-rate" type="number" placeholder="Rate" style="${S_INP}"/><input id="n-make" type="number" placeholder="Making" style="${S_INP}"/><button id="n-btn" style="${S_BTN_PRI}">Add</button></div>
    </div><div style="${S_CARD};margin-top:20px;padding:0;"><table style="width:100%;font-size:13px;"><thead style="background:rgba(201,168,76,0.05);"><tr><th style="padding:12px;text-align:left;">Item</th><th style="padding:12px;text-align:left;">Rate</th><th style="padding:12px;text-align:left;">Making</th><th style="padding:12px;"></th></tr></thead><tbody id="c-body"></tbody></table></div></div>`;
  const load = async () => { const items = await getCatalogItems(); container.querySelector("#c-body").innerHTML = items.map(i => `<tr style="border-bottom:1px solid rgba(201,168,76,0.1);"><td style="padding:12px;">${i.name}</td><td style="padding:12px;">₹${i.default_rate}</td><td style="padding:12px;">₹${i.making_charges}</td><td style="padding:12px;text-align:right;"><button class="del-cat" data-id="${i.id}" style="border:0;background:transparent;color:#e05c5c;cursor:pointer;">✕</button></td></tr>`).join("");
    container.querySelectorAll(".del-cat").forEach(b => b.onclick = async () => { if(confirm("Del?")) { await deleteCatalogItem(b.dataset.id); load(); } });
  };
  container.querySelector("#n-btn").onclick = async () => { const n=container.querySelector("#n-name").value; if(!n) return; await saveCatalogItem({ name: n, default_rate: parseFloat(container.querySelector("#n-rate").value)||0, making_charges: parseFloat(container.querySelector("#n-make").value)||0 }); container.querySelector("#n-name").value=""; load(); };
  load();
}

// ── 6. Reports Page ─────────────────────────────────────────────────────────
function initReportsPage(container) {
  container.innerHTML = `
    <div style="padding:28px 32px 0;"><div style="font-family:'Cinzel',serif;font-size:26px;background:linear-gradient(90deg,#e5e4e2,#ffffff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">Reports</div></div>
    <div style="padding:24px 32px;"><div id="r-stats" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px;margin-bottom:24px;"></div>
    <div style="${S_CARD};padding:16px;margin-bottom:24px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
      <div style="flex:2;min-width:200px;position:relative;"><input id="r-search" placeholder="Search customer name..." style="${S_INP}"/></div>
      <div style="flex:1;min-width:150px;"><input id="r-date" type="date" style="${S_INP}"/></div>
      <button id="r-clear" style="${S_BTN_GHOST};padding:10px 20px;">Reset</button>
    </div>
    <div style="${S_CARD};padding:0;overflow:hidden;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:rgba(201,168,76,0.03);border-bottom:1px solid rgba(201,168,76,0.1);"><th style="padding:16px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#9e907a;">Date</th><th style="padding:16px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#9e907a;">Customer</th><th style="padding:16px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#9e907a;">Old Wt</th><th style="padding:16px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#9e907a;">Total</th><th style="padding:16px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#9e907a;">Paid</th><th style="padding:16px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#9e907a;">Balance</th><th style="padding:16px 12px;"></th></tr></thead><tbody id="r-body"></tbody></table></div></div>`;
  const render = (bills) => {
    const today = new Date().toDateString(), now=new Date(), mon=now.getMonth(), yr=now.getFullYear();
    const tInc = bills.filter(b=>new Date(b.created_at).toDateString()===today).reduce((a,b)=>a+(b.grand_total||0),0);
    const mInc = bills.filter(b=>{const d=new Date(b.created_at); return d.getMonth()===mon && d.getFullYear()===yr}).reduce((a,b)=>a+(b.grand_total||0),0);
    const totOld = bills.reduce((a,b)=>a+(parseFloat(b.old_jewellery_adjustment)||0),0), totBal = bills.reduce((a,b)=>a+(parseFloat(b.balance)||0),0);
    
    container.querySelector("#r-stats").innerHTML = [
      { label: "Today Income", val: tInc, col: "#5cbe8a" },
      { label: "Monthly Income", val: mInc, col: "#c0c0c0" },
      { label: "Old Metal Adj", val: totOld, col: "#e05c5c" },
      { label: "Total Balance", val: totBal, col: "#e0a03c" }
    ].map(s => `<div style="${S_CARD};padding:20px;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:150px;">
      <span style="font-size:10px;color:#9e907a;text-transform:uppercase;letter-spacing:0.05em;">${s.label}</span>
      <strong style="font-size:20px;color:${s.col};">₹${s.val.toLocaleString('en-IN', {maximumFractionDigits:0})}</strong>
    </div>`).join("");

    container.querySelector("#r-body").innerHTML = bills.map(b => `<tr style="border-bottom:1px solid rgba(201,168,76,0.06);transition:background 0.2s;">
      <td style="padding:14px 12px;color:#9e907a;">${new Date(b.created_at).toLocaleDateString()}</td>
      <td style="padding:14px 12px;"><strong>${b.customer_name}</strong></td>
      <td style="padding:14px 12px;color:#e05c5c;">${(b.old_fine_weight||0).toFixed(3)}g</td>
      <td style="padding:14px 12px;font-weight:600;color:#c0c0c0;">₹${(b.grand_total||0).toFixed(0)}</td>
      <td style="padding:14px 12px;font-weight:600;color:#5cbe8a;">₹${(b.received_amount||0).toFixed(0)}</td>
      <td style="padding:14px 12px;font-weight:600;color:#e0a03c;">₹${(b.balance||0).toFixed(0)}</td>
      <td style="padding:14px 12px;text-align:right;"><button class="del-bill" data-id="${b.id}" style="border:0;background:transparent;cursor:pointer;color:#5a5040;padding:6px;">✕</button></td>
    </tr>`).join("");
    container.querySelectorAll(".del-bill").forEach(b => b.onclick = async () => { if(confirm("Delete this bill permanently?")) { await deleteBill(b.dataset.id); if(await isOnline()) await deleteBillFromServer(b.dataset.id); initReportsPage(container); } });
  };
  (async () => { let all = await getAllBills(); render(all); 
    container.querySelector("#r-search").oninput = container.querySelector("#r-date").onchange = () => {
      const q = container.querySelector("#r-search").value.toLowerCase(), d = container.querySelector("#r-date").value;
      render(all.filter(b => b.customer_name.toLowerCase().includes(q) && (!d || new Date(b.created_at).toISOString().startsWith(d))));
    };
    container.querySelector("#r-clear").onclick = () => { container.querySelector("#r-search").value=""; container.querySelector("#r-date").value=""; render(all); };
  })();
}

// ── 7. Settings Page ────────────────────────────────────────────────────────
function initSettingsPage(container) {
  const s = JSON.parse(localStorage.getItem("shop_settings") || "{}");
  container.innerHTML = `<div style="padding:28px 32px 0;"><div style="font-family:'Cinzel',serif;font-size:26px;background:linear-gradient(90deg,#e5e4e2,#ffffff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">Settings</div></div>
    <div style="padding:24px 32px;display:flex;flex-direction:column;gap:20px;">
      <div style="${S_CARD}">Shop: <input id="s-name" value="${s.shop_name||""}" style="${S_INP}"/> Addr: <input id="s-addr" value="${s.address||""}" style="${S_INP}"/> <button id="s-btn" style="${S_BTN_PRI};margin-top:12px;">Save</button></div>
    </div>`;
  container.querySelector("#s-btn").onclick = () => { localStorage.setItem("shop_settings", JSON.stringify({ shop_name: document.getElementById("s-name").value, address: document.getElementById("s-addr").value })); toast("Saved!"); };
}

// ── Final Boot ──────────────────────────────────────────────────────────────
window.onload = () => { buildSidebar(); navigate("billing"); updateConnBadge(); };
window.onhashchange = () => navigate(location.hash.replace("#",""));
