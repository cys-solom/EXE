const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");
const { fetchKokoroBalance } = require("../services/kokoroApi.js");

const CHART_DAYS = 14;
const LOW_BALANCE_THRESHOLD = 10; // USDT — debajo de esto se marca como "bajo" en el dashboard

function dayKey(d) {
  return new Date(d).toISOString().slice(0, 10); // YYYY-MM-DD
}

module.exports = requireAuth(async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  const supabase = getSupabase();
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();

  const [usersRes, ordersRes, deliveredRes, productsRes, pendingRes, statusCounts, kokoro] = await Promise.all([
    supabase.from("users").select("*", { count: "exact", head: true }),
    supabase.from("orders").select("*", { count: "exact", head: true }),
    supabase.from("orders").select("total, product_name, telegram_id, created_at").eq("status", "delivered").gte("created_at", since),
    supabase.from("products").select("*", { count: "exact", head: true }).eq("enabled", true),
    supabase.from("orders").select("*", { count: "exact", head: true }).eq("status", "paid"),
    Promise.all(["processing", "paid", "delivered", "cancelled"].map(s =>
      supabase.from("orders").select("*", { count: "exact", head: true }).eq("status", s).then(r => [s, r.count || 0])
    )),
    fetchKokoroBalance()
  ]);

  const delivered = deliveredRes.data || [];
  const revenue = delivered.reduce((sum, r) => sum + Number(r.total || 0), 0);

  // Serie de ingresos por dia (ultimos CHART_DAYS dias, con ceros donde no hubo ventas).
  const byDay = {};
  delivered.forEach(o => {
    const k = dayKey(o.created_at);
    byDay[k] = (byDay[k] || 0) + Number(o.total || 0);
  });
  const chart = [];
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000);
    const k = dayKey(d);
    chart.push({ date: k, revenue: +(byDay[k] || 0).toFixed(2) });
  }

  // Top 5 productos por ingresos.
  const byProduct = {};
  delivered.forEach(o => {
    const name = o.product_name || "—";
    byProduct[name] = (byProduct[name] || 0) + Number(o.total || 0);
  });
  const topProducts = Object.entries(byProduct)
    .map(([name, total]) => ({ name, total: +total.toFixed(2) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // Top 5 clientes por gasto.
  const byCustomer = {};
  delivered.forEach(o => {
    const id = o.telegram_id;
    byCustomer[id] = (byCustomer[id] || 0) + Number(o.total || 0);
  });
  const topCustomerIds = Object.entries(byCustomer).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
  let topCustomers = [];
  if (topCustomerIds.length) {
    const { data: usersData } = await supabase.from("users").select("id, username").in("id", topCustomerIds);
    const usernameById = {};
    (usersData || []).forEach(u => { usernameById[u.id] = u.username; });
    topCustomers = topCustomerIds.map(id => ({
      id, username: usernameById[id] || null, total: +byCustomer[id].toFixed(2)
    }));
  }

  const kokoroBalance = kokoro.success ? kokoro.balance : null;

  return res.status(200).json({
    usersCount: usersRes.count || 0,
    ordersCount: ordersRes.count || 0,
    revenue,
    activeProducts: productsRes.count || 0,
    pendingDeliveries: pendingRes.count || 0,
    kokoroBalance,
    kokoroLow: kokoroBalance != null && kokoroBalance < LOW_BALANCE_THRESHOLD,
    kokoroError: kokoro.success ? null : kokoro.error,
    statusCounts: Object.fromEntries(statusCounts),
    chart,
    topProducts,
    topCustomers
  });
});
