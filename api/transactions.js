const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");
const { toCsv, sendCsv } = require("./_lib/csv.js");

module.exports = requireAuth(async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }
  const supabase = getSupabase();
  const telegramId = req.query.telegram_id;
  let query = supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(200);
  if (telegramId) query = query.eq("telegram_id", telegramId);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  if (req.query.format === "csv") {
    const csv = toCsv(data || [], [
      { label: "ID", value: "id" }, { label: "Cliente", value: "telegram_id" },
      { label: "Tipo", value: "type" }, { label: "Monto", value: "amount" },
      { label: "Descripcion", value: "description" }, { label: "Fecha", value: "created_at" }
    ]);
    return sendCsv(res, "transacciones.csv", csv);
  }
  return res.status(200).json({ transactions: data });
});
