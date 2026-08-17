// Clientes de la tienda: lista/busqueda y ajuste manual de balance.
const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");
const { sendTelegramMessage } = require("./_lib/telegram.js");
const { logActivity } = require("./_lib/activity.js");
const { toCsv, sendCsv } = require("./_lib/csv.js");

module.exports = requireAuth(async (req, res) => {
  const supabase = getSupabase();

  if (req.method === "GET") {
    // ?detail=<id> -> perfil completo con historial de ordenes y transacciones (para el modal de detalle)
    if (req.query.detail) {
      const id = req.query.detail;
      const [{ data: user }, { data: orders }, { data: transactions }] = await Promise.all([
        supabase.from("users").select("*").eq("id", id).maybeSingle(),
        supabase.from("orders").select("*").eq("telegram_id", id).order("created_at", { ascending: false }).limit(50),
        supabase.from("transactions").select("*").eq("telegram_id", id).order("created_at", { ascending: false }).limit(50)
      ]);
      if (!user) return res.status(404).json({ error: "usuario no encontrado" });
      return res.status(200).json({ user, orders: orders || [], transactions: transactions || [] });
    }

    const search = String(req.query.q || "").trim();
    let query = supabase.from("users").select("*").order("created_at", { ascending: false }).limit(200);
    if (search) {
      const asNum = Number(search);
      query = !Number.isNaN(asNum) && search !== "" ? query.eq("id", asNum) : query.ilike("username", `%${search}%`);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    if (req.query.format === "csv") {
      const csv = toCsv(data || [], [
        { label: "ID", value: "id" }, { label: "Usuario", value: "username" },
        { label: "Idioma", value: "language" }, { label: "Balance", value: "balance" },
        { label: "Fecha de registro", value: "created_at" }
      ]);
      return sendCsv(res, "clientes.csv", csv);
    }
    return res.status(200).json({ users: data });
  }

  if (req.method === "PATCH") {
    const { id, delta, reason } = req.body || {};
    if (!id || delta === undefined || Number.isNaN(Number(delta))) {
      return res.status(400).json({ error: "id y delta (numero) requeridos" });
    }
    const { data: user, error: e1 } = await supabase.from("users").select("balance, language").eq("id", id).maybeSingle();
    if (e1) return res.status(500).json({ error: e1.message });
    if (!user) return res.status(404).json({ error: "usuario no encontrado" });

    const newBalance = +(Number(user.balance || 0) + Number(delta)).toFixed(2);
    if (newBalance < 0) return res.status(400).json({ error: "el balance resultante no puede ser negativo" });

    const { error: e2 } = await supabase.from("users").update({ balance: newBalance }).eq("id", id);
    if (e2) return res.status(500).json({ error: e2.message });

    await supabase.from("transactions").insert({
      telegram_id: id,
      type: "manual_adjust",
      amount: Number(delta),
      description: reason || "Ajuste manual desde el panel admin"
    });

    const isAr = user.language !== "en";
    const d = Number(delta);
    const text = d >= 0
      ? (isAr
        ? `💰 <b>تم إضافة ${d.toFixed(2)} USDT إلى رصيدك</b>\n\nرصيدك الحالي: <b>${newBalance.toFixed(2)} USDT</b>`
        : `💰 <b>${d.toFixed(2)} USDT has been added to your balance</b>\n\nYour current balance: <b>${newBalance.toFixed(2)} USDT</b>`)
      : (isAr
        ? `💰 <b>تم خصم ${Math.abs(d).toFixed(2)} USDT من رصيدك</b>\n\nرصيدك الحالي: <b>${newBalance.toFixed(2)} USDT</b>`
        : `💰 <b>${Math.abs(d).toFixed(2)} USDT has been deducted from your balance</b>\n\nYour current balance: <b>${newBalance.toFixed(2)} USDT</b>`);
    const tgRes = await sendTelegramMessage(id, text);
    logActivity(supabase, "balance_adjust", `${d >= 0 ? "إضافة" : "خصم"} ${Math.abs(d).toFixed(2)} USDT ${d >= 0 ? "لـ" : "من"} العميل #${id}`, { id, delta: d, reason: reason || null });

    return res.status(200).json({ ok: true, balance: newBalance, notified: tgRes.ok, notifyError: tgRes.error || null });
  }

  res.setHeader("Allow", "GET, PATCH");
  return res.status(405).json({ error: "method not allowed" });
});
