// Productos sincronizados desde KOKORO. Solo se pueden editar: markup, enabled, emoji, custom_name.
const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");
const { logActivity } = require("./_lib/activity.js");
const { toCsv, sendCsv } = require("./_lib/csv.js");

module.exports = requireAuth(async (req, res) => {
  const supabase = getSupabase();

  if (req.method === "GET") {
    let { data, error } = await supabase.from("products").select("*").order("sort_order", { ascending: false }).order("name");
    if (error && /sort_order/i.test(error.message || "")) {
      ({ data, error } = await supabase.from("products").select("*").order("name"));
    }
    if (error) return res.status(500).json({ error: error.message });
    if (req.query.format === "csv") {
      const csv = toCsv(data || [], [
        { label: "ID", value: "id" },
        { label: "Provider", value: "provider_id" },
        { label: "Name", value: "name" },
        { label: "Display Name", value: "custom_name" },
        { label: "Base Price", value: "price" },
        { label: "Markup", value: "markup" },
        { label: "Markup Type", value: "markup_type" },
        { label: "Stock", value: "stock" },
        { label: "Enabled", value: "enabled" },
        { label: "Sort Order", value: "sort_order" },
        { label: "Updated", value: "updated_at" }
      ]);
      return sendCsv(res, "kokoro-products.csv", csv);
    }
    return res.status(200).json({ products: data });
  }

  if (req.method === "PATCH") {
    const { id, ids, markup, markup_type, enabled, emoji, custom_name, sort_order } = req.body || {};
    const targetIds = Array.isArray(ids) && ids.length ? ids.map(String) : (id ? [String(id)] : []);
    if (!targetIds.length) return res.status(400).json({ error: "id requerido" });
    const patch = {};
    if (markup !== undefined) patch.markup = Number(markup);
    if (markup_type !== undefined) patch.markup_type = markup_type === "fixed" ? "fixed" : "percent";
    if (enabled !== undefined) patch.enabled = !!enabled;
    if (emoji !== undefined) patch.emoji = emoji || null;
    if (custom_name !== undefined) patch.custom_name = String(custom_name || "").trim() || null;
    if (sort_order !== undefined) patch.sort_order = Number(sort_order || 0);
    if (!Object.keys(patch).length) return res.status(400).json({ error: "nada que actualizar" });
    const { data: beforeRows } = await supabase.from("products").select("id, name, custom_name").in("id", targetIds);
    let { error } = await supabase.from("products").update(patch).in("id", targetIds);
    let warning = null;
    if (error && /sort_order/i.test(error.message || "") && patch.sort_order !== undefined) {
      delete patch.sort_order;
      if (!Object.keys(patch).length) {
        return res.status(400).json({ error: "شغّل setup.sql في Supabase أولا لإضافة sort_order قبل استخدام الترتيب." });
      }
      warning = "لم يتم حفظ الترتيب لأن عمود sort_order غير موجود. شغّل setup.sql في Supabase.";
      ({ error } = await supabase.from("products").update(patch).in("id", targetIds));
    }
    if (error) return res.status(500).json({ error: error.message });
    const label = targetIds.length === 1
      ? ((beforeRows && beforeRows[0] && (beforeRows[0].custom_name || beforeRows[0].name)) || targetIds[0])
      : `${targetIds.length} products`;
    if (targetIds.length > 1) {
      logActivity(supabase, "product_bulk_update", `تعديل جماعي لمنتجات KOKORO: ${label}`, { ids: targetIds, patch });
    } else if (patch.enabled !== undefined) {
      logActivity(supabase, "product_toggle", `${patch.enabled ? "تفعيل" : "إخفاء"} منتج KOKORO: ${label}`, { id });
    } else {
      logActivity(supabase, "product_update", `تعديل منتج KOKORO: ${label}`, { id, patch });
    }
    return res.status(200).json({ ok: true, updated: targetIds.length, warning });
  }

  res.setHeader("Allow", "GET, PATCH");
  return res.status(405).json({ error: "method not allowed" });
});
