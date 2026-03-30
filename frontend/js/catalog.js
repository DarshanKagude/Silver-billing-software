/* ── Catalog (Product) Management Page ──────────────────────────────────── */
import { getCatalogItems, saveCatalogItem, deleteCatalogItem } from "./db.js";
import { toast } from "./app.js";

export function initCatalogPage(container) {
  container.innerHTML = catalogHTML();
  loadItems(container);
  bindCatalogEvents(container);
}

function catalogHTML() {
  return `
<div class="page-header">
  <div>
    <div class="page-title">Item Catalog</div>
    <div class="page-subtitle">Manage your jewellery product catalog & default rates</div>
  </div>
</div>
<div class="page-body">
  <!-- Add form -->
  <div class="card">
    <div class="card-title">Add New Item</div>
    <div class="form-grid" style="align-items:end;">
      <div class="form-group">
        <label for="new-item-name">Item Name *</label>
        <input type="text" id="new-item-name" placeholder="e.g. Silver Chain 18 inch" />
      </div>
      <div class="form-group">
        <label for="new-item-rate">Default Rate (₹/g)</label>
        <input type="number" id="new-item-rate" placeholder="0.00" min="0" step="0.01" />
      </div>
      <div class="form-group">
        <label for="new-item-making">Making Charges (₹)</label>
        <input type="number" id="new-item-making" placeholder="0.00" min="0" step="0.01" />
      </div>
      <div class="form-group" style="justify-content:flex-end;">
        <button class="btn btn-primary" id="add-item-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
          Add Item
        </button>
      </div>
    </div>
  </div>

  <!-- Items list -->
  <div class="card" style="padding:0; overflow:hidden;">
    <div style="overflow-x:auto;">
      <table class="data-table">
        <thead>
          <tr>
            <th>Item Name</th>
            <th>Default Rate (₹/g)</th>
            <th>Making Charges (₹)</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="catalog-tbody">
          <tr><td colspan="4"><div class="empty-state"><span class="spinner"></span></div></td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>`;
}

async function loadItems(container) {
  const items = await getCatalogItems();
  const tbody = container.querySelector("#catalog-tbody");
  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
      <p>No items yet. Add your jewellery items above.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = items.map((i) => `
    <tr>
      <td><strong>${i.name}</strong></td>
      <td>₹${(i.default_rate || 0).toFixed(2)}</td>
      <td>₹${(i.making_charges || 0).toFixed(2)}</td>
      <td>
        <button class="btn btn-danger btn-sm delete-item-btn" data-item-id="${i.id}">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      </td>
    </tr>`).join("");
}

function bindCatalogEvents(container) {
  container.querySelector("#add-item-btn").addEventListener("click", async () => {
    const name = container.querySelector("#new-item-name").value.trim();
    const rate = parseFloat(container.querySelector("#new-item-rate").value) || 0;
    const making = parseFloat(container.querySelector("#new-item-making").value) || 0;
    if (!name) { toast("Item name is required", "error"); return; }
    await saveCatalogItem({ name, default_rate: rate, making_charges: making });
    toast(`"${name}" added to catalog`, "success");
    container.querySelector("#new-item-name").value = "";
    container.querySelector("#new-item-rate").value = "";
    container.querySelector("#new-item-making").value = "";
    loadItems(container);
  });

  container.querySelector("#catalog-tbody").addEventListener("click", async (e) => {
    const btn = e.target.closest(".delete-item-btn");
    if (!btn) return;
    if (!confirm("Remove this item from catalog?")) return;
    await deleteCatalogItem(btn.dataset.itemId);
    toast("Item removed", "info");
    loadItems(container);
  });
}
