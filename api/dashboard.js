const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");
const { fetchKokoroBalance } = require("../services/kokoroApi.js");
const { getActiveProviders } = require("../services/sync.js");

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

  const [usersRes, ordersRes, deliveredRes, productsRes, pendingRes, openTicketsRes, manualProductsRes, compensationRes, statusCounts, providers] = await Promise.all([
    supabase.from("users").select("*", { count: "exact", head: true }),
    supabase.from("orders").select("*", { count: "exact", head: true }),
    supabase.from("orders").select("total, product_name, telegram_id, created_at").eq("status", "delivered").gte("created_at", since),
    supabase.from("products").select("*", { count: "exact", head: true }).eq("enabled", true),
    supabase.from("orders").select("*", { count: "exact", head: true }).eq("status", "paid"),
    supabase.from("support_tickets").select("*", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("products_manual").select("id, name"),
    supabase.from("transactions").select("amount").eq("type", "compensation").gte("created_at", since),
    Promise.all(["processing", "paid", "delivered", "cancelled"].map(s =>
      supabase.from("orders").select("*", { count: "exact", head: true }).eq("status", s).then(r => [s, r.count || 0])
    )),
    getActiveProviders(supabase)
  ]);

  const providerBalances = await Promise.all(providers.map(async p => {
    const bal = await fetchKokoroBalance(p);
    return { name: p.name, balance: bal.success ? bal.balance : null, error: bal.success ? null : bal.error };
  }));

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

  const knownBalances = providerBalances.filter(p => p.balance != null);
  const kokoroBalance = knownBalances.length ? knownBalances.reduce((s, p) => s + p.balance, 0) : null;
  const kokoroLow = knownBalances.some(p => p.balance < LOW_BALANCE_THRESHOLD);
  const kokoroError = providerBalances.length === 1 && providerBalances[0].error ? providerBalances[0].error : null;
  let lowManualStock = 0;
  const manualIds = (manualProductsRes.data || []).map(p => p.id);
  if (manualIds.length) {
    const { data: stockRows } = await supabase.from("stock_manual").select("product_id, is_sold").in("product_id", manualIds);
    const stockByProduct = {};
    (stockRows || []).forEach(r => {
      if (!r.is_sold) stockByProduct[r.product_id] = (stockByProduct[r.product_id] || 0) + 1;
    });
    lowManualStock = manualIds.filter(id => Number(stockByProduct[id] || 0) <= 3).length;
  }
  const compensationTotal = (compensationRes.data || []).reduce((sum, r) => sum + Number(r.amount || 0), 0);

  return res.status(200).json({
    usersCount: usersRes.count || 0,
    ordersCount: ordersRes.count || 0,
    revenue,
    activeProducts: productsRes.count || 0,
    pendingDeliveries: pendingRes.count || 0,
    openTickets: openTicketsRes.count || 0,
    lowManualStock,
    compensationTotal,
    kokoroBalance,
    kokoroLow,
    kokoroError,
    providerBalances,
    statusCounts: Object.fromEntries(statusCounts),
    chart,
    topProducts,
    topCustomers
  });
});
