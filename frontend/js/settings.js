/* ── Settings Page ────────────────────────────────────────────────────────── */
import { syncPending } from "./sync.js";
import { setApiBase, getApiBase } from "./sync.js";
import { toast } from "./app.js";

export function initSettingsPage(container) {
  const settings = JSON.parse(localStorage.getItem("shop_settings") || "{}");
  container.innerHTML = settingsHTML(settings);
  bindSettingsEvents(container, settings);
}

function settingsHTML(s) {
  return `
<div class="page-header">
  <div>
    <div class="page-title">Settings</div>
    <div class="page-subtitle">Configure shop details, GST & backend sync</div>
  </div>
</div>
<div class="page-body">
  <!-- Shop Info -->
  <div class="card">
    <div class="card-title">Shop Information</div>
    <div class="form-grid">
      <div class="form-group">
        <label for="s-shop-name">Shop Name</label>
        <input type="text" id="s-shop-name" value="${s.shop_name || ""}" placeholder="Silver Jewellery Shop" />
      </div>
      <div class="form-group">
        <label for="s-gst-no">GST Number</label>
        <input type="text" id="s-gst-no" value="${s.gst_no || ""}" placeholder="27AAAAA0000A1Z5" />
      </div>
      <div class="form-group">
        <label for="s-phone">Shop Phone</label>
        <input type="tel" id="s-phone" value="${s.phone || ""}" placeholder="+91 98765 43210" />
      </div>
      <div class="form-group full">
        <label for="s-address">Shop Address</label>
        <textarea id="s-address" rows="2" placeholder="Shop address for invoices">${s.address || ""}</textarea>
      </div>
    </div>
  </div>

  <!-- GST Settings -->
  <div class="card">
    <div class="card-title">GST & Billing Defaults</div>
    <div class="form-grid">
      <div class="form-group">
        <label for="s-gst-rate">Default GST Rate (%)</label>
        <input type="number" id="s-gst-rate" value="${s.gst_rate || 3}" min="0" max="28" step="0.5" />
      </div>
      <div class="form-group" style="justify-content:flex-end; align-self:flex-end;">
        <div class="toggle-row">
          <div class="toggle ${s.gst_enabled ? "on" : ""}" id="s-gst-toggle"></div>
          <span>Enable GST by default on new bills</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Backend Sync -->
  <div class="card">
    <div class="card-title">Backend Sync (Optional)</div>
    <p style="font-size:13px; color:var(--text-secondary); margin-bottom:16px;">
      Connect to your FastAPI backend to sync bills to MySQL. Leave blank to work offline-only.
    </p>
    <div class="form-grid" style="align-items:end;">
      <div class="form-group" style="flex:2;">
        <label for="s-api-base">Backend API URL</label>
        <input type="url" id="s-api-base" value="${getApiBase()}" placeholder="http://your-server-ip:8000" />
      </div>
      <div class="form-group">
        <button class="btn btn-ghost" id="test-conn-btn">Test Connection</button>
      </div>
    </div>
    <div style="margin-top:16px;">
      <button class="btn btn-ghost btn-sm" id="sync-now-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
        Sync Pending Bills Now
      </button>
    </div>
  </div>

  <!-- Save -->
  <div class="flex gap-8">
    <button class="btn btn-primary" id="save-settings-btn">
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
      Save Settings
    </button>
    <button class="btn btn-danger btn-sm" id="clear-data-btn">Clear All Local Data</button>
  </div>
</div>`;
}

function bindSettingsEvents(container, settings) {
  let gstEnabled = !!settings.gst_enabled;

  container.querySelector("#s-gst-toggle").addEventListener("click", (e) => {
    gstEnabled = !gstEnabled;
    e.currentTarget.classList.toggle("on", gstEnabled);
  });

  container.querySelector("#test-conn-btn").addEventListener("click", async () => {
    const url = container.querySelector("#s-api-base").value.trim();
    if (!url) { toast("Enter a backend URL first", "error"); return; }
    setApiBase(url);
    const btn = container.querySelector("#test-conn-btn");
    btn.disabled = true; btn.textContent = "Testing…";
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) toast("✓ Connected to backend!", "success");
      else toast(`Backend responded with ${res.status}`, "error");
    } catch {
      toast("Cannot reach backend. Check URL & network.", "error");
    } finally {
      btn.disabled = false; btn.textContent = "Test Connection";
    }
  });

  container.querySelector("#sync-now-btn").addEventListener("click", async () => {
    const btn = container.querySelector("#sync-now-btn");
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Syncing…`;
    const {synced, failed} = await syncPending();
    toast(synced > 0 ? `${synced} bill(s) synced!` : "Nothing to sync or offline", synced > 0 ? "success" : "info");
    if (failed > 0) toast(`${failed} bill(s) failed to sync`, "error");
    btn.disabled = false;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Sync Pending Bills Now`;
  });

  container.querySelector("#save-settings-btn").addEventListener("click", () => {
    const newSettings = {
      shop_name: container.querySelector("#s-shop-name").value.trim(),
      gst_no: container.querySelector("#s-gst-no").value.trim(),
      phone: container.querySelector("#s-phone").value.trim(),
      address: container.querySelector("#s-address").value.trim(),
      gst_rate: parseFloat(container.querySelector("#s-gst-rate").value) || 3,
      gst_enabled: gstEnabled,
    };
    const apiUrl = container.querySelector("#s-api-base").value.trim();
    setApiBase(apiUrl);
    localStorage.setItem("shop_settings", JSON.stringify(newSettings));
    toast("Settings saved!", "success");
  });

  container.querySelector("#clear-data-btn").addEventListener("click", async () => {
    if (!confirm("This will delete ALL local bills and catalog data permanently. Are you sure?")) return;
    indexedDB.deleteDatabase("silver_billing");
    localStorage.clear();
    toast("All local data cleared. Please refresh.", "info");
  });
}
