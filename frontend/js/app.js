/* ── app.js — SPA Router, Toasts, Connection Badge ─────────────────────── */
import { initBillingPage } from "./billing.js";
import { initReportsPage } from "./reports.js";
import { initCatalogPage } from "./catalog.js";
import { initSettingsPage } from "./settings.js";
import { syncPending, isOnline } from "./sync.js";

// ── Toast system ─────────────────────────────────────────────────────────────
export function toast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  const icons = { success: "✓", error: "✕", info: "◈" };
  el.innerHTML = `<span>${icons[type] || "◈"}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── Connection status ────────────────────────────────────────────────────────
let _lastOnline = null;

async function updateConnBadge() {
  const badge = document.getElementById("conn-badge");
  if (!badge) return;
  const online = await isOnline();
  if (online === _lastOnline) return;
  _lastOnline = online;
  badge.innerHTML = online
    ? `<span class="dot dot-online"></span> Online`
    : `<span class="dot dot-offline"></span> Offline`;
  badge.className = `badge ${online ? "badge-online" : "badge-offline"}`;

  if (online) {
    // Auto-sync pending bills
    const result = await syncPending();
    if (result.synced > 0) toast(`${result.synced} bill(s) synced to server`, "success");
  }
}

setInterval(updateConnBadge, 8000);

// ── Router ────────────────────────────────────────────────────────────────────
const routes = {
  billing:  { label: "Billing",  init: initBillingPage },
  reports:  { label: "Reports",  init: initReportsPage },
  catalog:  { label: "Catalog",  init: initCatalogPage },
  settings: { label: "Settings", init: initSettingsPage },
};

const NAV_ICONS = {
  billing: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`,
  reports:  `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>`,
  catalog:  `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>`,
  settings: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
};

function buildSidebar() {
  const sidebar = document.getElementById("sidebar");
  sidebar.innerHTML = `
    <div class="sidebar-logo">S</div>
    ${Object.entries(routes).map(([key, { label }]) => `
      <button class="nav-item" data-route="${key}" title="${label}" aria-label="${label}">
        ${NAV_ICONS[key]}
        <span class="nav-label">${label}</span>
      </button>`).join("")}
    <div style="flex:1;"></div>
    <span id="conn-badge" class="badge badge-offline" style="width:52px; justify-content:center; font-size:9px; margin-bottom:8px; flex-direction:column; gap:3px; height:auto; padding:6px 4px;">
      <span class="dot dot-offline"></span> Offline
    </span>`;

  sidebar.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.route));
  });
}

let _currentRoute = null;

function navigate(route) {
  if (!routes[route]) route = "billing";
  _currentRoute = route;

  // Update nav active states
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.route === route);
  });

  // Update hash
  location.hash = route;

  // Render page
  const app = document.getElementById("app");
  routes[route].init(app);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  buildSidebar();

  // Listen for sync triggers from Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data && event.data.action === "sync-now") {
        console.log("[App] Sync message received from SW, triggering sync...");
        syncPending().then((res) => {
          if (res.synced > 0) toast(`${res.synced} bills synced in background.`, "success");
        });
      }
    });

    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }

  // Navigate to hash route or default
  const hash = location.hash.replace("#", "") || "billing";
  navigate(hash);
  updateConnBadge();
});

window.addEventListener("hashchange", () => {
  const route = location.hash.replace("#", "");
  if (route !== _currentRoute) navigate(route);
});
