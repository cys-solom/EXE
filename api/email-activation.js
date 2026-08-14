// Lista de productos que piden correo/usuario en vez de entregarse solos (reemplaza /correos_add, /correos_list, /correos_del).
const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");

module.exports = requireAuth(async (req, res) => {
  const supabase = getSupabase();

  if (req.method === "GET") {
    const { data, error } = await supabase.from("email_activation_products").select("*").order("name_contains");
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ items: data });
  }

  if (req.method === "POST") {
    const name = String((req.body || {}).name_contains || "").trim();
    if (!name) return res.status(400).json({ error: "name_contains requerido" });
    const { error } = await supabase.from("email_activation_products").insert({ name_contains: name });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const id = req.query.id || (req.body || {}).id;
    if (!id) return res.status(400).json({ error: "id requerido" });
    const { error } = await supabase.from("email_activation_products").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ error: "method not allowed" });
});
