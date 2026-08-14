const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");
const { fetchKokoroBalance } = require("../services/kokoroApi.js");

module.exports = requireAuth(async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  const supabase = getSupabase();
  const [usersRes, ordersRes, revenueRes, productsRes, pendingRes, kokoro] = await Promise.all([
    supabase.from("users").select("*", { count: "exact", head: true }),
    supabase.from("orders").select("*", { count: "exact", head: true }),
    supabase.from("orders").select("total").eq("status", "delivered"),
    supabase.from("products").select("*", { count: "exact", head: true }).eq("enabled", true),
    supabase.from("orders").select("*", { count: "exact", head: true }).eq("status", "paid"),
    fetchKokoroBalance()
  ]);

  const revenue = (revenueRes.data || []).reduce((sum, r) => sum + Number(r.total || 0), 0);

  return res.status(200).json({
    usersCount: usersRes.count || 0,
    ordersCount: ordersRes.count || 0,
    revenue,
    activeProducts: productsRes.count || 0,
    pendingDeliveries: pendingRes.count || 0,
    kokoroBalance: kokoro.success ? kokoro.balance : null,
    kokoroError: kokoro.success ? null : kokoro.error
  });
});
