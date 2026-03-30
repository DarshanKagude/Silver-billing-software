/* ── Reports Page ────────────────────────────────────────────────────────── */
import { getAllBills, deleteBill, saveBill } from "./db.js";
import { toast } from "./app.js";
import { deleteBillFromServer, isOnline, fetchBillsFromServer } from "./sync.js";

export function initReportsPage(container) {
  container.innerHTML = reportsHTML();
  loadBills(container);
  bindReportEvents(container);
}

function reportsHTML() {
  return `
<div class="page-header">
  <div>
    <div class="page-title">Reports</div>
    <div class="page-subtitle">View, search and manage all billing records</div>
  </div>
</div>

<div class="page-body">
  <!-- Stats -->
  <div class="stats-grid" id="stats-grid">
    <div class="stat-card">
      <div class="stat-icon">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
      </div>
      <div class="stat-value" id="stat-total-bills">—</div>
      <div class="stat-label">Total Bills</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      </div>
      <div class="stat-value" id="stat-revenue">—</div>
      <div class="stat-label">Total Revenue</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
      </div>
      <div class="stat-value" id="stat-today">—</div>
      <div class="stat-label">Today's Revenue</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      </div>
      <div class="stat-value" id="stat-balance">—</div>
      <div class="stat-label" style="color:var(--warning);">Total Balance</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="color:#e05c5c;">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"/></svg>
      </div>
      <div class="stat-value" id="stat-mod">—</div>
      <div class="stat-label">Total Mod</div>
    </div>
  </div>

  <!-- Filters -->
  <div class="card" style="padding:16px 20px;">
    <div class="flex gap-12" style="flex-wrap:wrap; align-items:center;">
      <div class="search-bar" style="flex:1; min-width:200px;">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <input type="text" id="search-input" placeholder="Search by customer name…" />
      </div>
      <div class="form-group" style="margin:0;">
        <input type="date" id="date-filter" style="padding:9px 12px; font-size:13px;" />
      </div>
      <button class="btn btn-ghost btn-sm" id="clear-filters-btn">Clear</button>
    </div>
  </div>

  <!-- Table -->
  <div class="card" style="padding:0; overflow:hidden;">
    <div style="overflow-x:auto;">
      <table class="data-table">
        <thead>
          <tr>
            <th>Date & Time</th>
            <th>Customer</th>
            <th>Mobile</th>
            <th>Bill No.</th>
            <th>Grand Total</th>
            <th>Mod Price</th>
            <th>Received</th>
            <th>Balance</th>
            <th>Sync</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="bills-tbody">
          <tr><td colspan="8"><div class="empty-state"><span class="spinner"></span></div></td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- Bill detail modal (hidden) -->
<div class="modal-overlay hidden" id="bill-modal">
  <div class="modal" id="bill-modal-content"></div>
</div>`;
}

let _allBills = [];

async function loadBills(container) {
  const localBills = await getAllBills();
  let serverBills = [];

  // Try to fetch from server if online to get latest record
  if (await isOnline()) {
    try {
      serverBills = await fetchBillsFromServer();
    } catch {
      console.warn("Could not fetch server bills, showing local only.");
    }
  }

  // Merge bills (Prefer local for speed, but include server-only bills)
  const map = new Map();
  serverBills.forEach((b) => map.set(b.local_id || b.id.toString(), { ...b, synced: true }));
  localBills.forEach((b) => map.set(b.id || b.local_id, b)); // Local overwrites with latest local state

  _allBills = Array.from(map.values());
  _allBills.sort((a, b) => new Date(b.created_at || b.bill_date) - new Date(a.created_at || a.bill_date));

  renderStats(container, _allBills);
  renderTable(container, _allBills);
}

function renderStats(container, bills) {
  const total = bills.length;
  const revenue = bills.reduce((a, b) => a + (b.grand_total || 0), 0);
  const totalBalance = bills.reduce((a, b) => a + (parseFloat(b.balance_due || b.balance) || 0), 0);
  const totalMod = bills.reduce((a, b) => a + (parseFloat(b.old_jewellery_adjustment) || 0), 0);

  const today = new Date().toDateString();
  const todayRev = bills.filter((b) => new Date(b.created_at).toDateString() === today)
    .reduce((a, b) => a + (b.grand_total || 0), 0);

  container.querySelector("#stat-total-bills").textContent = total;
  container.querySelector("#stat-revenue").textContent = `₹${revenue.toFixed(0)}`;
  container.querySelector("#stat-today").textContent = `₹${todayRev.toFixed(0)}`;
  container.querySelector("#stat-balance").textContent = `₹${totalBalance.toFixed(0)}`;
  container.querySelector("#stat-mod").textContent = `₹${totalMod.toFixed(0)}`;
}

function renderTable(container, bills) {
  const tbody = container.querySelector("#bills-tbody");
  if (bills.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
      <p>No bills found</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = bills.map((b) => {
    const dt = new Date(b.created_at);
    const dateStr = dt.toLocaleDateString("en-IN");
    const timeStr = dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const syncBadge = b.synced
      ? `<span class="badge badge-synced">Synced</span>`
      : `<span class="badge badge-offline">Local</span>`;
    return `<tr data-bill-id="${b.id}">
      <td>${dateStr}<br><span class="text-muted text-sm">${timeStr}</span></td>
      <td><strong>${b.customer_name}</strong></td>
      <td>${b.customer_mobile || "—"}</td>
      <td>${b.barcode_no || "—"}</td>
      <td class="text-gold"><strong>₹${(b.grand_total || 0).toFixed(2)}</strong></td>
      <td style="color:#e05c5c;">₹${(b.old_jewellery_adjustment || 0).toFixed(2)}</td>
      <td style="color:#5cbe8a;">₹${(b.received_amount || b.paid_amount || 0).toFixed(2)}</td>
      <td style="color:var(--warning);">₹${(b.balance_due || b.balance || 0).toFixed(2)}</td>
      <td>${syncBadge}</td>
      <td>
        <button class="btn btn-danger btn-sm delete-bill-btn" data-bill-id="${b.id}" title="Delete">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      </td>
    </tr>`;
  }).join("");
}

function bindReportEvents(container) {
  const searchInput = container.querySelector("#search-input");
  const dateFilter = container.querySelector("#date-filter");

  function applyFilters() {
    const q = searchInput.value.toLowerCase();
    const d = dateFilter.value; // YYYY-MM-DD
    let filtered = _allBills;
    if (q) filtered = filtered.filter((b) => b.customer_name.toLowerCase().includes(q));
    if (d) filtered = filtered.filter((b) => b.created_at.startsWith(d));
    renderTable(container, filtered);
  }

  searchInput.addEventListener("input", applyFilters);
  dateFilter.addEventListener("change", applyFilters);

  container.querySelector("#clear-filters-btn").addEventListener("click", () => {
    searchInput.value = "";
    dateFilter.value = "";
    renderStats(container, _allBills);
    renderTable(container, _allBills);
  });

  // Row click → show detail modal
  container.querySelector("#bills-tbody").addEventListener("click", async (e) => {
    const delBtn = e.target.closest(".delete-bill-btn");
    if (delBtn) {
      e.stopPropagation();
      const id = delBtn.dataset.billId;
      if (!confirm("Delete this bill? This cannot be undone.")) return;
      
      // Delete locally
      await deleteBill(id);
      
      // Delete from server if online
      if (await isOnline()) {
        await deleteBillFromServer(id);
      }

      toast("Bill deleted successfully", "info");
      loadBills(container); // Re-calculate stats and re-render table
      return;
    }

    const row = e.target.closest("tr[data-bill-id]");
    if (!row) return;
    const bill = _allBills.find((b) => b.id === row.dataset.billId);
    if (bill) showBillModal(container, bill);
  });

  container.querySelector("#bill-modal").addEventListener("click", (e) => {
    if (e.target === container.querySelector("#bill-modal")) {
      container.querySelector("#bill-modal").classList.add("hidden");
    }
  });
}

function showBillModal(container, bill) {
  const modal = container.querySelector("#bill-modal");
  const content = container.querySelector("#bill-modal-content");
  const dt = new Date(bill.created_at).toLocaleString("en-IN");
  const itemRows = (bill.items || []).map((i) => `
    <tr>
      <td>${i.item_name}</td>
      <td>${i.barcode_no || "—"}</td>
      <td>${(i.weight_g || 0).toFixed(3)}g</td>
      <td>₹${(i.rate_per_g || 0).toFixed(2)}</td>
      <td>₹${(i.making_charges || 0).toFixed(2)}</td>
      <td>₹${(i.discount || 0).toFixed(2)}</td>
      <td class="text-gold">₹${(i.line_total || 0).toFixed(2)}</td>
    </tr>`).join("");

  content.innerHTML = `
    <div class="flex justify-between items-center mb-16">
      <div class="card-title" style="margin:0;">Bill Details</div>
      <button class="btn btn-ghost btn-sm" id="close-modal-btn">Close</button>
    </div>
    <div class="form-grid" style="margin-bottom:16px;">
      <div><label>Customer</label><p style="margin-top:4px; font-weight:600;">${bill.customer_name}</p></div>
      <div><label>Mobile</label><p style="margin-top:4px;">${bill.customer_mobile || "—"}</p></div>
      <div><label>Date</label><p style="margin-top:4px;">${dt}</p></div>
      <div><label>Bill No.</label><p style="margin-top:4px;">${bill.barcode_no || "—"}</p></div>
      ${bill.customer_address ? `<div class="full"><label>Address</label><p style="margin-top:4px;">${bill.customer_address}</p></div>` : ""}
    </div>
    <div style="overflow-x:auto; margin-bottom:16px;">
      <table class="data-table">
        <thead><tr><th>Item</th><th>Barcode</th><th>Weight</th><th>Rate</th><th>Making</th><th>Discount</th><th>Total</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
    </div>
    <div class="totals-box">
      <div class="total-row"><span>Items Total</span><span class="total-amt">₹${((bill.subtotal || 0) + (bill.total_discount || 0)).toFixed(2)}</span></div>
      ${bill.total_discount > 0 ? `<div class="total-row" style="color:var(--error);"><span>Total Discount</span><span class="total-amt">- ₹${bill.total_discount.toFixed(2)}</span></div>` : ""}
      ${bill.gst_percent > 0 ? `<div class="total-row"><span>GST (${bill.gst_percent}%)</span><span class="total-amt">₹${(bill.gst_amount||0).toFixed(2)}</span></div>` : ""}
      ${bill.old_jewellery_adjustment > 0 ? `<div class="total-row" style="color:#e05c5c;"><span>Old Jewellery Mod</span><span class="total-amt">- ₹${bill.old_jewellery_adjustment.toFixed(2)}</span></div>` : ""}
      <div class="total-row grand"><span>Grand Total</span><span class="total-amt">₹${(bill.grand_total||0).toFixed(2)}</span></div>
      <div class="total-row" style="margin-top:8px; border-top:1px dashed var(--border); padding-top:8px;"><span>Received Amount</span><span class="total-amt">₹${(bill.received_amount || bill.paid_amount || 0).toFixed(2)}</span></div>
      <div class="total-row" style="font-weight:700; color:var(--warning);"><span>Balance / Credit</span><span class="total-amt">₹${(bill.balance_due || bill.balance || 0).toFixed(2)}</span></div>
    </div>
    ${bill.notes ? `<p style="margin-top:12px; font-size:13px; color:var(--text-secondary);">Notes: ${bill.notes}</p>` : ""}
  `;

  content.querySelector("#close-modal-btn").onclick = () => modal.classList.add("hidden");
  modal.classList.remove("hidden");
}
