const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");
const { logActivity } = require("./_lib/activity.js");
const { syncProductsOnce } = require("../services/sync.js");

module.exports = requireAuth(async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  const supabase = getSupabase();
  const result = await syncProductsOnce(supabase);
  if (!result.success) return res.status(500).json({ error: result.error || "sync failed" });
  logActivity(supabase, "products_sync", `مزامنة المنتجات يدويا من لوحة الأدمن: ${result.count || 0} منتج`, result);
  return res.status(200).json({ ok: true, ...result });
});
