// ============================================================
//  لوحة تحكم المتجر — واجهة (SPA بدون مكتبات خارجية)
// ============================================================
const STATUS_LABELS = { processing: "قيد المعالجة", paid: "مدفوع", delivered: "تم التسليم", cancelled: "ملغي" };
const STATUS_BADGE = { processing: "badge-blue", paid: "badge-yellow", delivered: "badge-green", cancelled: "badge-red" };
const STATUS_COLOR = { processing: "var(--primary)", paid: "var(--warning)", delivered: "var(--success)", cancelled: "var(--danger)" };
const ACTIVITY_ICONS = {
  product_toggle: "🔁", product_update: "✏️", manual_product_create: "🆕", manual_product_update: "✏️",
  manual_product_delete: "🗑️", stock_add: "📦", stock_delete: "🗑️", balance_adjust: "💰",
  order_deliver: "✅", order_cancel: "❌", email_activation_add: "📧", email_activation_remove: "📧",
  broadcast_single: "📣", broadcast_all: "📣"
};

let currentProducts = []; // كاش لآخر منتجات KOKORO محمّلة
let selectedProductIds = new Set();

// ---------- Helpers ----------
async function api(path, opts = {}) {
  const res = await fetch(`/api/${path}`, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let json = {};
  try { json = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function toast(msg, type = "success") {
  const stack = document.getElementById("toastStack");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = (type === "error" ? "⚠️ " : "✅ ") + msg;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3400);
  while (stack.children.length > 4) stack.removeChild(stack.firstChild);
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function money(n) { return Number(n || 0).toFixed(2); }
function orderCode(id) { return id == null ? "-" : `EXE-${String(id).padStart(6, "0")}`; }
function fmtDate(d) { if (!d) return "-"; const dt = new Date(d); return dt.toLocaleDateString("ar-EG") + " " + dt.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }); }
function timeAgo(d) {
  const secs = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (secs < 60) return "الآن";
  if (secs < 3600) return `منذ ${Math.floor(secs / 60)} دقيقة`;
  if (secs < 86400) return `منذ ${Math.floor(secs / 3600)} ساعة`;
  return `منذ ${Math.floor(secs / 86400)} يوم`;
}
function skeletonRows(cols, n = 4) {
  return Array.from({ length: n }).map(() =>
    `<tr class="skel-row">${Array.from({ length: cols }).map(() => `<td><span class="skel"></span></td>`).join("")}</tr>`
  ).join("");
}

// ---------- Modal ----------
const modalOverlay = document.getElementById("modalOverlay");
const modalBox = document.getElementById("modalBox");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
function openModal(title, bodyHtml, opts = {}) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalBox.classList.toggle("modal-lg", !!opts.large);
  modalOverlay.classList.remove("hidden");
}
function closeModal() { modalOverlay.classList.add("hidden"); modalBody.innerHTML = ""; }
document.getElementById("modalClose").addEventListener("click", closeModal);
modalOverlay.addEventListener("click", e => { if (e.target === modalOverlay) closeModal(); });

// ---------- Auth ----------
const loginScreen = document.getElementById("loginScreen");
const appEl = document.getElementById("app");

async function checkAuth() {
  try {
    const { authed } = await api("auth/me");
    if (authed) { showApp(); loadTab(currentTab); }
    else showLogin();
  } catch (e) { showLogin(); }
}
function showLogin() { loginScreen.classList.remove("hidden"); appEl.classList.add("hidden"); }
function showApp() { loginScreen.classList.add("hidden"); appEl.classList.remove("hidden"); }

document.getElementById("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const username = document.getElementById("loginUser").value.trim();
  const password = document.getElementById("loginPass").value;
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";
  try {
    await api("auth/login", { method: "POST", body: { username, password } });
    showApp();
    loadTab(currentTab);
  } catch (e) {
    errEl.textContent = e.message || "تعذر تسجيل الدخول";
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await api("auth/logout", { method: "POST" }).catch(() => {});
  showLogin();
});

// ---------- Tabs ----------
const TAB_TITLES = {
  dashboard: "لوحة التحكم", activity: "سجل النشاط", broadcast: "بث رسالة", products: "منتجات KOKORO",
  manual: "منتجاتي اليدوية", users: "المستخدمين", orders: "الطلبات", transactions: "المعاملات",
  activation: "التفعيل بالبريد", tickets: "الشكاوى", providers: "مزوّدي API"
};
let currentTab = "dashboard";

document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    currentTab = btn.dataset.tab;
    document.getElementById(`tab-${currentTab}`).classList.add("active");
    document.getElementById("pageTitle").textContent = TAB_TITLES[currentTab];
    document.querySelector(".sidebar").classList.remove("open");
    loadTab(currentTab);
  });
});
document.getElementById("menuToggle").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
document.getElementById("refreshBtn").addEventListener("click", () => loadTab(currentTab));

function loadTab(tab) {
  const loaders = {
    dashboard: loadDashboard, activity: loadActivity, broadcast: () => {}, products: loadProducts, manual: loadManual,
    users: loadUsers, orders: loadOrders, transactions: loadTransactions, activation: loadActivation, tickets: loadTickets,
    providers: loadProviders
  };
  (loaders[tab] || (() => {}))();
}
function ic(name, cls = "icon") { return `<svg class="${cls}"><use href="#ic-${name}"/></svg>`; }

// ---------- Support tickets ----------
async function loadTickets() {
  const tbody = document.querySelector("#ticketsTable tbody");
  tbody.innerHTML = skeletonRows(7);
  const status = document.getElementById("ticketsStatusFilter").value;
  try {
    const { tickets } = await api(`tickets${status ? `?status=${status}` : ""}`);
    if (!tickets.length) { tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">لا توجد تذاكر.</div></td></tr>`; return; }
    tbody.innerHTML = tickets.map(t => `<tr class="clickable" data-id="${t.id}">
      <td>#${t.id}</td>
      <td>${t.telegram_id}</td>
      <td>${t.order_id ? orderCode(t.order_id) : "-"}</td>
      <td style="white-space:normal;max-width:280px">${esc((t.description || "").slice(0, 80))}${(t.description || "").length > 80 ? "…" : ""}</td>
      <td><span class="badge ${t.status === "open" ? "badge-yellow" : "badge-green"}">${t.status === "open" ? "مفتوحة" : "مغلقة"}</span></td>
      <td>${fmtDate(t.created_at)}</td>
      <td><button class="btn btn-sm btn-primary" data-action="view">${ic("edit", "icon icon-sm")} عرض</button></td>
    </tr>`).join("");
  } catch (e) { tbody.innerHTML = `<tr><td colspan="7">${esc(e.message)}</td></tr>`; }
}
document.getElementById("ticketsStatusFilter").addEventListener("change", loadTickets);
document.querySelector("#ticketsTable tbody").addEventListener("click", e => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  openTicketDetail(tr.dataset.id);
});

async function openTicketDetail(id) {
  openModal(`تذكرة #${id}`, `<div class="empty-state">جارِ التحميل...</div>`);
  try {
    const { tickets } = await api(`tickets`);
    const t = tickets.find(x => String(x.id) === String(id));
    if (!t) { modalBody.innerHTML = `<div class="empty-state">التذكرة غير موجودة.</div>`; return; }
    modalBody.innerHTML = `
      <div class="detail-grid">
        <div class="detail-item"><div class="di-label">العميل</div><div class="di-value">${t.telegram_id}</div></div>
        <div class="detail-item"><div class="di-label">الطلب المرتبط</div><div class="di-value">${t.order_id ? orderCode(t.order_id) : "-"}</div></div>
        <div class="detail-item"><div class="di-label">الحالة</div><div class="di-value"><span class="badge ${t.status === "open" ? "badge-yellow" : "badge-green"}">${t.status === "open" ? "مفتوحة" : "مغلقة"}</span></div></div>
        <div class="detail-item"><div class="di-label">التاريخ</div><div class="di-value" style="font-size:12px">${fmtDate(t.created_at)}</div></div>
      </div>
      <div><b style="font-size:13px">وصف المشكلة</b></div>
      <div class="detail-block">${esc(t.description)}</div>
      ${t.admin_reply ? `<div><b style="font-size:13px">آخر رد</b></div><div class="detail-block">${esc(t.admin_reply)}</div>` : ""}
      ${t.status === "open" ? `
      <label>الرد على العميل (اختياري، بيتبعتله على تليجرام)</label>
      <textarea id="tk_reply" placeholder="اكتب ردك هنا..."></textarea>
      <div class="modal-actions">
        <button class="btn" id="tk_close_only">إغلاق بدون رد</button>
        <button class="btn btn-primary" id="tk_reply_close">إرسال الرد وإغلاق</button>
      </div>` : `<div class="modal-actions"><button class="btn" id="tk_ok">تمام</button></div>`}
    `;
    const okBtn = document.getElementById("tk_ok");
    if (okBtn) okBtn.addEventListener("click", closeModal);
    const closeOnlyBtn = document.getElementById("tk_close_only");
    if (closeOnlyBtn) closeOnlyBtn.addEventListener("click", async () => {
      try { await api("tickets", { method: "PATCH", body: { id, close: true } }); toast("تم إغلاق التذكرة ✅"); closeModal(); loadTickets(); }
      catch (err) { toast(err.message, "error"); }
    });
    const replyCloseBtn = document.getElementById("tk_reply_close");
    if (replyCloseBtn) replyCloseBtn.addEventListener("click", async () => {
      const reply = document.getElementById("tk_reply").value.trim();
      try {
        const r = await api("tickets", { method: "PATCH", body: { id, reply, close: true } });
        toast(reply && r.notified === false ? "تم الإغلاق لكن تعذر إشعار العميل ⚠️" : "تم الرد والإغلاق ✅");
        closeModal();
        loadTickets();
      } catch (err) { toast(err.message, "error"); }
    });
  } catch (e) { modalBody.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; }
}

// ---------- API Providers ----------
async function loadProviders() {
  const grid = document.getElementById("providersGrid");
  grid.innerHTML = Array.from({ length: 2 }).map(() => `<div class="product-card"><span class="skel" style="width:70%"></span><span class="skel" style="height:22px;margin-top:8px"></span></div>`).join("");
  try {
    const { providers } = await api("providers");
    if (!providers.length) { grid.innerHTML = `<div class="empty-state">لا يوجد مزوّدين بعد.</div>`; return; }
    grid.innerHTML = providers.map(p => `<div class="product-card" data-id="${p.id}">
      <div class="pc-head">
        <div class="pc-title">${ic("bank", "icon icon-sm")} ${esc(p.name)}${p.is_default ? ` <span class="badge badge-blue">افتراضي</span>` : ""}</div>
        <span class="badge ${p.active ? "badge-green" : "badge-red"}">${p.active ? "مفعّل" : "معطّل"}</span>
      </div>
      <div class="pc-price" style="font-size:15px">${p.balance != null ? money(p.balance) + " USDT" : (p.balanceError ? `<span style="font-size:12px;color:var(--danger)">${esc(p.balanceError)}</span>` : "—")}</div>
      <div class="pc-meta">
        <span>${esc(p.base_url)}</span>
      </div>
      <div class="pc-meta"><span>مفتاح: ${esc(p.api_key_masked)}</span></div>
      <div class="pc-actions">
        <button class="btn btn-sm" data-action="toggle">${p.active ? "تعطيل" : "تفعيل"}</button>
        <button class="btn btn-sm" data-action="edit">${ic("edit", "icon icon-sm")} تعديل</button>
        ${!p.is_default ? `<button class="btn btn-sm btn-danger" data-action="delete">${ic("trash", "icon icon-sm")}</button>` : ""}
      </div>
    </div>`).join("");
  } catch (e) { grid.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; }
}

function providerForm(p = {}) {
  return `
    <label>اسم المزوّد (داخلي، للتمييز بس)</label><input id="pf_name" value="${esc(p.name || "")}" placeholder="مثال: مزوّد ثاني">
    <label>Base URL</label><input id="pf_url" value="${esc(p.base_url || "")}" placeholder="https://api.example.com">
    <label>API Key ${p.id ? "(اسيبها فاضية لو مش هتغيّرها)" : ""}</label><input id="pf_key" type="password" placeholder="${p.id ? "••••••••" : ""}">
    <div class="modal-actions">
      <button class="btn" id="pf_cancel">إلغاء</button>
      <button class="btn btn-primary" id="pf_save">حفظ</button>
    </div>
  `;
}

document.getElementById("addProviderBtn").addEventListener("click", () => {
  openModal("مزوّد API جديد", providerForm());
  bindProviderForm(null);
});

document.getElementById("providersGrid").addEventListener("click", async e => {
  const card = e.target.closest(".product-card");
  if (!card) return;
  const id = card.dataset.id;
  const action = e.target.dataset.action;
  if (action === "delete") {
    if (!confirm("تأكيد حذف هذا المزوّد؟ منتجاته هتوقف عن الظهور في المتجر.")) return;
    try { await api(`providers?id=${id}`, { method: "DELETE" }); toast("تم الحذف ✅"); loadProviders(); }
    catch (err) { toast(err.message, "error"); }
    return;
  }
  if (action === "toggle") {
    const { providers } = await api("providers");
    const p = providers.find(x => String(x.id) === String(id));
    try { await api("providers", { method: "PATCH", body: { id, active: !p.active } }); toast("تم التحديث ✅"); loadProviders(); }
    catch (err) { toast(err.message, "error"); }
    return;
  }
  if (action === "edit") {
    const { providers } = await api("providers");
    const p = providers.find(x => String(x.id) === String(id));
    openModal("تعديل المزوّد", providerForm(p));
    bindProviderForm(id);
  }
});

function bindProviderForm(id) {
  document.getElementById("pf_cancel").addEventListener("click", closeModal);
  document.getElementById("pf_save").addEventListener("click", async () => {
    const name = document.getElementById("pf_name").value.trim();
    const base_url = document.getElementById("pf_url").value.trim();
    const api_key = document.getElementById("pf_key").value.trim();
    if (!name || !base_url || (!id && !api_key)) { toast("الاسم والرابط والمفتاح مطلوبين", "error"); return; }
    const body = { name, base_url };
    if (api_key) body.api_key = api_key;
    try {
      if (id) await api("providers", { method: "PATCH", body: { id, ...body } });
      else await api("providers", { method: "POST", body });
      toast("تم الحفظ ✅");
      closeModal();
      loadProviders();
    } catch (err) { toast(err.message, "error"); }
  });
}

// ---------- Dashboard ----------
async function loadDashboard() {
  const grid = document.getElementById("dashboardStats");
  grid.innerHTML = Array.from({ length: 6 }).map(() => `<div class="stat-card"><span class="skel" style="width:60%"></span><span class="skel" style="height:22px;margin-top:6px"></span></div>`).join("");
  try {
    const d = await api("dashboard");
    grid.innerHTML = `
      <div class="stat-card ${d.kokoroLow ? "danger" : "success"}"><div class="stat-top"><div class="label">رصيد KOKORO المسبق</div><div class="stat-icon">${ic("bank")}</div></div><div class="value">${d.kokoroBalance != null ? money(d.kokoroBalance) + " USDT" : "—"}</div>${d.kokoroError ? `<div class="muted" style="font-size:12px">${esc(d.kokoroError)}</div>` : (d.kokoroLow ? `<div style="font-size:12px;color:var(--danger);display:flex;align-items:center;gap:4px">${ic("warning", "icon icon-sm")} الرصيد منخفض، اشحن قريبًا</div>` : "")}</div>
      <div class="stat-card"><div class="stat-top"><div class="label">عدد العملاء</div><div class="stat-icon">${ic("users")}</div></div><div class="value">${d.usersCount}</div></div>
      <div class="stat-card"><div class="stat-top"><div class="label">إجمالي الطلبات</div><div class="stat-icon">${ic("receipt")}</div></div><div class="value">${d.ordersCount}</div></div>
      <div class="stat-card success"><div class="stat-top"><div class="label">الإيرادات (٩٠ يوم)</div><div class="stat-icon">${ic("wallet")}</div></div><div class="value">${money(d.revenue)} USDT</div></div>
      <div class="stat-card"><div class="stat-top"><div class="label">المنتجات المفعّلة</div><div class="stat-icon">${ic("box")}</div></div><div class="value">${d.activeProducts}</div></div>
      <div class="stat-card ${d.pendingDeliveries > 0 ? "warn" : ""}"><div class="stat-top"><div class="label">بانتظار تسليم يدوي</div><div class="stat-icon">${ic("clock")}</div></div><div class="value">${d.pendingDeliveries}</div></div>
    `;
    renderRevenueChart(d.chart || []);
    renderStatusBreakdown(d.statusCounts || {});
    renderMiniList("topProducts", (d.topProducts || []).map(p => ({ label: p.name, value: `${money(p.total)}$` })), "لا توجد مبيعات بعد.");
    renderMiniList("topCustomers", (d.topCustomers || []).map(c => ({ label: c.username ? "@" + c.username : `#${c.id}`, value: `${money(c.total)}$` })), "لا توجد مبيعات بعد.");

    const pb = document.getElementById("providerBalancesCard");
    if ((d.providerBalances || []).length > 1) {
      pb.classList.remove("hidden");
      renderMiniList("providerBalancesList", d.providerBalances.map(p => ({ label: p.name, value: p.balance != null ? `${money(p.balance)}$` : "—" })), "لا يوجد مزوّدين.");
    } else {
      pb.classList.add("hidden");
    }
  } catch (e) { grid.innerHTML = `<div class="stat-card"><div class="label">خطأ</div><div class="value" style="font-size:14px">${esc(e.message)}</div></div>`; }
}

function renderMiniList(elId, rows, emptyMsg) {
  const el = document.getElementById(elId);
  if (!rows.length) { el.innerHTML = `<div class="empty-state">${emptyMsg}</div>`; return; }
  el.innerHTML = rows.map((r, i) => `<div class="mini-list-row"><span class="rank">${i + 1}</span><span class="mn">${esc(r.label)}</span><span class="mv">${esc(r.value)}</span></div>`).join("");
}

function renderStatusBreakdown(counts) {
  const el = document.getElementById("statusBreakdown");
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const order = ["processing", "paid", "delivered", "cancelled"];
  el.innerHTML = order.map(s => {
    const c = counts[s] || 0;
    const pct = Math.round((c / total) * 100);
    return `<div class="status-row">
      <span style="width:90px">${STATUS_LABELS[s]}</span>
      <div class="bar-bg"><div class="bar-fg" style="width:${pct}%;background:${STATUS_COLOR[s]}"></div></div>
      <span style="width:34px;text-align:left">${c}</span>
    </div>`;
  }).join("");
}

function renderRevenueChart(points) {
  const el = document.getElementById("revenueChart");
  if (!points.length) { el.innerHTML = `<div class="empty-state">لا توجد بيانات مبيعات بعد.</div>`; return; }
  const w = Math.max(points.length * 34, 320), h = 160, padBottom = 20, padTop = 10;
  const max = Math.max(...points.map(p => p.revenue), 1);
  const barW = (w / points.length) * 0.6;
  const gap = (w / points.length) * 0.4;
  let bars = "", labels = "";
  points.forEach((p, i) => {
    const barH = Math.max((p.revenue / max) * (h - padBottom - padTop), p.revenue > 0 ? 3 : 0);
    const x = i * (barW + gap) + gap / 2;
    const y = h - padBottom - barH;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="3"><title>${p.date}: $${money(p.revenue)}</title></rect>`;
    if (i % Math.ceil(points.length / 7 || 1) === 0) {
      const day = p.date.slice(5);
      labels += `<text x="${(x + barW / 2).toFixed(1)}" y="${h - 4}" text-anchor="middle">${day}</text>`;
    }
  });
  el.innerHTML = `<svg class="bar-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${bars}${labels}</svg>`;
}

// ---------- Activity log ----------
async function loadActivity() {
  const el = document.getElementById("activityFeed");
  el.innerHTML = `<div class="empty-state">جارِ التحميل...</div>`;
  try {
    const { items } = await api("activity");
    if (!items.length) { el.innerHTML = `<div class="empty-state">لا يوجد نشاط مسجّل بعد.</div>`; return; }
    el.innerHTML = items.map(i => `<div class="activity-item">
      <div class="ai-icon">${ACTIVITY_ICONS[i.action] || "🔹"}</div>
      <div class="ai-body">
        <div>${esc(i.summary)}</div>
        <div class="ai-time">${timeAgo(i.created_at)} · ${fmtDate(i.created_at)}</div>
      </div>
    </div>`).join("");
  } catch (e) { el.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; }
}

// ---------- Broadcast ----------
document.getElementById("bcTarget").addEventListener("change", e => {
  document.getElementById("bcUserIdWrap").classList.toggle("hidden", e.target.value !== "user");
});
document.getElementById("bcSendBtn").addEventListener("click", async () => {
  const target = document.getElementById("bcTarget").value;
  const userId = document.getElementById("bcUserId").value.trim();
  const message = document.getElementById("bcMessage").value.trim();
  const resultEl = document.getElementById("bcResult");
  if (!message) { toast("الرسالة مطلوبة", "error"); return; }
  if (target === "user" && !userId) { toast("أدخل ID العميل", "error"); return; }

  let confirmMsg = target === "user" ? `تأكيد إرسال الرسالة للعميل ${userId}؟` : "تأكيد إرسال الرسالة لكل العملاء؟";
  if (target === "all") {
    try { const d = await api("broadcast"); confirmMsg = `تأكيد إرسال الرسالة لعدد ${d.usersCount} عميل؟`; } catch (e) {}
  }
  if (!confirm(confirmMsg)) return;

  resultEl.textContent = "جارِ الإرسال...";
  try {
    const r = await api("broadcast", { method: "POST", body: { message, target, userId } });
    if (target === "user") {
      resultEl.textContent = r.sent ? "✅ تم الإرسال بنجاح." : `❌ فشل الإرسال: ${(r.failed[0] || {}).error || ""}`;
    } else {
      resultEl.textContent = `✅ تم الإرسال إلى ${r.sent} من ${r.total} عميل.${r.failed.length ? ` (فشل: ${r.failed.length})` : ""}`;
    }
    toast("تم ✅");
  } catch (err) {
    resultEl.textContent = "";
    toast(err.message, "error");
  }
});

// ---------- Products (KOKORO) ----------
async function loadProducts() {
  const tbody = document.querySelector("#productsTable tbody");
  tbody.innerHTML = skeletonRows(10);
  selectedProductIds.clear();
  updateProductsBulkBar();
  try {
    const { products } = await api("products");
    currentProducts = products || [];
    renderProducts();
  } catch (e) { tbody.innerHTML = `<tr><td colspan="10">${esc(e.message)}</td></tr>`; }
}
function renderProducts() {
  const q = document.getElementById("productsSearch").value.trim().toLowerCase();
  const tbody = document.querySelector("#productsTable tbody");
  const rows = currentProducts.filter(p => !q || p.name.toLowerCase().includes(q) || (p.custom_name || "").toLowerCase().includes(q));
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state">لا توجد منتجات.</div></td></tr>`; return; }
  tbody.innerHTML = rows.map(p => {
    const isFixed = p.markup_type === "fixed";
    const clientPrice = isFixed ? Number(p.price || 0) + Number(p.markup || 0) : Number(p.price || 0) * (1 + Number(p.markup || 0) / 100);
    const lowStock = Number(p.stock) <= 3;
    return `<tr data-id="${esc(p.id)}">
      <td><input type="checkbox" class="row-select" ${selectedProductIds.has(String(p.id)) ? "checked" : ""}></td>
      <td class="muted">${esc(p.name)}</td>
      <td><input type="text" class="name-input" value="${esc(p.custom_name || "")}" placeholder="${esc(p.name)}" style="width:150px"></td>
      <td>${money(p.price)}</td>
      <td><b class="client-price-preview">${money(clientPrice)}</b></td>
      <td class="${lowStock ? "low-stock" : ""}">${p.stock}${lowStock ? " ⚠️" : ""}</td>
      <td>
        <div style="display:flex;gap:4px;align-items:center">
          <input type="number" class="markup-input" value="${p.markup}" step="0.5" style="width:60px">
          <select class="markup-type-input" style="width:56px;padding:4px">
            <option value="percent" ${!isFixed ? "selected" : ""}>%</option>
            <option value="fixed" ${isFixed ? "selected" : ""}>$</option>
          </select>
        </div>
      </td>
      <td><button class="switch ${p.enabled ? "on" : ""}" data-action="toggle" title="فعّل/عطّل المنتج فوراً"></button></td>
      <td><input type="text" class="emoji-input" value="${esc(p.emoji || "")}" placeholder="🙂" style="width:56px"></td>
      <td><button class="btn btn-sm btn-primary" data-action="save">حفظ</button></td>
    </tr>`;
  }).join("");
}
document.getElementById("productsSearch").addEventListener("input", renderProducts);

document.getElementById("productsSelectAll").addEventListener("change", e => {
  document.querySelectorAll("#productsTable .row-select").forEach(cb => {
    cb.checked = e.target.checked;
    const id = cb.closest("tr").dataset.id;
    if (e.target.checked) selectedProductIds.add(id); else selectedProductIds.delete(id);
  });
  updateProductsBulkBar();
});
document.querySelector("#productsTable tbody").addEventListener("change", e => {
  if (!e.target.classList.contains("row-select")) return;
  const id = e.target.closest("tr").dataset.id;
  if (e.target.checked) selectedProductIds.add(id); else selectedProductIds.delete(id);
  updateProductsBulkBar();
});
function updateProductsBulkBar() {
  const bar = document.getElementById("productsBulkBar");
  const n = selectedProductIds.size;
  bar.classList.toggle("hidden", n === 0);
  document.getElementById("productsBulkCount").textContent = n;
}
document.getElementById("productsBulkBar").addEventListener("click", async e => {
  const bulk = e.target.dataset.bulk;
  if (!bulk) return;
  const enabled = bulk === "enable";
  const ids = Array.from(selectedProductIds);
  try {
    await Promise.all(ids.map(id => api("products", { method: "PATCH", body: { id, enabled } })));
    toast(`تم ${enabled ? "تفعيل" : "إخفاء"} ${ids.length} منتج ✅`);
    loadProducts();
  } catch (err) { toast(err.message, "error"); }
});

document.querySelector("#productsTable tbody").addEventListener("click", async e => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const id = tr.dataset.id;
  if (e.target.dataset.action === "toggle") {
    const willEnable = !e.target.classList.contains("on");
    e.target.classList.toggle("on");
    e.target.disabled = true;
    try {
      await api("products", { method: "PATCH", body: { id, enabled: willEnable } });
      toast(willEnable ? "تم تفعيل المنتج ✅" : "تم إخفاء المنتج من البوت ✅");
      const p = currentProducts.find(x => String(x.id) === String(id));
      if (p) p.enabled = willEnable;
    } catch (err) {
      e.target.classList.toggle("on");
      toast(err.message, "error");
    } finally {
      e.target.disabled = false;
    }
    return;
  }
  if (e.target.dataset.action === "save") {
    const markup = tr.querySelector(".markup-input").value;
    const markup_type = tr.querySelector(".markup-type-input").value;
    const emoji = tr.querySelector(".emoji-input").value.trim();
    const custom_name = tr.querySelector(".name-input").value.trim();
    const enabled = tr.querySelector(".switch").classList.contains("on");
    try {
      await api("products", { method: "PATCH", body: { id, markup, markup_type, emoji, enabled, custom_name } });
      toast("تم الحفظ ✅");
      loadProducts();
    } catch (err) { toast(err.message, "error"); }
  }
});
document.querySelector("#productsTable tbody").addEventListener("input", e => {
  if (!e.target.classList.contains("markup-input")) return;
  updateClientPricePreview(e.target.closest("tr"));
});
document.querySelector("#productsTable tbody").addEventListener("change", e => {
  if (!e.target.classList.contains("markup-type-input")) return;
  updateClientPricePreview(e.target.closest("tr"));
});
function updateClientPricePreview(tr) {
  const id = tr.dataset.id;
  const p = currentProducts.find(x => String(x.id) === String(id));
  if (!p) return;
  const markup = Number(tr.querySelector(".markup-input").value || 0);
  const isFixed = tr.querySelector(".markup-type-input").value === "fixed";
  const clientPrice = isFixed ? Number(p.price || 0) + markup : Number(p.price || 0) * (1 + markup / 100);
  tr.querySelector(".client-price-preview").textContent = money(clientPrice);
}

// ---------- Manual products (card grid) ----------
async function loadManual() {
  const grid = document.getElementById("manualGrid");
  grid.innerHTML = Array.from({ length: 3 }).map(() => `<div class="product-card"><span class="skel" style="width:70%"></span><span class="skel" style="height:22px;margin-top:8px"></span><span class="skel" style="height:30px;margin-top:8px"></span></div>`).join("");
  try {
    const { products } = await api("products-manual");
    if (!products.length) { grid.innerHTML = `<div class="empty-state">لا توجد منتجات يدوية بعد. دوس "+ منتج جديد" للبدء.</div>`; return; }
    grid.innerHTML = products.map(p => `<div class="product-card" data-id="${p.id}">
      <div class="pc-head">
        <div class="pc-title">${p.emoji ? esc(p.emoji) + " " : ""}${esc(p.name)}</div>
        <span class="badge ${p.enabled ? "badge-green" : "badge-red"}">${p.enabled ? "مفعّل" : "معطّل"}</span>
      </div>
      <div class="pc-price">${money(p.price)} <span style="font-size:12px;color:var(--text-muted);font-weight:400">USDT</span></div>
      <div class="pc-meta">
        <span>📦 المخزون: <b class="${p.stock === 0 ? "low-stock" : ""}">${p.stock}</b></span>
        <span>الحد الأدنى: ${p.min_order}</span>
      </div>
      <div class="pc-actions">
        <button class="btn btn-sm" data-action="stock">المخزون</button>
        <button class="btn btn-sm" data-action="edit">تعديل</button>
        <button class="btn btn-sm btn-danger" data-action="delete">حذف</button>
      </div>
    </div>`).join("");
  } catch (e) { grid.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; }
}

function manualProductForm(p = {}) {
  const isNew = !p.id;
  return `
    <label>الاسم</label><input id="mf_name" value="${esc(p.name || "")}">
    <div class="field-row">
      <div><label>السعر (USDT)</label><input id="mf_price" type="number" step="0.01" value="${p.price ?? ""}"></div>
      <div><label>الحد الأدنى للطلب</label><input id="mf_min" type="number" value="${p.min_order ?? 1}"></div>
    </div>
    <div class="field-row">
      <div><label>إيموجي (اختياري)</label><input id="mf_emoji" value="${esc(p.emoji || "")}"></div>
      <div><label>مفعّل؟</label><select id="mf_enabled"><option value="true" ${p.enabled !== false ? "selected" : ""}>نعم</option><option value="false" ${p.enabled === false ? "selected" : ""}>لا</option></select></div>
    </div>
    <label>الوصف بالعربي (اختياري)</label><textarea id="mf_desc_ar">${esc(p.description_ar || "")}</textarea>
    <label>الوصف بالإنجليزي (اختياري)</label><textarea id="mf_desc_en">${esc(p.description_en || "")}</textarea>
    ${isNew ? `
    <label>أكواد/حسابات المخزون (سطر لكل وحدة — اختياري، تقدر تضيفها بعدين من زرار "المخزون")</label>
    <textarea id="mf_stock" placeholder="user1:pass1&#10;user2:pass2"></textarea>
    <label class="upload-txt-label" for="mf_stock_file">${ic("download", "icon icon-sm")} أو ارفع ملف TXT (سطر لكل وحدة)</label>
    <input type="file" id="mf_stock_file" accept=".txt,text/plain">
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text)">
      <input type="checkbox" id="mf_notify" checked style="width:auto"> إشعار كل العملاء بتوفر المنتج (لو فيه مخزون)
    </label>` : ""}
    <div class="modal-actions">
      <button class="btn" id="mf_cancel">إلغاء</button>
      <button class="btn btn-primary" id="mf_save">حفظ</button>
    </div>
  `;
}

// يقرأ ملف TXT ويحط محتواه (سطر لكل وحدة) في الـ textarea المحددة، بإضافة السطور
// لأي محتوى موجود بالفعل بدل ما يمسحه، عشان يقدر يضيف أكتر من ملف مع بعض.
function bindTxtUpload(fileInputId, textareaId) {
  const fileInput = document.getElementById(fileInputId);
  if (!fileInput) return;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const textarea = document.getElementById(textareaId);
      const existing = textarea.value.trim();
      const incoming = String(reader.result || "").trim();
      textarea.value = existing ? `${existing}\n${incoming}` : incoming;
      const lines = incoming.split(/\r?\n/).filter(l => l.trim()).length;
      toast(`تم استيراد ${lines} سطر من الملف ✅`);
      fileInput.value = "";
    };
    reader.onerror = () => toast("تعذر قراءة الملف", "error");
    reader.readAsText(file, "utf-8");
  });
}

document.getElementById("addManualBtn").addEventListener("click", () => {
  openModal("منتج يدوي جديد", manualProductForm());
  bindManualForm(null);
  bindTxtUpload("mf_stock_file", "mf_stock");
});

document.getElementById("manualGrid").addEventListener("click", async e => {
  const card = e.target.closest(".product-card");
  if (!card) return;
  const id = card.dataset.id;
  const action = e.target.dataset.action;
  if (action === "delete") {
    if (!confirm("تأكيد حذف هذا المنتج؟ سيتم حذف مخزونه أيضاً.")) return;
    try { await api(`products-manual?id=${id}`, { method: "DELETE" }); toast("تم الحذف ✅"); loadManual(); }
    catch (err) { toast(err.message, "error"); }
    return;
  }
  if (action === "edit") {
    const { products } = await api("products-manual");
    const p = products.find(x => String(x.id) === String(id));
    openModal("تعديل المنتج", manualProductForm(p));
    bindManualForm(id);
    return;
  }
  if (action === "stock") { openStockModal(id); }
});

function bindManualForm(id) {
  document.getElementById("mf_cancel").addEventListener("click", closeModal);
  document.getElementById("mf_save").addEventListener("click", async () => {
    const body = {
      name: document.getElementById("mf_name").value.trim(),
      price: document.getElementById("mf_price").value,
      min_order: document.getElementById("mf_min").value,
      emoji: document.getElementById("mf_emoji").value.trim(),
      enabled: document.getElementById("mf_enabled").value === "true",
      description_ar: document.getElementById("mf_desc_ar").value.trim(),
      description_en: document.getElementById("mf_desc_en").value.trim()
    };
    if (!body.name) { toast("الاسم مطلوب", "error"); return; }
    if (!id) {
      body.stock_lines = document.getElementById("mf_stock").value;
      body.notify = document.getElementById("mf_notify").checked;
    }
    try {
      let msg = "تم الحفظ ✅";
      if (id) {
        await api("products-manual", { method: "PATCH", body: { id, ...body } });
      } else {
        const r = await api("products-manual", { method: "POST", body });
        if (r.stockAdded) msg += ` — تمت إضافة ${r.stockAdded} وحدة مخزون`;
        if (r.broadcast) msg += ` وإشعار ${r.broadcast.sent}/${r.broadcast.total} عميل`;
        if (!r.stockAdded && body.stock_lines.trim()) msg = "تم إنشاء المنتج، لكن حصل خطأ في المخزون: " + (r.stockError || "");
      }
      toast(msg);
      closeModal();
      loadManual();
    } catch (err) { toast(err.message, "error"); }
  });
}

async function openStockModal(productId) {
  openModal("إدارة المخزون", `<div id="stockList" class="stock-list">جارِ التحميل...</div>
    <label>إضافة أكواد جديدة (سطر لكل كود)</label>
    <textarea id="stockNewLines" placeholder="user1:pass1&#10;user2:pass2"></textarea>
    <label class="upload-txt-label" for="stock_file">${ic("download", "icon icon-sm")} أو ارفع ملف TXT (سطر لكل وحدة)</label>
    <input type="file" id="stock_file" accept=".txt,text/plain">
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text)">
      <input type="checkbox" id="stockNotify" checked style="width:auto"> إشعار كل العملاء بتوفر مخزون جديد
    </label>
    <div class="modal-actions">
      <button class="btn" id="stock_cancel">إغلاق</button>
      <button class="btn btn-primary" id="stock_add">إضافة</button>
    </div>`);
  bindTxtUpload("stock_file", "stockNewLines");
  document.getElementById("stock_cancel").addEventListener("click", closeModal);
  document.getElementById("stock_add").addEventListener("click", async () => {
    const lines = document.getElementById("stockNewLines").value;
    const notify = document.getElementById("stockNotify").checked;
    if (!lines.trim()) return;
    try {
      const r = await api("stock-manual", { method: "POST", body: { product_id: productId, lines, notify } });
      toast(`تمت إضافة ${r.added} وحدة ✅${r.broadcast ? ` — تم إشعار ${r.broadcast.sent}/${r.broadcast.total} عميل` : ""}`);
      document.getElementById("stockNewLines").value = "";
      refreshStockList(productId);
      loadManual();
    } catch (err) { toast(err.message, "error"); }
  });
  refreshStockList(productId);
}
async function refreshStockList(productId) {
  const el = document.getElementById("stockList");
  if (!el) return;
  try {
    const { stock } = await api(`stock-manual?product_id=${productId}`);
    if (!stock.length) { el.innerHTML = `<div class="stock-list-item"><span class="muted">لا يوجد مخزون بعد.</span></div>`; return; }
    el.innerHTML = stock.map(s => `<div class="stock-list-item">
      <span title="${esc(s.content)}">${s.is_sold ? "✅ " : "🟢 "}${esc(s.content)}</span>
      ${s.is_sold ? "" : `<button class="btn btn-sm btn-danger" data-del="${s.id}">حذف</button>`}
    </div>`).join("");
    el.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        try { await api(`stock-manual?id=${btn.dataset.del}`, { method: "DELETE" }); refreshStockList(productId); loadManual(); }
        catch (err) { toast(err.message, "error"); }
      });
    });
  } catch (e) { el.innerHTML = `<div class="stock-list-item">${esc(e.message)}</div>`; }
}

// ---------- Users ----------
let usersDebounce;
async function loadUsers() {
  const tbody = document.querySelector("#usersTable tbody");
  tbody.innerHTML = skeletonRows(6);
  const q = document.getElementById("usersSearch").value.trim();
  try {
    const { users } = await api(`users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    if (!users.length) { tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">لا يوجد عملاء.</div></td></tr>`; return; }
    tbody.innerHTML = users.map(u => `<tr class="clickable" data-id="${u.id}">
      <td>${u.id}</td>
      <td>${u.username ? "@" + esc(u.username) : "-"}</td>
      <td>${u.language === "en" ? "English" : "العربية"}</td>
      <td><b>${money(u.balance)}</b> USDT</td>
      <td>${fmtDate(u.created_at)}</td>
      <td><button class="btn btn-sm btn-primary" data-action="adjust">تعديل الرصيد</button></td>
    </tr>`).join("");
  } catch (e) { tbody.innerHTML = `<tr><td colspan="6">${esc(e.message)}</td></tr>`; }
}
document.getElementById("usersSearch").addEventListener("input", () => { clearTimeout(usersDebounce); usersDebounce = setTimeout(loadUsers, 350); });
document.querySelector("#usersTable tbody").addEventListener("click", e => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const id = tr.dataset.id;
  if (e.target.dataset.action === "adjust") { openAdjustModal(id); return; }
  openUserDetail(id);
});

function openAdjustModal(id) {
  openModal(`تعديل رصيد العميل #${id}`, `
    <label>القيمة (استخدم سالب للخصم، مثال: -5)</label>
    <input id="adj_delta" type="number" step="0.01" placeholder="10">
    <label>السبب (اختياري)</label>
    <input id="adj_reason" placeholder="شحن يدوي...">
    <div class="modal-actions">
      <button class="btn" id="adj_cancel">إلغاء</button>
      <button class="btn btn-primary" id="adj_save">تأكيد</button>
    </div>
  `);
  document.getElementById("adj_cancel").addEventListener("click", closeModal);
  document.getElementById("adj_save").addEventListener("click", async () => {
    const delta = document.getElementById("adj_delta").value;
    const reason = document.getElementById("adj_reason").value.trim();
    if (!delta || Number.isNaN(Number(delta))) { toast("أدخل قيمة صحيحة", "error"); return; }
    try {
      const r = await api("users", { method: "PATCH", body: { id, delta, reason } });
      toast(r.notified ? "تم تحديث الرصيد وإشعار العميل ✅" : "تم تحديث الرصيد، لكن تعذر إشعار العميل ⚠️", r.notified ? "success" : "error");
      closeModal();
      loadUsers();
    } catch (err) { toast(err.message, "error"); }
  });
}

async function openUserDetail(id) {
  openModal(`العميل #${id}`, `<div class="empty-state">جارِ التحميل...</div>`, { large: true });
  try {
    const { user, orders, transactions } = await api(`users?detail=${id}`);
    const ordersRows = orders.length
      ? orders.slice(0, 10).map(o => `<tr><td>${orderCode(o.id)}</td><td>${esc(o.product_name || "-")}</td><td>${money(o.total)}</td><td><span class="badge ${STATUS_BADGE[o.status] || "badge-blue"}">${STATUS_LABELS[o.status] || o.status}</span></td><td>${fmtDate(o.created_at)}</td></tr>`).join("")
      : `<tr><td colspan="5" class="muted">لا توجد طلبات.</td></tr>`;
    const txRows = transactions.length
      ? transactions.slice(0, 10).map(t => `<tr><td>${esc(t.type)}</td><td style="color:${Number(t.amount) < 0 ? "var(--danger)" : "var(--success)"}">${Number(t.amount) > 0 ? "+" : ""}${money(t.amount)}</td><td>${esc(t.description || "-")}</td><td>${fmtDate(t.created_at)}</td></tr>`).join("")
      : `<tr><td colspan="4" class="muted">لا توجد معاملات.</td></tr>`;
    modalBody.innerHTML = `
      <div class="detail-grid">
        <div class="detail-item"><div class="di-label">اليوزر</div><div class="di-value">${user.username ? "@" + esc(user.username) : "-"}</div></div>
        <div class="detail-item"><div class="di-label">الرصيد</div><div class="di-value">${money(user.balance)} USDT</div></div>
        <div class="detail-item"><div class="di-label">اللغة</div><div class="di-value">${user.language === "en" ? "English" : "العربية"}</div></div>
        <div class="detail-item"><div class="di-label">تاريخ التسجيل</div><div class="di-value" style="font-size:12px">${fmtDate(user.created_at)}</div></div>
      </div>
      <div><b style="font-size:13px">آخر الطلبات</b></div>
      <table class="mini-table"><thead><tr><th>#</th><th>المنتج</th><th>المبلغ</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>${ordersRows}</tbody></table>
      <div><b style="font-size:13px">آخر المعاملات</b></div>
      <table class="mini-table"><thead><tr><th>النوع</th><th>المبلغ</th><th>الوصف</th><th>التاريخ</th></tr></thead><tbody>${txRows}</tbody></table>
      <div class="modal-actions">
        <button class="btn" id="ud_close">إغلاق</button>
        <button class="btn btn-primary" id="ud_adjust">تعديل الرصيد</button>
      </div>
    `;
    document.getElementById("ud_close").addEventListener("click", closeModal);
    document.getElementById("ud_adjust").addEventListener("click", () => openAdjustModal(id));
  } catch (e) { modalBody.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; }
}

// ---------- Orders ----------
let ordersDebounce;
async function loadOrders() {
  const tbody = document.querySelector("#ordersTable tbody");
  tbody.innerHTML = skeletonRows(9);
  const q = document.getElementById("ordersSearch").value.trim();
  const status = document.getElementById("ordersStatusFilter").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  document.getElementById("ordersExport").href = `/api/orders?format=csv${params.toString() ? "&" + params.toString() : ""}`;
  try {
    const { orders } = await api(`orders${params.toString() ? "?" + params.toString() : ""}`);
    if (!orders.length) { tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">لا توجد طلبات.</div></td></tr>`; return; }
    tbody.innerHTML = orders.map(o => `<tr class="clickable" data-id="${o.id}">
      <td><code>${orderCode(o.id)}</code></td>
      <td>${o.telegram_id}</td>
      <td>${esc(o.product_name || "-")}</td>
      <td>${o.quantity}</td>
      <td>${money(o.total)}</td>
      <td>${esc(o.payment_method || "-")}</td>
      <td><span class="badge ${STATUS_BADGE[o.status] || "badge-blue"}">${STATUS_LABELS[o.status] || o.status}</span></td>
      <td>${fmtDate(o.created_at)}</td>
      <td>
        ${o.status === "paid" ? `<button class="btn btn-sm btn-success" data-action="deliver">تسليم</button>` : ""}
        ${o.status !== "delivered" && o.status !== "cancelled" ? `<button class="btn btn-sm btn-danger" data-action="cancel">إلغاء</button>` : ""}
      </td>
    </tr>`).join("");
  } catch (e) { tbody.innerHTML = `<tr><td colspan="9">${esc(e.message)}</td></tr>`; }
}
document.getElementById("ordersSearch").addEventListener("input", () => { clearTimeout(ordersDebounce); ordersDebounce = setTimeout(loadOrders, 350); });
document.getElementById("ordersStatusFilter").addEventListener("change", loadOrders);
document.querySelector("#ordersTable tbody").addEventListener("click", async e => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const id = tr.dataset.id;
  const action = e.target.dataset.action;
  if (!action) { openOrderDetail(id); return; }
  if (action === "cancel") {
    if (!confirm("تأكيد إلغاء هذا الطلب؟")) return;
    try { await api("orders", { method: "PATCH", body: { id, action: "cancel" } }); toast("تم الإلغاء ✅"); loadOrders(); }
    catch (err) { toast(err.message, "error"); }
    return;
  }
  if (action === "deliver") { openDeliverModal(id); }
});

function openDeliverModal(id) {
  openModal(`تسليم الطلب ${orderCode(id)}`, `
    <label>المحتوى المُسلَّم للعميل (حساب/كود...)</label>
    <textarea id="dv_content" placeholder="user:pass"></textarea>
    <div class="modal-actions">
      <button class="btn" id="dv_cancel">إلغاء</button>
      <button class="btn btn-primary" id="dv_save">تسليم وإشعار العميل</button>
    </div>
  `);
  document.getElementById("dv_cancel").addEventListener("click", closeModal);
  document.getElementById("dv_save").addEventListener("click", async () => {
    const content = document.getElementById("dv_content").value.trim();
    if (!content) { toast("المحتوى مطلوب", "error"); return; }
    try {
      const r = await api("orders", { method: "PATCH", body: { id, action: "deliver", content } });
      toast(r.notified ? "تم التسليم وإشعار العميل ✅" : "تم التسليم، لكن تعذر إشعار العميل ⚠️", r.notified ? "success" : "error");
      closeModal();
      loadOrders();
    } catch (err) { toast(err.message, "error"); }
  });
}

async function openOrderDetail(id) {
  openModal(`تفاصيل الطلب ${orderCode(id)}`, `<div class="empty-state">جارِ التحميل...</div>`);
  try {
    const { order: o } = await api(`orders?detail=${id}`);
    modalBody.innerHTML = `
      <div class="detail-grid">
        <div class="detail-item"><div class="di-label">الحالة</div><div class="di-value"><span class="badge ${STATUS_BADGE[o.status] || "badge-blue"}">${STATUS_LABELS[o.status] || o.status}</span></div></div>
        <div class="detail-item"><div class="di-label">الإجمالي</div><div class="di-value">${money(o.total)} USDT</div></div>
        <div class="detail-item"><div class="di-label">العميل</div><div class="di-value">${o.telegram_id}</div></div>
        <div class="detail-item"><div class="di-label">الكمية</div><div class="di-value">${o.quantity}</div></div>
        <div class="detail-item"><div class="di-label">طريقة الدفع</div><div class="di-value">${esc(o.payment_method || "-")}</div></div>
        <div class="detail-item"><div class="di-label">المصدر</div><div class="di-value">${esc(o.source || "-")}</div></div>
        <div class="detail-item"><div class="di-label">تاريخ الإنشاء</div><div class="di-value" style="font-size:12px">${fmtDate(o.created_at)}</div></div>
        <div class="detail-item"><div class="di-label">تاريخ التسليم</div><div class="di-value" style="font-size:12px">${fmtDate(o.delivered_at)}</div></div>
      </div>
      <div><b style="font-size:13px">${esc(o.product_name || "-")}</b></div>
      ${o.delivery_message ? `<div class="detail-block">${esc(o.delivery_message)}</div>` : `<div class="muted" style="font-size:13px">لا يوجد محتوى تسليم مسجّل.</div>`}
      <div class="modal-actions">
        <button class="btn" id="od_close">إغلاق</button>
        ${o.status === "paid" ? `<button class="btn btn-primary" id="od_deliver">تسليم</button>` : ""}
      </div>
    `;
    document.getElementById("od_close").addEventListener("click", closeModal);
    const dBtn = document.getElementById("od_deliver");
    if (dBtn) dBtn.addEventListener("click", () => openDeliverModal(id));
  } catch (e) { modalBody.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; }
}

// ---------- Transactions ----------
async function loadTransactions() {
  const tbody = document.querySelector("#transactionsTable tbody");
  tbody.innerHTML = skeletonRows(5);
  try {
    const { transactions } = await api("transactions");
    if (!transactions.length) { tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">لا توجد معاملات.</div></td></tr>`; return; }
    tbody.innerHTML = transactions.map(t => `<tr>
      <td>${t.telegram_id}</td>
      <td>${esc(t.type)}</td>
      <td style="color:${Number(t.amount) < 0 ? "var(--danger)" : "var(--success)"}">${Number(t.amount) > 0 ? "+" : ""}${money(t.amount)}</td>
      <td>${esc(t.description || "-")}</td>
      <td>${fmtDate(t.created_at)}</td>
    </tr>`).join("");
  } catch (e) { tbody.innerHTML = `<tr><td colspan="5">${esc(e.message)}</td></tr>`; }
}

// ---------- Email activation list ----------
async function loadActivation() {
  const tbody = document.querySelector("#activationTable tbody");
  tbody.innerHTML = skeletonRows(2);
  try {
    const { items } = await api("email-activation");
    if (!items.length) { tbody.innerHTML = `<tr><td colspan="2"><div class="empty-state">لا توجد منتجات في هذه القائمة.</div></td></tr>`; return; }
    tbody.innerHTML = items.map(i => `<tr data-id="${i.id}">
      <td>${esc(i.name_contains)}</td>
      <td><button class="btn btn-sm btn-danger" data-action="delete">حذف</button></td>
    </tr>`).join("");
  } catch (e) { tbody.innerHTML = `<tr><td colspan="2">${esc(e.message)}</td></tr>`; }
}
document.getElementById("addActivationBtn").addEventListener("click", async () => {
  const input = document.getElementById("activationInput");
  const name = input.value.trim();
  if (!name) return;
  try { await api("email-activation", { method: "POST", body: { name_contains: name } }); input.value = ""; toast("تمت الإضافة ✅"); loadActivation(); }
  catch (err) { toast(err.message, "error"); }
});
document.querySelector("#activationTable tbody").addEventListener("click", async e => {
  if (e.target.dataset.action !== "delete") return;
  const id = e.target.closest("tr").dataset.id;
  try { await api(`email-activation?id=${id}`, { method: "DELETE" }); toast("تم الحذف ✅"); loadActivation(); }
  catch (err) { toast(err.message, "error"); }
});

// ---------- Init ----------
checkAuth();
