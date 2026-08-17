// Anuncia a todos los clientes que hay stock nuevo disponible para un producto,
// con un formato vistoso (insignia + nombre en negrita + stock + precio) y un
// boton que los lleva directo a la tienda del bot.
const { broadcastMessage } = require("./telegram.js");

async function announceStock(supabase, product) {
  const { data: users } = await supabase.from("users").select("id, language");
  if (!users || !users.length) return { sent: 0, total: 0 };

  const icon = product.emoji || "📦";
  const priceLine = product.price != null ? `\n💵 السعر: من <b>${Number(product.price).toFixed(2)} USDT</b>` : "";
  const priceLineEn = product.price != null ? `\n💵 Price: from <b>${Number(product.price).toFixed(2)} USDT</b>` : "";
  const shopBtn = { inline_keyboard: [[{ text: "🛍 افتح المتجر", callback_data: "shop" }]] };
  const shopBtnEn = { inline_keyboard: [[{ text: "🛍 Open Shop", callback_data: "shop" }]] };

  const textAr = `🔥 <b>مخزون جديد!</b>\n\n${icon} <b>${product.name}</b>${priceLine}\n\n✅ متوفر الآن في المتجر`;
  const textEn = `🔥 <b>New Stock!</b>\n\n${icon} <b>${product.name}</b>${priceLineEn}\n\n✅ Available now in the store`;

  const arIds = users.filter(u => u.language !== "en").map(u => u.id);
  const enIds = users.filter(u => u.language === "en").map(u => u.id);
  const [rAr, rEn] = await Promise.all([
    arIds.length ? broadcastMessage(arIds, textAr, { reply_markup: shopBtn }) : { sent: 0, failed: [] },
    enIds.length ? broadcastMessage(enIds, textEn, { reply_markup: shopBtnEn }) : { sent: 0, failed: [] }
  ]);
  return { sent: rAr.sent + rEn.sent, total: users.length };
}

module.exports = { announceStock };
