const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");
const { sendTelegramMessage } = require("./_lib/telegram.js");
const { logActivity } = require("./_lib/activity.js");
const { toCsv, sendCsv } = require("./_lib/csv.js");

function money(n) {
  return Number(n || 0).toFixed(2);
}

module.exports = requireAuth(async (req, res) => {
  const supabase = getSupabase();

  if (req.method === "GET") {
    const search = String(req.query.q || "").trim();
    let query = supabase
      .from("transactions")
      .select("*")
      .eq("type", "compensation")
      .order("created_at", { ascending: false })
      .limit(200);

    if (search) {
      const asNum = Number(search);
      if (!Number.isNaN(asNum) && search !== "") query = query.eq("telegram_id", asNum);
      else query = query.ilike("description", `%${search}%`);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    if (req.query.format === "csv") {
      const csv = toCsv(data || [], [
        { label: "Cliente", value: "telegram_id" },
        { label: "Amount", value: "amount" },
        { label: "Description", value: "description" },
        { label: "Created", value: "created_at" }
      ]);
      return sendCsv(res, "compensations.csv", csv);
    }

    return res.status(200).json({ compensations: data || [] });
  }

  if (req.method === "POST") {
    const { telegram_id, amount, reason, order_id, notify = true } = req.body || {};
    const id = Number(telegram_id);
    const value = Number(amount);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: "telegram_id مطلوب" });
    if (!value || Number.isNaN(value) || value <= 0) return res.status(400).json({ error: "amount يجب أن يكون أكبر من صفر" });

    const { data: user, error: userErr } = await supabase.from("users").select("balance, language").eq("id", id).maybeSingle();
    if (userErr) return res.status(500).json({ error: userErr.message });
    if (!user) return res.status(404).json({ error: "العميل غير موجود" });

    let order = null;
    if (order_id) {
      const { data: orderRow, error: orderErr } = await supabase
        .from("orders")
        .select("id, order_code, product_name, total, telegram_id")
        .eq("id", order_id)
        .maybeSingle();
      if (orderErr) return res.status(500).json({ error: orderErr.message });
      if (!orderRow) return res.status(404).json({ error: "الطلب غير موجود" });
      if (Number(orderRow.telegram_id) !== id) return res.status(400).json({ error: "الطلب لا يخص هذا العميل" });
      order = orderRow;
    }

    const newBalance = +(Number(user.balance || 0) + value).toFixed(2);
    const { error: updateErr } = await supabase.from("users").update({ balance: newBalance }).eq("id", id);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    const cleanReason = String(reason || "").trim();
    const description = [
      "تعويض خدمة عملاء",
      order ? `الطلب: ${order.order_code || `#${order.id}`}` : null,
      cleanReason || null
    ].filter(Boolean).join(" - ");

    const { error: txErr } = await supabase.from("transactions").insert({
      telegram_id: id,
      type: "compensation",
      amount: value,
      description
    });
    if (txErr) return res.status(500).json({ error: txErr.message });

    let notified = false;
    let notifyError = null;
    if (notify) {
      const isAr = user.language !== "en";
      const text = isAr
        ? `🎁 <b>تم إضافة تعويض إلى رصيدك</b>\n\nالمبلغ: <b>${money(value)} USDT</b>\nرصيدك الحالي: <b>${money(newBalance)} USDT</b>${cleanReason ? `\n\nالسبب: ${cleanReason}` : ""}`
        : `🎁 <b>A compensation was added to your balance</b>\n\nAmount: <b>${money(value)} USDT</b>\nCurrent balance: <b>${money(newBalance)} USDT</b>${cleanReason ? `\n\nReason: ${cleanReason}` : ""}`;
      const tgRes = await sendTelegramMessage(id, text);
      notified = tgRes.ok;
      notifyError = tgRes.error || null;
    }

    logActivity(supabase, "compensation_create", `تعويض ${money(value)} USDT للعميل #${id}`, {
      telegram_id: id,
      amount: value,
      order_id: order ? order.id : null,
      reason: cleanReason || null
    });

    return res.status(200).json({ ok: true, balance: newBalance, notified, notifyError });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method not allowed" });
});
