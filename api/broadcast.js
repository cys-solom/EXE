// Envia un mensaje manual a todos los clientes o a un cliente especifico.
const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");
const { sendTelegramMessage, broadcastMessage } = require("./_lib/telegram.js");
const { logActivity } = require("./_lib/activity.js");

module.exports = requireAuth(async (req, res) => {
  const supabase = getSupabase();

  if (req.method === "GET") {
    const { count } = await supabase.from("users").select("*", { count: "exact", head: true });
    return res.status(200).json({ usersCount: count || 0 });
  }

  if (req.method === "POST") {
    const { message, target, userId } = req.body || {};
    const text = String(message || "").trim();
    if (!text) return res.status(400).json({ error: "الرسالة مطلوبة" });

    if (target === "user") {
      if (!userId) return res.status(400).json({ error: "id العميل مطلوب" });
      const r = await sendTelegramMessage(userId, text);
      logActivity(supabase, "broadcast_single", `رسالة للعميل #${userId}`, { userId, ok: r.ok });
      return res.status(200).json({ ok: r.ok, sent: r.ok ? 1 : 0, failed: r.ok ? [] : [{ id: userId, error: r.error }] });
    }

    const { data: users, error } = await supabase.from("users").select("id");
    if (error) return res.status(500).json({ error: error.message });
    const ids = (users || []).map(u => u.id);
    const result = await broadcastMessage(ids, text);
    logActivity(supabase, "broadcast_all", `بث رسالة لكل العملاء (${result.sent}/${ids.length})`, { sent: result.sent, total: ids.length });
    return res.status(200).json({ ok: true, total: ids.length, sent: result.sent, failed: result.failed });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method not allowed" });
});
