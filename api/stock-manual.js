// Stock (codigos/cuentas) de un producto manual: cada fila = 1 unidad entregable.
const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");
const { announceStock } = require("./_lib/announce.js");
const { logActivity } = require("./_lib/activity.js");

module.exports = requireAuth(async (req, res) => {
  const supabase = getSupabase();

  if (req.method === "GET") {
    const productId = req.query.product_id;
    if (!productId) return res.status(400).json({ error: "product_id requerido" });
    const { data, error } = await supabase.from("stock_manual").select("*").eq("product_id", productId).order("created_at");
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ stock: data });
  }

  if (req.method === "POST") {
    const { product_id, lines, notify } = req.body || {};
    if (!product_id || !lines) return res.status(400).json({ error: "product_id y lines requeridos" });
    const rows = String(lines).split("\n").map(l => l.trim()).filter(Boolean).map(content => ({ product_id, content }));
    if (!rows.length) return res.status(400).json({ error: "no hay lineas validas" });
    const { error } = await supabase.from("stock_manual").insert(rows);
    if (error) return res.status(500).json({ error: error.message });

    const { data: product } = await supabase.from("products_manual").select("id, name, emoji, price").eq("id", product_id).maybeSingle();
    let broadcast = null;
    if (notify !== false && product) broadcast = await announceStock(supabase, product);
    logActivity(supabase, "stock_add", `إضافة ${rows.length} وحدة مخزون لـ ${(product && product.name) || `#${product_id}`}`, { product_id, added: rows.length });

    return res.status(200).json({ ok: true, added: rows.length, broadcast });
  }

  if (req.method === "DELETE") {
    const id = req.query.id || (req.body || {}).id;
    if (!id) return res.status(400).json({ error: "id requerido" });
    const { error } = await supabase.from("stock_manual").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    logActivity(supabase, "stock_delete", `حذف وحدة مخزون #${id}`, { id });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ error: "method not allowed" });
});
