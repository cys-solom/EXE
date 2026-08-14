// Anuncia a todos los clientes que hay stock nuevo disponible para un producto.
const { broadcastMessage } = require("./telegram.js");

async function announceStock(supabase, name, emoji) {
  const { data: users } = await supabase.from("users").select("id, language");
  if (!users || !users.length) return { sent: 0, total: 0 };
  const icon = emoji || "📦";
  const arIds = users.filter(u => u.language !== "en").map(u => u.id);
  const enIds = users.filter(u => u.language === "en").map(u => u.id);
  const [rAr, rEn] = await Promise.all([
    arIds.length ? broadcastMessage(arIds, `${icon} <b>تم إضافة مخزون جديد!</b>\n\n${name} متوفر الآن في المتجر ✅`) : { sent: 0, failed: [] },
    enIds.length ? broadcastMessage(enIds, `${icon} <b>New stock added!</b>\n\n${name} is now available in the store ✅`) : { sent: 0, failed: [] }
  ]);
  return { sent: rAr.sent + rEn.sent, total: users.length };
}

module.exports = { announceStock };
