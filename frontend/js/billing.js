/* ── Billing Page Logic ───────────────────────────────────────────────────── */
import { saveBill, getCatalogItems } from "./db.js";
import { toast } from "./app.js";
import { saveBillDirect } from "./sync.js";

let itemRows = [];
let gstEnabled = false;
let gstRate = 3; // default GST %
let currentModAdjustment = 0;

export function initBillingPage(container) {
  container.innerHTML = billingHTML();
  itemRows = [];
  gstEnabled = false;
  currentModAdjustment = 0;

  // Restore shop settings
  const settings = JSON.parse(localStorage.getItem("shop_settings") || "{}");
  gstRate = parseFloat(settings.gst_rate || 3);
  if (settings.gst_enabled) {
    gstEnabled = true;
    container.querySelector("#gst-toggle").classList.add("on");
    container.querySelector("#gst-rate-wrap").classList.remove("hidden");
    container.querySelector("#gst-rate-input").value = gstRate;
  }

  addItemRow(container);
  bindEvents(container);
  loadCatalogSuggestions(container);
}

function billingHTML() {
  return `
<div class="page-header">
  <div>
    <div class="page-title">New Bill</div>
    <div class="page-subtitle">Create a new jewellery billing invoice</div>
  </div>
  <div class="flex gap-8" id="bill-actions">
    <button class="btn btn-ghost btn-sm no-print" id="clear-btn">
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      Clear
    </button>
    <button class="btn btn-primary btn-sm no-print" id="save-btn">
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
      Save Bill
    </button>
    <button class="btn btn-ghost btn-sm no-print hidden" id="print-btn">
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2m-6 0v4m0 0H9m3 0h3"/></svg>
      Print
    </button>
  </div>
</div>

<div class="page-body">
  <!-- Customer Details -->
  <div class="card">
    <div class="card-title">Customer Details</div>
    <div class="form-grid">
      <div class="form-group">
        <label for="cust-name">Customer Name *</label>
        <input type="text" id="cust-name" placeholder="Full name" autocomplete="off" />
      </div>
      <div class="form-group">
        <label for="cust-mobile">Mobile Number</label>
        <input type="tel" id="cust-mobile" placeholder="+91 98765 43210" />
      </div>
      <div class="form-group">
        <label for="barcode-no">Barcode / Bill No.</label>
        <input type="text" id="barcode-no" placeholder="Scan or enter barcode" />
      </div>
      <div class="form-group full">
        <label for="cust-address">Address</label>
        <textarea id="cust-address" rows="2" placeholder="Street, City, State"></textarea>
      </div>
    </div>
  </div>

  <!-- Item Details -->
  <div class="card">
    <div class="card-title">Item Details</div>
    <div style="overflow-x:auto;">
      <table class="items-table" id="items-table">
        <thead>
          <tr>
            <th style="min-width:170px;">Item Name</th>
            <th style="min-width:110px;">Barcode</th>
            <th style="min-width:100px;">Weight (g)</th>
            <th style="min-width:110px;">Rate (₹/g)</th>
            <th style="min-width:120px;">Making (₹)</th>
            <th style="min-width:110px;">Discount (₹)</th>
            <th style="min-width:110px;">Total (₹)</th>
            <th style="width:40px;"></th>
          </tr>
        </thead>
        <tbody id="items-body"></tbody>
      </table>
    </div>
    <div class="mt-16 flex gap-8">
      <button class="btn btn-ghost btn-sm no-print" id="add-row-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
        Add Item
      </button>
    </div>
  </div>

  <!-- Old Jewellery Adjustment (Mod) -->
  <div class="card no-print">
    <div class="card-title">Old Jewellery (Mod)</div>
    <div class="form-grid">
      <div class="form-group">
        <label for="old-fine">Fine Weight (grams)</label>
        <input type="number" id="old-fine" placeholder="0.000" step="0.001" />
      </div>
      <div class="form-group">
        <label for="old-rate">Rate per gram</label>
        <input type="number" id="old-rate" placeholder="0.00" />
      </div>
    </div>
    <div class="mt-16 flex gap-12 items-center flex-wrap">
      <button class="btn btn-primary btn-sm" id="apply-mod-btn">Apply Mod</button>
      <div id="mod-summary" class="flex gap-16 text-sm py-8 px-12 rounded hidden" style="background: rgba(201,168,76,0.1); border: 1px dashed var(--border);">
          <span style="color:var(--accent-200)">Final Adjusted: <strong id="old-final-disp">₹0.00</strong></span>
      </div>
    </div>
  </div>

  <!-- Totals & GST -->
  <div class="card">
    <div class="card-title">Bill Summary</div>
    <div class="flex gap-16" style="flex-wrap:wrap; align-items:flex-start;">
      <div style="flex:1; min-width:220px;">
        <div class="form-group mb-16">
          <label for="daily-rate-input">Today's Silver Rate (₹/g)</label>
          <div class="flex gap-8">
            <input type="number" id="daily-rate-input" placeholder="0.00" min="0" step="0.01" style="max-width:160px;" />
            <button class="btn btn-ghost btn-sm" id="apply-rate-all" title="Apply to all items">Apply All</button>
          </div>
        </div>
        <div class="toggle-row mb-16">
          <div class="toggle" id="gst-toggle"></div>
          <span>Enable GST</span>
        </div>
        <div class="form-group hidden" id="gst-rate-wrap">
          <label>GST Rate (%)</label>
          <input type="number" id="gst-rate-input" value="3" min="0" max="28" step="0.5" style="max-width:120px;" />
        </div>
        <div class="form-group mt-16">
          <label for="bill-notes">Notes</label>
          <textarea id="bill-notes" rows="3" placeholder="Add any remarks…"></textarea>
        </div>
      </div>
      <div class="totals-box" style="flex:0 0 300px;">
        <div class="total-row"><span>Items Total</span><span class="total-amt" id="subtotal-disp">₹0.00</span></div>
        <div class="total-row" id="discount-row" style="color:var(--error);">
          <span>Total Discount</span>
          <span class="total-amt" id="discount-amt-disp">₹0.00</span>
        </div>
        <div class="total-row" id="gst-row" style="${gstEnabled ? "" : "display:none"}">
          <span>GST (<span id="gst-pct-disp">${gstRate}</span>%)</span>
          <span class="total-amt" id="gst-amt-disp">₹0.00</span>
        </div>
        <div class="total-row grand">
          <span>Grand Total</span>
          <span class="total-amt" id="grand-total-disp">₹0.00</span>
        </div>
        <div class="divider" style="margin: 12px 0; opacity: 0.3;"></div>
        <div class="total-row">
          <span>Received Amount</span>
          <input type="number" id="received-amt-input" placeholder="0.00" style="max-width:140px; text-align:right; font-weight:600; padding: 4px 8px; border-color: rgba(201,168,76,0.3);" />
        </div>
        <div class="total-row" style="margin-top: 4px;">
          <span>Balance / Credit</span>
          <span class="total-amt" id="balance-amt-disp" style="color:var(--warning); font-size:18px;">₹0.00</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Suggestions datalist -->
  <datalist id="item-suggestions"></datalist>
</div>`;
}

function addItemRow(container) {
  const rowId = `row_${Date.now()}`;
  itemRows.push(rowId);

  const tbody = container.querySelector("#items-body");
  const tr = document.createElement("tr");
  tr.className = "item-row";
  tr.dataset.rowId = rowId;

  // Pre-fill from daily rate if available
  const dailyRate = container.querySelector("#daily-rate-input")?.value || "";

  tr.innerHTML = `
    <td><input type="text" class="item-name" placeholder="e.g. Silver Chain" list="item-suggestions" /></td>
    <td><input type="text" class="item-barcode" placeholder="Barcode" /></td>
    <td><input type="number" class="item-weight" placeholder="0.000" min="0" step="0.001" /></td>
    <td><input type="number" class="item-rate" placeholder="0.00" min="0" step="0.01" value="${dailyRate}" /></td>
    <td><input type="number" class="item-making" placeholder="0.00" min="0" step="0.01" /></td>
    <td><input type="number" class="item-discount" placeholder="0.00" min="0" step="0.01" /></td>
    <td><input type="number" class="item-total" placeholder="0.00" readonly tabindex="-1" /></td>
    <td>
      <button class="delete-row-btn" data-row-id="${rowId}" title="Remove row">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
      </button>
    </td>`;

  const inputs = tr.querySelectorAll(".item-weight, .item-rate, .item-making, .item-discount");
  inputs.forEach((inp) => inp.addEventListener("input", () => { recalcRow(tr); recalcTotals(container); }));

  // Auto-fill rate/making from catalog
  tr.querySelector(".item-name").addEventListener("change", async (e) => {
    const items = await getCatalogItems();
    const match = items.find((i) => i.name.toLowerCase() === e.target.value.toLowerCase());
    if (match) {
      tr.querySelector(".item-rate").value = match.default_rate || "";
      tr.querySelector(".item-making").value = match.making_charges || "";
      recalcRow(tr);
      recalcTotals(container);
    }
  });

  tbody.appendChild(tr);
}

function recalcRow(tr) {
  const w = parseFloat(tr.querySelector(".item-weight").value) || 0;
  const r = parseFloat(tr.querySelector(".item-rate").value) || 0;
  const m = parseFloat(tr.querySelector(".item-making").value) || 0;
  const d = parseFloat(tr.querySelector(".item-discount").value) || 0;
  const total = (w * r + m) - d;
  tr.querySelector(".item-total").value = total.toFixed(2);
}

function recalcTotals(container) {
  const lineTotals = [...container.querySelectorAll(".item-total")].map((i) => parseFloat(i.value) || 0);
  const discounts = [...container.querySelectorAll(".item-discount")].map((i) => parseFloat(i.value) || 0);

  const subtotal = lineTotals.reduce((a, b) => a + b, 0);
  const totalDiscount = discounts.reduce((a, b) => a + b, 0);

  // Since lineTotal already has discount subtracted, subtotal is already net.
  // To show Gross Total in "Items Total", we add back discount.
  const grossTotal = subtotal + totalDiscount;

  const gstAmt = gstEnabled ? subtotal * (gstRate / 100) : 0;
  const grand = (subtotal + gstAmt) - (currentModAdjustment || 0);

  const received = parseFloat(container.querySelector("#received-amt-input").value) || 0;
  const balance = grand - received;

  container.querySelector("#subtotal-disp").textContent = `₹${grossTotal.toFixed(2)}`;
  container.querySelector("#discount-amt-disp").textContent = `- ₹${totalDiscount.toFixed(2)}`;
  container.querySelector("#gst-amt-disp").textContent = `₹${gstAmt.toFixed(2)}`;
  container.querySelector("#grand-total-disp").textContent = `₹${grand.toFixed(2)}`;
  container.querySelector("#balance-amt-disp").textContent = `₹${balance.toFixed(2)}`;
}

function collectBill(container) {
  const items = [...container.querySelectorAll("#items-body .item-row")].map((tr) => ({
    item_name: tr.querySelector(".item-name").value.trim(),
    barcode_no: tr.querySelector(".item-barcode").value.trim(),
    weight_g: parseFloat(tr.querySelector(".item-weight").value) || 0,
    rate_per_g: parseFloat(tr.querySelector(".item-rate").value) || 0,
    making_charges: parseFloat(tr.querySelector(".item-making").value) || 0,
    discount: parseFloat(tr.querySelector(".item-discount").value) || 0,
    line_total: parseFloat(tr.querySelector(".item-total").value) || 0,
  })).filter((i) => i.item_name);

  const subtotal = items.reduce((a, i) => a + i.line_total, 0);
  const gstAmt = gstEnabled ? subtotal * (gstRate / 100) : 0;

  return {
    customer_name: container.querySelector("#cust-name").value.trim(),
    customer_address: container.querySelector("#cust-address").value.trim(),
    customer_mobile: container.querySelector("#cust-mobile").value.trim(),
    barcode_no: container.querySelector("#barcode-no").value.trim(),
    subtotal,
    total_discount: [...container.querySelectorAll(".item-discount")].reduce((a, i) => a + (parseFloat(i.value) || 0), 0),
    gst_percent: gstEnabled ? gstRate : 0,
    gst_amount: gstAmt,
    old_jewellery_adjustment: currentModAdjustment || 0,
    grand_total: (subtotal + gstAmt) - (currentModAdjustment || 0),
    received_amount: parseFloat(container.querySelector("#received-amt-input").value) || 0,
    balance_due: ((subtotal + gstAmt) - (currentModAdjustment || 0)) - (parseFloat(container.querySelector("#received-amt-input").value) || 0),
    notes: container.querySelector("#bill-notes").value.trim(),
    items,
  };
}

function bindEvents(container) {
  container.querySelector("#add-row-btn").addEventListener("click", () => addItemRow(container));

  // Daily rate persistence
  const rateInput = container.querySelector("#daily-rate-input");
  const storedRate = localStorage.getItem("last_daily_rate") || "";
  if (rateInput && storedRate) {
    rateInput.value = storedRate;
  }

  rateInput.addEventListener("input", (e) => {
    localStorage.setItem("last_daily_rate", e.target.value);
  });

  // Apply daily rate to all rows
  container.querySelector("#apply-rate-all").addEventListener("click", () => {
    const rate = rateInput.value;
    if (!rate) return;
    container.querySelectorAll(".item-row").forEach(tr => {
      tr.querySelector(".item-rate").value = rate;
      recalcRow(tr);
    });
    recalcTotals(container);
    toast("Daily rate applied to all items", "info");
  });

  container.addEventListener("click", (e) => {
    const del = e.target.closest(".delete-row-btn");
    if (del) {
      const rowId = del.dataset.rowId;
      const tr = container.querySelector(`tr[data-row-id="${rowId}"]`);
      if (tr) tr.remove();
      itemRows = itemRows.filter((id) => id !== rowId);
      recalcTotals(container);
    }
  });

  // GST toggle
  container.querySelector("#gst-toggle").addEventListener("click", (e) => {
    gstEnabled = !gstEnabled;
    e.currentTarget.classList.toggle("on", gstEnabled);
    container.querySelector("#gst-rate-wrap").classList.toggle("hidden", !gstEnabled);
    container.querySelector("#gst-row").style.display = gstEnabled ? "" : "none";
    recalcTotals(container);
  });

  container.querySelector("#gst-rate-input").addEventListener("input", (e) => {
    gstRate = parseFloat(e.target.value) || 0;
    container.querySelector("#gst-pct-disp").textContent = gstRate;
    recalcTotals(container);
  });

  container.querySelector("#received-amt-input").addEventListener("input", () => {
    recalcTotals(container);
  });

  // Apply Mod
  container.querySelector("#apply-mod-btn").addEventListener("click", () => {
    calculateMod(container);
    recalcTotals(container);
  });

  // Save
  container.querySelector("#save-btn").addEventListener("click", async () => {
    const bill = collectBill(container);
    if (!bill.customer_name) { toast("Customer name is required", "error"); return; }
    if (bill.items.length === 0) { toast("Add at least one item", "error"); return; }

    const btn = container.querySelector("#save-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Saving…`;

    try {
      const savedBill = await saveBillDirect(bill);
      await saveBill(savedBill); 
      
      if (savedBill.synced) {
        toast("Bill permanently saved to server!", "success");
      } else {
        toast("Saved locally (Offline). Will sync once online.", "info");
      }
      
      container.querySelector("#print-btn").classList.remove("hidden");
      container.querySelector("#print-btn").onclick = () => printInvoice(bill);
    } catch (err) {
      toast("Error saving bill locally: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Save Bill`;
    }
  });

  // Clear
  container.querySelector("#clear-btn").addEventListener("click", () => {
    if (!confirm("Clear the current bill?")) return;
    initBillingPage(container);
  });
}

async function loadCatalogSuggestions(container) {
  const items = await getCatalogItems();
  const dl = container.querySelector("#item-suggestions");
  dl.innerHTML = items.map((i) => `<option value="${i.name}">`).join("");
}

function printInvoice(bill) {
  const settings = JSON.parse(localStorage.getItem("shop_settings") || "{}");
  const shopName = settings.shop_name || "Silver Jewellery Shop";
  const gstNo = settings.gst_no || "";
  const rows = bill.items.map((i) => `
    <tr>
      <td>${i.item_name}</td>
      <td>${i.barcode_no || "-"}</td>
      <td>${i.weight_g.toFixed(3)}</td>
      <td>₹${i.rate_per_g.toFixed(2)}</td>
      <td>₹${i.making_charges.toFixed(2)}</td>
      <td>₹${(i.discount || 0).toFixed(2)}</td>
      <td>₹${i.line_total.toFixed(2)}</td>
    </tr>`).join("");

  const win = window.open("", "PRINT", "width=800,height=900");
  win.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Invoice — ${bill.customer_name}</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
  body { margin: 0; font-family: 'Inter', sans-serif; font-size: 13px; color: #111; background: white; }
  .inv { max-width: 720px; margin: 0 auto; padding: 40px; }
  .inv-header { display: flex; justify-content: space-between; border-bottom: 3px solid #c9a84c; padding-bottom: 20px; margin-bottom: 24px; }
  .inv-shop-name { font-family: 'Cinzel', serif; font-size: 22px; color: #7a6328; }
  .inv-meta { font-size: 11px; color: #666; margin-top: 4px; }
  .inv-section { margin-bottom: 20px; }
  .inv-section h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #999; margin-bottom: 8px; }
  .inv-section p { margin: 2px 0; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f5f0e8; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #555; padding: 9px 10px; text-align: left; border: 1px solid #e8dfc8; }
  td { padding: 8px 10px; border: 1px solid #ede8da; }
  .total-section { margin-top: 16px; display: flex; justify-content: flex-end; }
  .totals-inner { width: 260px; }
  .tot-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; }
  .tot-row.grand { border-top: 2px solid #c9a84c; font-size: 16px; font-weight: 700; color: #7a6328; padding-top: 10px; margin-top: 4px; }
  .footer { margin-top: 40px; border-top: 1px solid #e8dfc8; padding-top: 12px; font-size: 11px; color: #999; text-align: center; }
  @media print { button { display: none; } }
</style>
</head>
<body>
<div class="inv">
  <div class="inv-header">
    <div>
      <div class="inv-shop-name">${shopName}</div>
      ${gstNo ? `<div class="inv-meta">GST: ${gstNo}</div>` : ""}
    </div>
    <div style="text-align:right;">
      <div style="font-size:18px; font-weight:700; color:#333;">INVOICE</div>
      <div class="inv-meta">Date: ${new Date().toLocaleDateString("en-IN")}</div>
      ${bill.barcode_no ? `<div class="inv-meta">Bill No.: ${bill.barcode_no}</div>` : ""}
    </div>
  </div>
  <div class="inv-section">
    <h3>Bill To</h3>
    <p><strong>${bill.customer_name}</strong></p>
    ${bill.customer_mobile ? `<p>📞 ${bill.customer_mobile}</p>` : ""}
    ${bill.customer_address ? `<p>${bill.customer_address}</p>` : ""}
  </div>
  <table>
    <thead>
      <tr><th>Item</th><th>Barcode</th><th>Weight (g)</th><th>Rate (₹/g)</th><th>Making (₹)</th><th>Discount (₹)</th><th>Total (₹)</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="total-section">
    <div class="totals-inner">
      <div class="tot-row"><span>Items Total</span><span>₹${(bill.subtotal + (bill.total_discount || 0)).toFixed(2)}</span></div>
      ${bill.total_discount > 0 ? `<div class="tot-row" style="color:#e05c5c;"><span>Total Discount</span><span>- ₹${bill.total_discount.toFixed(2)}</span></div>` : ""}
      ${bill.gst_percent > 0 ? `<div class="tot-row"><span>GST (${bill.gst_percent}%)</span><span>₹${bill.gst_amount.toFixed(2)}</span></div>` : ""}
      ${bill.old_jewellery_adjustment > 0 ? `<div class="tot-row" style="color:#e05c5c;"><span>Old Jewellery Mod</span><span>- ₹${bill.old_jewellery_adjustment.toFixed(2)}</span></div>` : ""}
      <div class="tot-row grand"><span>Grand Total</span><span>₹${bill.grand_total.toFixed(2)}</span></div>
      <div class="tot-row" style="margin-top:8px; border-top:1px dashed #ddd; padding-top:8px;"><span>Received Amount</span><span>₹${(bill.received_amount || 0).toFixed(2)}</span></div>
      <div class="tot-row" style="font-weight:700; color:#7a6328;"><span>Balance / Credit</span><span>₹${(bill.balance_due || 0).toFixed(2)}</span></div>
    </div>
  </div>
  ${bill.notes ? `<div class="inv-section" style="margin-top:20px;"><h3>Notes</h3><p>${bill.notes}</p></div>` : ""}
  <div class="footer">Thank you for your business! &mdash; ${shopName}</div>
</div>
<script>window.onload = () => { window.print(); }<\/script>
</body></html>`);
  win.document.close();
}

function calculateMod(container) {
  const f = parseFloat(container.querySelector("#old-fine").value) || 0;
  const r = parseFloat(container.querySelector("#old-rate").value) || 0;

  const finalValue = f * r;

  container.querySelector("#old-final-disp").textContent = `₹${finalValue.toFixed(2)}`;
  container.querySelector("#mod-summary").classList.remove("hidden");

  currentModAdjustment = finalValue;
}
