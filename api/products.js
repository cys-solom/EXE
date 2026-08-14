// Productos sincronizados desde KOKORO. Solo se pueden editar: markup, enabled, emoji, custom_name.
const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");

module.exports = requireAuth(async (req, res) => {
  const supabase = getSupabase();

  if (req.method === "GET") {
    const { data, error } = await supabase.from("products").select("*").order("name");
    if (error) return res.status(500).json({ error: error.message });
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
    const { error } = await supabase.from("products").update(patch).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, PATCH");
  return res.status(405).json({ error: "method not allowed" });
});
