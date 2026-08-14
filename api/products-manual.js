// CRUD de productos propios del revendedor (tabla products_manual).
const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");
const { announceStock } = require("./_lib/announce.js");

module.exports = requireAuth(async (req, res) => {
  const supabase = getSupabase();

  if (req.method === "GET") {
    const { data, error } = await supabase.from("products_manual").select("*").order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    const ids = (data || []).map(p => p.id);
    const stockCounts = {};
    if (ids.length) {
      const { data: stockRows } = await supabase.from("stock_manual").select("product_id, is_sold").in("product_id", ids);
      (stockRows || []).forEach(r => {
        if (r.is_sold) return;
        stockCounts[r.product_id] = (stockCounts[r.product_id] || 0) + 1;
      });
    }
    const products = (data || []).map(p => ({ ...p, stock: stockCounts[p.id] || 0 }));
    return res.status(200).json({ products });
  }

  if (req.method === "POST") {
    const { name, price, min_order, enabled, emoji, description_ar, description_en, stock_lines, notify } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: "name requerido" });
    const { data, error } = await supabase.from("products_manual").insert({
      name: String(name).trim(),
      price: Number(price || 0),
      min_order: Number(min_order || 1),
      enabled: enabled !== false,
      emoji: emoji || null,
      description_ar: description_ar || null,
      description_en: description_en || null
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    // Sistema completo: si se pegaron cuentas/codigos al crear el producto, se cargan de una vez como stock.
    let added = 0;
    let broadcast = null;
    const lines = String(stock_lines || "").split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length) {
      const rows = lines.map(content => ({ product_id: data.id, content }));
      const { error: stockErr } = await supabase.from("stock_manual").insert(rows);
      if (stockErr) return res.status(200).json({ product: data, stockError: stockErr.message });
      added = rows.length;
      if (notify !== false) broadcast = await announceStock(supabase, data.name, data.emoji);
    }

    return res.status(200).json({ product: data, stockAdded: added, broadcast });
  }

  if (req.method === "PATCH") {
    const { id, ...fields } = req.body || {};
    if (!id) return res.status(400).json({ error: "id requerido" });
    const patch = {};
    ["name", "price", "min_order", "enabled", "emoji", "description_ar", "description_en"].forEach(k => {
      if (fields[k] !== undefined) patch[k] = fields[k];
    });
    if (patch.price !== undefined) patch.price = Number(patch.price);
    if (patch.min_order !== undefined) patch.min_order = Number(patch.min_order);
    if (!Object.keys(patch).length) return res.status(400).json({ error: "nada que actualizar" });
    const { error } = await supabase.from("products_manual").update(patch).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const id = req.query.id || (req.body || {}).id;
    if (!id) return res.status(400).json({ error: "id requerido" });
    const { error } = await supabase.from("products_manual").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ error: "method not allowed" });
});
