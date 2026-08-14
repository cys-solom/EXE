// ============================================================
//  لوحة تحكم المتجر — واجهة (SPA بدون مكتبات خارجية)
// ============================================================
const STATUS_LABELS = { processing: "قيد المعالجة", paid: "مدفوع", delivered: "تم التسليم", cancelled: "ملغي" };
const STATUS_BADGE = { processing: "badge-blue", paid: "badge-yellow", delivered: "badge-green", cancelled: "badge-red" };

let currentProducts = []; // كاش لآخر منتجات KOKORO محمّلة (لحساب سعر العميل)

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
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function money(n) { return Number(n || 0).toFixed(2); }
function fmtDate(d) { if (!d) return "-"; const dt = new Date(d); return dt.toLocaleDateString("ar-EG") + " " + dt.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }); }

// ---------- Modal ----------
const modalOverlay = document.getElementById("modalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
function openModal(title, bodyHtml) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
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
  dashboard: "لوحة التحكم", broadcast: "بث رسالة", products: "منتجات KOKORO", manual: "منتجاتي اليدوية",
  users: "المستخدمين", orders: "الطلبات", transactions: "المعاملات", activation: "التفعيل بالبريد"
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
    dashboard: loadDashboard, products: loadProducts, manual: loadManual,
    users: loadUsers, orders: loadOrders, transactions: loadTransactions, activation: loadActivation
  };
  (loaders[tab] || (() => {}))();
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

// ---------- Dashboard ----------
async function loadDashboard() {
  const grid = document.getElementById("dashboardStats");
  grid.innerHTML = `<div class="stat-card"><div class="label">جارِ التحميل...</div></div>`;
  try {
    const d = await api("dashboard");
    grid.innerHTML = `
      <div class="stat-card"><div class="label">رصيد KOKORO المسبق</div><div class="value">${d.kokoroBalance != null ? money(d.kokoroBalance) + " USDT" : "—"}</div>${d.kokoroError ? `<div class="muted" style="font-size:12px;margin-top:6px">${esc(d.kokoroError)}</div>` : ""}</div>
      <div class="stat-card"><div class="label">عدد العملاء</div><div class="value">${d.usersCount}</div></div>
      <div class="stat-card"><div class="label">إجمالي الطلبات</div><div class="value">${d.ordersCount}</div></div>
      <div class="stat-card"><div class="label">الإيرادات (المُسلَّمة)</div><div class="value">${money(d.revenue)} USDT</div></div>
      <div class="stat-card"><div class="label">المنتجات المفعّلة</div><div class="value">${d.activeProducts}</div></div>
      <div class="stat-card ${d.pendingDeliveries > 0 ? "warn" : ""}"><div class="label">بانتظار تسليم يدوي</div><div class="value">${d.pendingDeliveries}</div></div>
    `;
  } catch (e) { grid.innerHTML = `<div class="stat-card"><div class="label">خطأ</div><div class="value" style="font-size:14px">${esc(e.message)}</div></div>`; }
}

// ---------- Products (KOKORO) ----------
async function loadProducts() {
  const tbody = document.querySelector("#productsTable tbody");
  tbody.innerHTML = `<tr><td colspan="9">جارِ التحميل...</td></tr>`;
  try {
    const { products } = await api("products");
    currentProducts = products || [];
    renderProducts();
  } catch (e) { tbody.innerHTML = `<tr><td colspan="9">${esc(e.message)}</td></tr>`; }
}
function renderProducts() {
  const q = document.getElementById("productsSearch").value.trim().toLowerCase();
  const tbody = document.querySelector("#productsTable tbody");
  const rows = currentProducts.filter(p => !q || p.name.toLowerCase().includes(q) || (p.custom_name || "").toLowerCase().includes(q));
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="9">لا توجد منتجات.</td></tr>`; return; }
  tbody.innerHTML = rows.map(p => {
    const isFixed = p.markup_type === "fixed";
    const clientPrice = isFixed ? Number(p.price || 0) + Number(p.markup || 0) : Number(p.price || 0) * (1 + Number(p.markup || 0) / 100);
    return `<tr data-id="${esc(p.id)}">
      <td class="muted">${esc(p.name)}</td>
      <td><input type="text" class="name-input" value="${esc(p.custom_name || "")}" placeholder="${esc(p.name)}" style="width:160px"></td>
      <td>${money(p.price)}</td>
      <td><b class="client-price-preview">${money(clientPrice)}</b></td>
      <td>${p.stock}</td>
      <td>
        <div style="display:flex;gap:4px;align-items:center">
          <input type="number" class="markup-input" value="${p.markup}" step="0.5" style="width:65px">
          <select class="markup-type-input" style="width:60px;padding:4px">
            <option value="percent" ${!isFixed ? "selected" : ""}>%</option>
            <option value="fixed" ${isFixed ? "selected" : ""}>$</option>
          </select>
        </div>
      </td>
      <td><button class="switch ${p.enabled ? "on" : ""}" data-action="toggle" title="فعّل/عطّل المنتج فوراً"></button></td>
      <td><input type="text" class="emoji-input" value="${esc(p.emoji || "")}" placeholder="🙂" style="width:60px"></td>
      <td><button class="btn btn-sm btn-primary" data-action="save">حفظ</button></td>
    </tr>`;
  }).join("");
}
document.getElementById("productsSearch").addEventListener("input", renderProducts);
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
      e.target.classList.toggle("on"); // رجّع الحالة القديمة لو فشل الحفظ
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

// ---------- Manual products ----------
async function loadManual() {
  const tbody = document.querySelector("#manualTable tbody");
  tbody.innerHTML = `<tr><td colspan="6">جارِ التحميل...</td></tr>`;
  try {
    const { products } = await api("products-manual");
    if (!products.length) { tbody.innerHTML = `<tr><td colspan="6">لا توجد منتجات يدوية بعد.</td></tr>`; return; }
    tbody.innerHTML = products.map(p => `<tr data-id="${p.id}">
      <td>${p.emoji ? esc(p.emoji) + " " : ""}${esc(p.name)}</td>
      <td>${money(p.price)}</td>
      <td>${p.min_order}</td>
      <td>${p.stock}</td>
      <td><span class="badge ${p.enabled ? "badge-green" : "badge-red"}">${p.enabled ? "مفعّل" : "معطّل"}</span></td>
      <td>
        <button class="btn btn-sm" data-action="stock">المخزون</button>
        <button class="btn btn-sm" data-action="edit">تعديل</button>
        <button class="btn btn-sm btn-danger" data-action="delete">حذف</button>
      </td>
    </tr>`).join("");
  } catch (e) { tbody.innerHTML = `<tr><td colspan="6">${esc(e.message)}</td></tr>`; }
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
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text)">
      <input type="checkbox" id="mf_notify" checked style="width:auto"> إشعار كل العملاء بتوفر المنتج (لو فيه مخزون)
    </label>` : ""}
    <div class="modal-actions">
      <button class="btn" id="mf_cancel">إلغاء</button>
      <button class="btn btn-primary" id="mf_save">حفظ</button>
    </div>
  `;
}

document.getElementById("addManualBtn").addEventListener("click", () => {
  openModal("منتج يدوي جديد", manualProductForm());
  bindManualForm(null);
});

document.querySelector("#manualTable tbody").addEventListener("click", async e => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const id = tr.dataset.id;
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
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text)">
      <input type="checkbox" id="stockNotify" checked style="width:auto"> إشعار كل العملاء بتوفر مخزون جديد
    </label>
    <div class="modal-actions">
      <button class="btn" id="stock_cancel">إغلاق</button>
      <button class="btn btn-primary" id="stock_add">إضافة</button>
    </div>`);
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
  tbody.innerHTML = `<tr><td colspan="6">جارِ التحميل...</td></tr>`;
  const q = document.getElementById("usersSearch").value.trim();
  try {
    const { users } = await api(`users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    if (!users.length) { tbody.innerHTML = `<tr><td colspan="6">لا يوجد عملاء.</td></tr>`; return; }
    tbody.innerHTML = users.map(u => `<tr data-id="${u.id}">
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
  if (e.target.dataset.action !== "adjust") return;
  const id = e.target.closest("tr").dataset.id;
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
});

// ---------- Orders ----------
let ordersDebounce;
async function loadOrders() {
  const tbody = document.querySelector("#ordersTable tbody");
  tbody.innerHTML = `<tr><td colspan="9">جارِ التحميل...</td></tr>`;
  const q = document.getElementById("ordersSearch").value.trim();
  const status = document.getElementById("ordersStatusFilter").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  try {
    const { orders } = await api(`orders${params.toString() ? "?" + params.toString() : ""}`);
    if (!orders.length) { tbody.innerHTML = `<tr><td colspan="9">لا توجد طلبات.</td></tr>`; return; }
    tbody.innerHTML = orders.map(o => `<tr data-id="${o.id}">
      <td>#${o.id}</td>
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
  const action = e.target.dataset.action;
  if (!action) return;
  const id = e.target.closest("tr").dataset.id;
  if (action === "cancel") {
    if (!confirm("تأكيد إلغاء هذا الطلب؟")) return;
    try { await api("orders", { method: "PATCH", body: { id, action: "cancel" } }); toast("تم الإلغاء ✅"); loadOrders(); }
    catch (err) { toast(err.message, "error"); }
    return;
  }
  if (action === "deliver") {
    openModal(`تسليم الطلب #${id}`, `
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
});

// ---------- Transactions ----------
async function loadTransactions() {
  const tbody = document.querySelector("#transactionsTable tbody");
  tbody.innerHTML = `<tr><td colspan="5">جارِ التحميل...</td></tr>`;
  try {
    const { transactions } = await api("transactions");
    if (!transactions.length) { tbody.innerHTML = `<tr><td colspan="5">لا توجد معاملات.</td></tr>`; return; }
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
  tbody.innerHTML = `<tr><td colspan="2">جارِ التحميل...</td></tr>`;
  try {
    const { items } = await api("email-activation");
    if (!items.length) { tbody.innerHTML = `<tr><td colspan="2">لا توجد منتجات في هذه القائمة.</td></tr>`; return; }
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
