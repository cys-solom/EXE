// Envia un mensaje al cliente por Telegram (usado al entregar una orden manual desde el panel).
async function sendTelegramMessage(chatId, text) {
  const token = process.env.BOT_TOKEN;
  if (!token) return { ok: false, error: "BOT_TOKEN no configurado" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });
    const json = await res.json().catch(() => ({}));
    if (!json.ok) return { ok: false, error: json.description || `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Notifica al grupo de logs del admin (mismo grupo que usa el bot: ADMIN_LOG_GROUP).
async function notifyAdmin(text) {
  const group = process.env.ADMIN_LOG_GROUP;
  if (!group) return { ok: false, error: "ADMIN_LOG_GROUP no configurado" };
  return sendTelegramMessage(group, text);
}

// Envia el mismo texto a una lista de chat ids, con una pequeña pausa entre cada uno
// para no pasarnos del limite de Telegram (~30 msj/seg). Devuelve cuantos se enviaron bien.
async function broadcastMessage(chatIds, text) {
  let sent = 0;
  const failed = [];
  for (const id of chatIds) {
    const r = await sendTelegramMessage(id, text);
    if (r.ok) sent++;
    else failed.push({ id, error: r.error });
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return { sent, failed };
}

module.exports = { sendTelegramMessage, notifyAdmin, broadcastMessage };
