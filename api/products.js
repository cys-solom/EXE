// Productos sincronizados desde KOKORO. Solo se pueden editar: markup, enabled, emoji, custom_name.
const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");
const { logActivity } = require("./_lib/activity.js");
const { toCsv, sendCsv } = require("./_lib/csv.js");

module.exports = requireAuth(async (req, res) => {
  const supabase = getSupabase();

  if (req.method === "GET") {
    const { data, error } = await supabase.from("products").select("*").order("name");
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
        { label: "Updated", value: "updated_at" }
      ]);
      return sendCsv(res, "kokoro-products.csv", csv);
    }
    return res.status(200).json({ products: data });
  }

  if (req.method === "PATCH") {
    const { id, markup, markup_type, enabled, emoji, custom_name } = req.body || {};
    if (!id) return res.status(400).json({ error: "id requerido" });
    const patch = {};
    if (markup !== undefined) patch.markup = Number(markup);
    if (markup_type !== undefined) patch.markup_type = markup_type === "fixed" ? "fixed" : "percent";
    if (enabled !== undefined) patch.enabled = !!enabled;
    if (emoji !== undefined) patch.emoji = emoji || null;
    if (custom_name !== undefined) patch.custom_name = String(custom_name || "").trim() || null;
    if (!Object.keys(patch).length) return res.status(400).json({ error: "nada que actualizar" });
    const { data: before } = await supabase.from("products").select("name, custom_name").eq("id", id).maybeSingle();
    const { error } = await supabase.from("products").update(patch).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    const label = (before && (before.custom_name || before.name)) || id;
    if (patch.enabled !== undefined) {
      logActivity(supabase, "product_toggle", `${patch.enabled ? "تفعيل" : "إخفاء"} منتج KOKORO: ${label}`, { id });
    } else {
      logActivity(supabase, "product_update", `تعديل منتج KOKORO: ${label}`, { id, patch });
    }
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, PATCH");
  return res.status(405).json({ error: "method not allowed" });
});
