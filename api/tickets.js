// Tickets de soporte (problemas de ordenes reportados por clientes desde el bot).
const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");
const { sendTelegramMessage } = require("./_lib/telegram.js");
const { logActivity } = require("./_lib/activity.js");

module.exports = requireAuth(async (req, res) => {
  const supabase = getSupabase();

  if (req.method === "GET") {
    const status = String(req.query.status || "").trim();
    let query = supabase.from("support_tickets").select("*").order("created_at", { ascending: false }).limit(200);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ tickets: data });
  }

  if (req.method === "PATCH") {
    const { id, reply, close } = req.body || {};
    if (!id) return res.status(400).json({ error: "id requerido" });
    const { data: ticket, error: e1 } = await supabase.from("support_tickets").select("*").eq("id", id).maybeSingle();
    if (e1) return res.status(500).json({ error: e1.message });
    if (!ticket) return res.status(404).json({ error: "تذكرة غير موجودة" });

    const patch = {};
    if (reply !== undefined) patch.admin_reply = String(reply || "").trim() || null;
    if (close) { patch.status = "closed"; patch.resolved_at = new Date().toISOString(); }
    if (!Object.keys(patch).length) return res.status(400).json({ error: "nada que actualizar" });

    const { error: e2 } = await supabase.from("support_tickets").update(patch).eq("id", id);
    if (e2) return res.status(500).json({ error: e2.message });

    let notified = null;
    if (reply && String(reply).trim()) {
      const { data: userRow } = await supabase.from("users").select("language").eq("id", ticket.telegram_id).maybeSingle();
      const isAr = !userRow || userRow.language !== "en";
      const text = isAr
        ? `💬 <b>رد على بلاغك #${ticket.id}</b>\n\n${String(reply).trim()}`
        : `💬 <b>Reply to your report #${ticket.id}</b>\n\n${String(reply).trim()}`;
      const r = await sendTelegramMessage(ticket.telegram_id, text);
      notified = r.ok;
    }

    logActivity(supabase, close ? "ticket_close" : "ticket_reply", `${close ? "إغلاق" : "رد على"} تذكرة #${id}`, { id });
    return res.status(200).json({ ok: true, notified });
  }

  res.setHeader("Allow", "GET, PATCH");
  return res.status(405).json({ error: "method not allowed" });
});
