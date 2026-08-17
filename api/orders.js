// Lista/filtra ordenes y permite entregar manualmente o cancelar desde el panel.
const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");
const { sendTelegramMessage, sendTelegramDocument, notifyAdmin } = require("./_lib/telegram.js");
const { logActivity } = require("./_lib/activity.js");
const { toCsv, sendCsv } = require("./_lib/csv.js");

function orderCode(order) { return order.order_code || `EXE-${String(order.id).padStart(6, "0")}`; }

module.exports = requireAuth(async (req, res) => {
  const supabase = getSupabase();

  if (req.method === "GET") {
    if (req.query.detail) {
      const { data: order, error } = await supabase.from("orders").select("*").eq("id", req.query.detail).maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!order) return res.status(404).json({ error: "orden no encontrada" });
      return res.status(200).json({ order });
    }
    const status = String(req.query.status || "").trim();
    const search = String(req.query.q || "").trim();
    let query = supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(200);
    if (status) query = query.eq("status", status);
    if (search) {
      const asNum = Number(search);
      const codeGuess = search.toUpperCase().replace(/^EXE-?/, "");
      query = !Number.isNaN(asNum) && search !== ""
        ? query.or(`id.eq.${asNum},telegram_id.eq.${asNum}`)
        : query.or(`product_name.ilike.%${search}%,order_code.ilike.%${codeGuess}%`);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    if (req.query.format === "csv") {
      const csv = toCsv(data || [], [
        { label: "ID", value: "id" }, { label: "Codigo", value: r => orderCode(r) }, { label: "Cliente", value: "telegram_id" },
        { label: "Producto", value: "product_name" }, { label: "Cantidad", value: "quantity" },
        { label: "Total", value: "total" }, { label: "Metodo de pago", value: "payment_method" },
        { label: "Estado", value: "status" }, { label: "Fecha", value: "created_at" }
      ]);
      return sendCsv(res, "ordenes.csv", csv);
    }
    return res.status(200).json({ orders: data });
  }

  if (req.method === "PATCH") {
    const { id, action, content } = req.body || {};
    if (!id || !action) return res.status(400).json({ error: "id y action requeridos" });

    const { data: order, error: e1 } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
    if (e1) return res.status(500).json({ error: e1.message });
    if (!order) return res.status(404).json({ error: "orden no encontrada" });

    if (action === "deliver") {
      const body = String(content || "").trim();
      if (!body) return res.status(400).json({ error: "contenido de entrega requerido" });

      const { data: userRow } = await supabase.from("users").select("language").eq("id", order.telegram_id).maybeSingle();
      const isAr = !userRow || userRow.language !== "en";

      const { error: e2 } = await supabase.from("orders").update({
        status: "delivered",
        delivery_message: body,
        delivered_at: new Date().toISOString()
      }).eq("id", id);
      if (e2) return res.status(500).json({ error: e2.message });

      const text = isAr
        ? `✅ <b>تم تسليم طلبك!</b>\n\n📦 ${order.product_name}\n🧾 الطلب <code>${orderCode(order)}</code>\n💰 ${Number(order.total || 0).toFixed(2)} USDT\n\n${body}`
        : `✅ <b>Your order has been delivered!</b>\n\n📦 ${order.product_name}\n🧾 Order <code>${orderCode(order)}</code>\n💰 ${Number(order.total || 0).toFixed(2)} USDT\n\n${body}`;
      const tgRes = await sendTelegramMessage(order.telegram_id, text);
      sendTelegramDocument(order.telegram_id, `${orderCode(order)}.txt`, body).catch(() => {});
      notifyAdmin(`✅ <b>ENTREGA MANUAL (panel admin)</b>\n\n📦 ${order.product_name} x${order.quantity}\n🧾 #${order.id}\n👤 ${order.telegram_id}`).catch(() => {});
      logActivity(supabase, "order_deliver", `تسليم الطلب #${order.id} (${order.product_name}) للعميل #${order.telegram_id}`, { id: order.id });
      return res.status(200).json({ ok: true, notified: tgRes.ok, notifyError: tgRes.error || null });
    }

    if (action === "cancel") {
      const { error: e2 } = await supabase.from("orders").update({ status: "cancelled" }).eq("id", id);
      if (e2) return res.status(500).json({ error: e2.message });

      const { data: userRow } = await supabase.from("users").select("language").eq("id", order.telegram_id).maybeSingle();
      const isAr = !userRow || userRow.language !== "en";
      const text = isAr
        ? `❌ <b>تم إلغاء طلبك</b>\n\n📦 ${order.product_name}\n🧾 الطلب <code>${orderCode(order)}</code>\n\nتواصل مع الدعم لو عندك أي استفسار.`
        : `❌ <b>Your order has been cancelled</b>\n\n📦 ${order.product_name}\n🧾 Order <code>${orderCode(order)}</code>\n\nContact support if you have any questions.`;
      const tgRes = await sendTelegramMessage(order.telegram_id, text);
      notifyAdmin(`❌ <b>ORDEN CANCELADA (panel admin)</b>\n\n📦 ${order.product_name} x${order.quantity}\n🧾 #${order.id}\n👤 ${order.telegram_id}`).catch(() => {});
      logActivity(supabase, "order_cancel", `إلغاء الطلب #${order.id} (${order.product_name})`, { id: order.id });
      return res.status(200).json({ ok: true, notified: tgRes.ok, notifyError: tgRes.error || null });
    }

    return res.status(400).json({ error: "action desconocida" });
  }

  res.setHeader("Allow", "GET, PATCH");
  return res.status(405).json({ error: "method not allowed" });
});
