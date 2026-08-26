// CRUD de productos propios del revendedor (tabla products_manual).
const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");
const { announceStock } = require("./_lib/announce.js");
const { logActivity } = require("./_lib/activity.js");
const { toCsv, sendCsv } = require("./_lib/csv.js");

module.exports = requireAuth(async (req, res) => {
  const supabase = getSupabase();

  if (req.method === "GET") {
    let { data, error } = await supabase.from("products_manual").select("*").order("sort_order", { ascending: false }).order("created_at", { ascending: false });
    if (error && /sort_order/i.test(error.message || "")) {
      ({ data, error } = await supabase.from("products_manual").select("*").order("created_at", { ascending: false }));
    }
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
    if (req.query.format === "csv") {
      const csv = toCsv(products, [
        { label: "ID", value: "id" },
        { label: "Name", value: "name" },
        { label: "Price", value: "price" },
        { label: "Min Order", value: "min_order" },
        { label: "Stock", value: "stock" },
        { label: "Enabled", value: "enabled" },
        { label: "Sort Order", value: "sort_order" },
        { label: "Created", value: "created_at" }
      ]);
      return sendCsv(res, "manual-products.csv", csv);
    }
    return res.status(200).json({ products });
  }

  if (req.method === "POST") {
    const { name, price, min_order, enabled, emoji, description_ar, description_en, stock_lines, notify } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: "name requerido" });
    const insertRow = {
      name: String(name).trim(),
      price: Number(price || 0),
      min_order: Number(min_order || 1),
      enabled: enabled !== false,
      sort_order: Number((req.body || {}).sort_order || 0),
      emoji: emoji || null,
      description_ar: description_ar || null,
      description_en: description_en || null
    };
    let { data, error } = await supabase.from("products_manual").insert(insertRow).select().single();
    let warning = null;
    if (error && /sort_order/i.test(error.message || "")) {
      delete insertRow.sort_order;
      warning = "لم يتم حفظ الترتيب لأن عمود sort_order غير موجود. شغّل setup.sql في Supabase.";
      ({ data, error } = await supabase.from("products_manual").insert(insertRow).select().single());
    }
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
      if (notify !== false) broadcast = await announceStock(supabase, data);
    }

    logActivity(supabase, "manual_product_create", `منتج يدوي جديد: ${data.name}${added ? ` (+${added} مخزون)` : ""}`, { id: data.id });
    return res.status(200).json({ product: data, stockAdded: added, broadcast, warning });
  }

  if (req.method === "PATCH") {
    const { id, ids, ...fields } = req.body || {};
    const targetIds = Array.isArray(ids) && ids.length ? ids.map(String) : (id ? [String(id)] : []);
    if (!targetIds.length) return res.status(400).json({ error: "id requerido" });
    const patch = {};
    ["name", "price", "min_order", "enabled", "emoji", "description_ar", "description_en", "sort_order"].forEach(k => {
      if (fields[k] !== undefined) patch[k] = fields[k];
    });
    if (patch.price !== undefined) patch.price = Number(patch.price);
    if (patch.min_order !== undefined) patch.min_order = Number(patch.min_order);
    if (patch.sort_order !== undefined) patch.sort_order = Number(patch.sort_order || 0);
    if (!Object.keys(patch).length) return res.status(400).json({ error: "nada que actualizar" });
    let { error } = await supabase.from("products_manual").update(patch).in("id", targetIds);
    let warning = null;
    if (error && /sort_order/i.test(error.message || "") && patch.sort_order !== undefined) {
      delete patch.sort_order;
      if (!Object.keys(patch).length) {
        return res.status(400).json({ error: "شغّل setup.sql في Supabase أولا لإضافة sort_order قبل استخدام الترتيب." });
      }
      warning = "لم يتم حفظ الترتيب لأن عمود sort_order غير موجود. شغّل setup.sql في Supabase.";
      ({ error } = await supabase.from("products_manual").update(patch).in("id", targetIds));
    }
    if (error) return res.status(500).json({ error: error.message });
    logActivity(supabase, targetIds.length > 1 ? "manual_product_bulk_update" : "manual_product_update",
      targetIds.length > 1 ? `تعديل جماعي لمنتجات يدوية: ${targetIds.length}` : `تعديل منتج يدوي: ${patch.name || `#${id}`}`,
      { ids: targetIds, patch });
    return res.status(200).json({ ok: true, updated: targetIds.length, warning });
  }

  if (req.method === "DELETE") {
    const id = req.query.id || (req.body || {}).id;
    if (!id) return res.status(400).json({ error: "id requerido" });
    const { data: before } = await supabase.from("products_manual").select("name").eq("id", id).maybeSingle();
    const { error } = await supabase.from("products_manual").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    logActivity(supabase, "manual_product_delete", `حذف منتج يدوي: ${(before && before.name) || `#${id}`}`, { id });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ error: "method not allowed" });
});
