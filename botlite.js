// ============================================================
//  KOKORO SHOP LITE — Bot principal
//  Revendedor de la API KOKORO. Flujo de compra IDENTICO al bot principal.
// ============================================================
require("dotenv").config();

// IMPORTANTE: hay que definir WebSocket ANTES de cargar Supabase.
// Con Node 20 o inferior no existe WebSocket nativo y Supabase falla con
// "Node.js detected but native WebSocket not found". Con Node 22+ ya existe
// y este bloque no hace nada, asi que es seguro en cualquier version.
if (typeof globalThis.WebSocket === "undefined") {
  try {
    globalThis.WebSocket = require("ws");
  } catch (e) {
    console.warn("[WS] No se pudo cargar 'ws'. Si usas Node 20 o inferior, ejecuta: npm install ws");
  }
}

const TelegramBot = require("node-telegram-bot-api");
const { createClient } = require("@supabase/supabase-js");

const { fetchKokoroBalance, purchaseKokoro, defaultProviderFromEnv } = require("./services/kokoroApi.js");
const { productIcon, productTextEmoji } = require("./services/emojis.js");
const { startProductSync, getActiveProviders } = require("./services/sync.js");
const payments = require("./services/payments.js");

const REQUIRED = ["BOT_TOKEN", "SUPABASE_URL", "SUPABASE_KEY", "KOKORO_API_KEY"];
for (const k of REQUIRED) {
  if (!process.env[k]) { console.error(`FALTA en .env: ${k}`); process.exit(1); }
}

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ADMIN_LOG_GROUP = process.env.ADMIN_LOG_GROUP || null;

// ============================================================
//  Red de seguridad para produccion (Railway u otro host 24/7):
//  un solo error de red/Supabase/Telegram en cualquier handler async
//  NO debe tumbar el proceso entero. Se loguea y el bot sigue vivo.
// ============================================================
process.on("unhandledRejection", err => {
  console.error("[UNHANDLED REJECTION]", err && err.message ? err.message : err);
});
process.on("uncaughtException", err => {
  console.error("[UNCAUGHT EXCEPTION]", err && err.message ? err.message : err);
});
bot.on("polling_error", err => {
  console.error("[POLLING ERROR]", err && err.message ? err.message : err);
});
const SHOP_NAME = process.env.SHOP_NAME || "KOKORO SHOP";
const BEP20_WALLET = process.env.BEP20_WALLET || "";

global.usernames = {};
global.usernameSynced = {};
global.sessions = {};
// Clientes a los que se les esta pidiendo el correo/usuario para activar.
global.emailSessions = {};
// Cache de la lista de productos que piden correo (tabla email_activation_products)
global.emailActivationList = [];
global.emailActivationListTime = 0;

// ============================================================
//  Helpers UI
// ============================================================
const ICON = k => process.env[`ICON_${k}`] || null;
const tg = (emoji, id) => id ? `<tg-emoji emoji-id="${id}">${emoji}</tg-emoji>` : emoji;
const money = n => Number(n || 0).toFixed(2);
function htmlEscape(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function stockEmoji(stock) { return Number(stock) > 5 ? "🟢" : (Number(stock) > 0 ? "🟡" : "🔴"); }

// ============================================================
//  Canal obligatorio (OPCIONAL).
//  Si CHANNEL_URL en el .env está vacío -> NO se exige unirse (sin bloqueo).
//  Deriva el identificador para getChatMember desde la URL del canal.
// ============================================================
function getChannelCheckId() {
  const url = String(process.env.CHANNEL_URL || "").trim();
  if (!url) return null;                       // sin canal -> no exigir
  if (url.startsWith("@")) return url;         // ya es @usuario
  if (/^-?\d+$/.test(url)) return Number(url); // ya es un ID numérico
  const m = url.match(/t\.me\/([A-Za-z0-9_]+)\/?$/i);
  if (m) return "@" + m[1];                    // https://t.me/usuario -> @usuario
  return null;                                 // enlace privado (+/joinchat): no verificable por URL
}

async function isUserInChannel(userId) {
  const channelId = getChannelCheckId();
  if (!channelId) return true;                 // no configurado -> permitir
  try {
    const member = await bot.getChatMember(channelId, userId);
    return member.status !== "left" && member.status !== "kicked";
  } catch (err) {
    // fail-open: si el bot no es admin del canal u otro error, NO bloquear a los clientes
    console.warn("[CANAL] No se pudo verificar membresía (¿el bot es admin del canal?):", err.message);
    return true;
  }
}

async function showJoinChannelGate(chatId, lang, messageId = null) {
  const isAr = lang === "ar";
  const url = String(process.env.CHANNEL_URL || "").trim();
  const text = isAr
    ? `${tg("❌", ICON("CANCEL"))} <b>انضم لقناتنا أولاً حتى تتمكن من استخدام هذا البوت</b>\n\n${tg("⚡", ICON("LIGHTNING"))} اضغط على "الذهاب إلى القناة"، انضم، ثم عد إلى هنا واضغط "لقد انضممت".`
    : `${tg("❌", ICON("CANCEL"))} <b>Join our channel first to be able to use this bot</b>\n\n${tg("⚡", ICON("LIGHTNING"))} Click "Go to channel", join, then come back here and press "I joined".`;
  const kb = [
    [styledUrlButton(isAr ? "الذهاب إلى القناة" : "Go to channel", url, "primary", ICON("HOME"))],
    [styledButton(isAr ? "✅ لقد انضممت" : "✅ I joined", "check_channel", "success", ICON("LIGHTNING"))]
  ];
  return editOrSend(chatId, messageId, text, kb);
}

// Productos de API TOKENS: se agrupan en su propia categoría dentro de la tienda.
// Se detectan por nombre ("API 100M Token Codex 7D (FW)").
function isApiTokenProduct(p) {
  const n = String(p?.name || "").toLowerCase();
  return /^api\s/.test(n) && n.includes("token");
}

// Productos CURSOR: se agrupan en su propia categoria.
function isCursorProduct(p) {
  return String(p?.name || "").toLowerCase().includes("cursor");
}

// Marcas que se agrupan en su propia categoria.
function isDisneyProduct(p) {
  return String(p?.name || "").toLowerCase().includes("disney");
}
function isSpotifyProduct(p) {
  return String(p?.name || "").toLowerCase().includes("spotify");
}
function isYoutubeProduct(p) {
  const n = String(p?.name || "").toLowerCase();
  if (n.includes("gmail")) return false;   // "Gmail ... trial youtube" es un Gmail
  return n.includes("youtube");
}
function isPrimeVideoProduct(p) {
  const n = String(p?.name || "").toLowerCase();
  return n.includes("prime video") || (n.includes("prime") && n.includes("amazon"));
}
function isLovableProduct(p) {
  return String(p?.name || "").toLowerCase().includes("lovable");
}
function isNotionProduct(p) {
  return String(p?.name || "").toLowerCase().includes("notion");
}
function isFollowersProduct(p) {
  return String(p?.name || "").toLowerCase().includes("followers");
}
function isFollowersIgProduct(p) {
  const n = String(p?.name || "").toLowerCase();
  if (!n.includes("followers")) return false;
  return n.includes("instagram") || /\big\b/.test(n);
}
function isFollowersTtProduct(p) {
  const n = String(p?.name || "").toLowerCase();
  if (!n.includes("followers")) return false;
  return n.includes("tiktok") || n.includes("tik tok") || /\btt\b/.test(n);
}

// Productos ADOBE: se agrupan en su propia categoria (Creative Cloud).
function isAdobeProduct(p) {
  const n = String(p?.name || "").toLowerCase();
  return n.includes("adobe");
}

// Productos MICROSOFT: se agrupan en su propia categoria (365, Azure).
function isMicrosoftProduct(p) {
  const n = String(p?.name || "").toLowerCase();
  return n.includes("microsoft") || n.includes("azure") || n.includes("office 365");
}

// Bonus por recarga (igual al bot principal): +2% desde $50, +5% desde $100
function topupBonus(amount) {
  const paid = Number(amount || 0);
  if (paid >= 100) return { percent: 5, credit: +(paid * 1.05).toFixed(2) };
  if (paid >= 50) return { percent: 2, credit: +(paid * 1.02).toFixed(2) };
  return { percent: 0, credit: +paid.toFixed(2) };
}

// Envuelve cada producto/linea entregada en un blockquote (quote visual) — igual al bot principal
function formatDeliveredProducts(content) {
  if (!content) return "";
  const parts = String(content)
    .replace(/\r\n/g, "\n")
    .split(/(?:\n{2,}|━{5,}|-{5,}|_{5,}|={5,})/g)
    .map(x => x.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    return String(content)
      .replace(/\r\n/g, "\n")
      .split(/[\n\t]+/g)
      .map(x => x.trim())
      .filter(Boolean)
      .map(item => `<blockquote>${htmlEscape(item)}</blockquote>`)
      .join("\n\n");
  }
  return parts.map(item => `<blockquote>${htmlEscape(item)}</blockquote>`).join("\n\n");
}

function styledButton(text, callback_data, style = "success", icon_custom_emoji_id = null) {
  const button = { text, callback_data };
  if (style) button.style = style;
  if (icon_custom_emoji_id) button.icon_custom_emoji_id = String(icon_custom_emoji_id);
  return button;
}
function styledUrlButton(text, url, style = "success", icon_custom_emoji_id = null) {
  const button = { text, url };
  if (style) button.style = style;
  if (icon_custom_emoji_id) button.icon_custom_emoji_id = String(icon_custom_emoji_id);
  return button;
}

async function sendAdminLog(text) {
  if (!ADMIN_LOG_GROUP) return;
  try { await bot.sendMessage(ADMIN_LOG_GROUP, text, { parse_mode: "HTML" }); }
  catch (e) { console.log("[LOG] no enviado:", e.message); }
}

// ============================================================
//  ACTIVACION POR CORREO / USUARIO
//  Productos que en vez de entregarse solos piden un dato al cliente
//  (correo, dominio o @usuario) para activarlos a mano.
//  La lista vive en la tabla `email_activation_products` (columna
//  name_contains) y se administra con /correos_add, /correos_list
//  y /correos_del.
// ============================================================

// Normaliza para comparar: minusculas y sin espacios de sobra.
function normProdName(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

async function loadEmailActivationList(force = false) {
  if (!force && global.emailActivationListTime && (Date.now() - global.emailActivationListTime) < 60000) {
    return global.emailActivationList;
  }
  try {
    const { data, error } = await supabase.from("email_activation_products").select("name_contains");
    if (!error) {
      global.emailActivationList = (data || []).map(r => normProdName(r.name_contains)).filter(Boolean);
      global.emailActivationListTime = Date.now();
    } else {
      console.log("[EMAIL-ACT] No se pudo leer email_activation_products:", error.message);
    }
  } catch (e) {
    console.log("[EMAIL-ACT] Error:", e.message);
  }
  return global.emailActivationList;
}

// Coincidencia EXACTA por nombre completo, para no confundir productos
// con nombres parecidos (igual criterio que el bot principal).
async function productNeedsEmail(productName) {
  const list = await loadEmailActivationList();
  return list.includes(normProdName(productName));
}

// Que dato se le pide segun el producto.
function tipoDatoActivacion(productName) {
  const n = String(productName || "").toLowerCase();
  if (n.includes("followers") || n.includes("instagram") || n.includes("tiktok") ||
      n.includes("seguidores") || n.includes("likes") || n.includes("views")) return "usuario";
  if (n.includes("adobe") || n.includes("photoshop")) return "adobe";
  return "correo";
}

// Texto que se le muestra al cliente para pedirle el dato.
function textoPedirDato(productName, lang) {
  const ar = lang === "ar";
  const tipo = tipoDatoActivacion(productName);

  if (tipo === "usuario") {
    const red = /tiktok|tik tok/i.test(productName) ? "TikTok" : "Instagram";
    return ar
      ? `${tg("📸", ICON("BELL"))} <b>أرسل لنا اسم المستخدم الخاص بك على ${red}:</b>\n\n<b>مثال:</b> @yourusername\n\n` +
        `${tg("⚠️", ICON("ATENTION"))} يجب أن يكون حسابك <b>عاماً (public)</b> أثناء تسليم الخدمة.\n` +
        `${tg("⚠️", ICON("ATENTION"))} اكتبه بعلامة (@) وتأكد منه جيداً: لا يمكن تغييره لاحقاً.`
      : `${tg("📸", ICON("BELL"))} <b>Send us your ${red} username:</b>\n\n<b>Example:</b> @yourusername\n\n` +
        `${tg("⚠️", ICON("ATENTION"))} Your account must be <b>public</b> while the service is delivered.\n` +
        `${tg("⚠️", ICON("ATENTION"))} Write it with the at sign (@) and double-check it: it cannot be changed later.`;
  }

  if (tipo === "adobe") {
    return ar
      ? `${tg("📧", ICON("BELL"))} <b>أرسل لنا البريد الإلكتروني الذي تريد تفعيله:</b>\n\n` +
        `<b>مثال:</b> user1@gmail.com, user2@gmail.com\n\n` +
        `${tg("⚠️", ICON("ATENTION"))} يجب أن يكون <b>مسجلاً بالفعل في Adobe</b>. إذا لم يكن لديك حساب، أنشئه أولاً ثم أرسل لنا البريد.`
      : `${tg("📧", ICON("BELL"))} <b>Send us the emails you want to activate:</b>\n\n` +
        `<b>Example:</b> user1@gmail.com, user2@gmail.com\n\n` +
        `${tg("⚠️", ICON("ATENTION"))} They must be <b>already registered with Adobe</b>. If you don't have an account, create it first.`;
  }

  return ar
    ? `${tg("📧", ICON("BELL"))} <b>أرسل لنا البريد الإلكتروني لتفعيل خدمتك:</b>\n\n` +
      `<b>مثال:</b> youremail@gmail.com\n\n` +
      `${tg("⚠️", ICON("ATENTION"))} تأكد من كتابته بشكل صحيح: يتم التفعيل على هذا البريد.`
    : `${tg("📧", ICON("BELL"))} <b>Send us the email to activate your service:</b>\n\n` +
      `<b>Example:</b> youremail@gmail.com\n\n` +
      `${tg("⚠️", ICON("ATENTION"))} Double-check it: the activation is done on that email.`;
}

// Valida lo que escribio el cliente segun el tipo de dato.
function validarDatoActivacion(texto, tipo) {
  const s = String(texto || "").trim();
  if (!s) return null;

  if (tipo === "usuario") {
    const u = s.replace(/^@+/, "").trim();
    if (!/^[A-Za-z0-9._]{2,32}$/.test(u)) return null;
    return "@" + u;
  }

  // correo o adobe: uno o varios separados por coma
  const correos = s.split(/[,\s]+/).map(x => x.trim()).filter(Boolean);
  const validos = correos.filter(c => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c));
  if (!validos.length || validos.length !== correos.length) return null;
  return validos.join(", ");
}

// ============================================================
//  ENTREGA MANUAL desde el grupo de logs
//  /entregar -> pide el numero de orden -> pide las credenciales ->
//  se las envia al cliente con la MISMA plantilla que una entrega
//  automatica y marca la orden como entregada.
// ============================================================
global.entregaSessions = {};

async function iniciarEntregaManual(chatId) {
  global.entregaSessions[chatId] = { step: "orden" };
  return bot.sendMessage(
    chatId,
    "📦 <b>Entrega manual</b>\n\nEnvía el <b>número de orden</b> que quieres entregar.\n\n" +
    "<i>Escribe /cancelar para salir.</i>",
    { parse_mode: "HTML" }
  );
}

async function entregaManualPaso(chatId, texto) {
  const ses = global.entregaSessions[chatId];
  if (!ses) return;

  // ---- Paso 1: numero de orden ----
  if (ses.step === "orden") {
    const num = String(texto).replace(/[^\d]/g, "");
    if (!num) return bot.sendMessage(chatId, "⚠️ Envía solo el número de la orden. Ejemplo: <code>4972</code>", { parse_mode: "HTML" });

    const { data: order, error } = await supabase
      .from("orders").select("*").eq("id", num).maybeSingle();

    if (error || !order) {
      return bot.sendMessage(chatId, `⚠️ No encontré la orden <b>#${num}</b>.\n\nRevisa el número y vuelve a enviarlo.`, { parse_mode: "HTML" });
    }

    if (order.status === "delivered") {
      return bot.sendMessage(
        chatId,
        `⚠️ La orden <b>#${num}</b> ya figura como ENTREGADA.\n\n` +
        `Si aun así quieres reenviarla, envía las credenciales ahora.\n` +
        `Para salir: /cancelar`,
        { parse_mode: "HTML" }
      );
    }

    ses.order = order;
    ses.step = "credenciales";

    return bot.sendMessage(
      chatId,
      `📦 <b>Orden #${order.id}</b>\n\n` +
      `👤 Cliente: <code>${order.telegram_id}</code>\n` +
      `🛍 Producto: <b>${htmlEscape(order.product_name || "-")}</b>\n` +
      `🔢 Cantidad: ${order.quantity || 1}\n` +
      `💰 Total: ${money(order.total || 0)} USDT\n` +
      `📌 Estado: ${order.status}\n\n` +
      `Ahora envía las <b>credenciales</b> tal como quieres que las reciba el cliente.\n` +
      `<i>Puedes usar varias líneas.</i>`,
      { parse_mode: "HTML" }
    );
  }

  // ---- Paso 2: credenciales y envio ----
  if (ses.step === "credenciales") {
    const order = ses.order;
    const contenido = String(texto).trim();
    if (!contenido) return bot.sendMessage(chatId, "⚠️ Envía las credenciales que recibirá el cliente.");

    const clienteId = order.telegram_id;
    const lang = await getUserLanguage(clienteId);
    const t = L(lang);

    // Mismo formato que la entrega automatica
    const texto2 = buildDeliveryText(
      t,
      { id: order.id, product_name: order.product_name, total: order.total, quantity: order.quantity },
      contenido,
      null
    );

    try {
      await bot.sendMessage(clienteId, texto2, { parse_mode: "HTML", disable_web_page_preview: true });
    } catch (e) {
      delete global.entregaSessions[chatId];
      return bot.sendMessage(chatId, `❌ No pude enviarle el mensaje al cliente <code>${clienteId}</code>.\n\n${htmlEscape(e.message)}\n\nPuede que haya bloqueado el bot.`, { parse_mode: "HTML" });
    }
    await sendDeliveryFile(clienteId, order, contenido);

    // Boton de recompra, igual que en la entrega normal
    try {
      const unit = Number(order.quantity || 1) > 0 ? Number(order.total || 0) / Number(order.quantity || 1) : Number(order.total || 0);
      await sendReorderButton(clienteId, t, order, unit);
    } catch (e) { /* si falla, la entrega ya llego */ }

    await supabase.from("orders").update({
      status: "delivered",
      delivery_message: contenido,
      delivered_at: new Date().toISOString()
    }).eq("id", order.id);

    delete global.entregaSessions[chatId];

    return bot.sendMessage(
      chatId,
      `✅ <b>Entregado</b>\n\n` +
      `🧾 Orden #${order.id}\n` +
      `👤 Cliente: <code>${clienteId}</code>\n` +
      `🛍 ${htmlEscape(order.product_name || "-")}\n\n` +
      `La orden quedó marcada como <b>delivered</b>.`,
      { parse_mode: "HTML" }
    );
  }
}

// Recibe el correo / @usuario del cliente, lo valida y avisa al admin.
async function recibirDatoActivacion(chatId, texto) {
  const ses = global.emailSessions[chatId];
  if (!ses) return;

  const lang = await getUserLanguage(chatId);
  const ar = lang === "ar";
  const dato = validarDatoActivacion(texto, ses.tipo);

  // Dato mal escrito: se le explica y se queda esperando.
  if (!dato) {
    const ayuda = ses.tipo === "usuario"
      ? (ar ? "اكتبه هكذا: <b>@yourusername</b>" : "Write it like this: <b>@yourusername</b>")
      : (ar ? "اكتبه هكذا: <b>youremail@gmail.com</b>" : "Write it like this: <b>youremail@gmail.com</b>");
    return bot.sendMessage(
      chatId,
      `${tg("⚠️", ICON("ATENTION"))} ${ar ? "لم أتمكن من قراءة هذه البيانات." : "I couldn't read that."}\n\n${ayuda}`,
      { parse_mode: "HTML" }
    );
  }

  delete global.emailSessions[chatId];

  // Guardar el dato en la orden para tenerlo a mano al activar.
  try {
    if (ses.order?.id) {
      await supabase.from("orders").update({
        delivery_message: `Activación manual — dato del cliente: ${dato}`
      }).eq("id", ses.order.id);
    }
  } catch (e) {
    console.log("[EMAIL-ACT] No se pudo guardar el dato:", e.message);
  }

  // Aviso al admin con todo lo necesario para activarlo.
  await sendAdminLog(
    `📧 <b>DATO RECIBIDO — ACTIVAR</b>\n\n` +
    `👤 @${getUsername(chatId)}\n🆔 <code>${chatId}</code>\n` +
    `📦 ${ses.producto.name} x${ses.qty}\n` +
    `💰 ${money(ses.order?.total || 0)} USDT\n` +
    `🧾 #${ses.order?.id || "-"}\n\n` +
    `${ses.tipo === "usuario" ? "👤 Usuario" : "📧 Correo"}: <code>${dato}</code>`
  );

  return bot.sendMessage(
    chatId,
    `${tg("✅", ICON("CHECK"))} <b>${ar ? "تم الاستلام!" : "Received!"}</b>\n\n` +
    `${ses.tipo === "usuario" ? (ar ? "اسم المستخدم" : "Username") : (ar ? "البريد الإلكتروني" : "Email")}: <code>${dato}</code>\n\n` +
    `${ar
      ? "نقوم الآن بتفعيل خدمتك. سنخبرك هنا بمجرد أن تكون جاهزة."
      : "We're activating your service now. We'll let you know here as soon as it's ready."}`,
    { parse_mode: "HTML" }
  );
}

// Arranca el flujo: la orden queda PAGADA (no entregada) y se le pide el dato.
async function startEmailActivationFlow(chatId, order, producto, qty, t, lang) {
  try {
    if (order?.id) {
      await supabase.from("orders").update({
        status: "paid",
        delivery_message: "Pago confirmado. Pendiente de activación por correo."
      }).eq("id", order.id);
    }
  } catch (e) {
    console.log("[EMAIL-ACT] No se pudo marcar la orden como paid:", e.message);
  }

  global.emailSessions[chatId] = {
    order, producto, qty,
    tipo: tipoDatoActivacion(producto.name),
    createdAt: Date.now()
  };

  await sendAdminLog(
    `✅ PAGO CONFIRMADO (activación por correo)\n\n` +
    `👤 @${getUsername(chatId)}\n🆔 ${chatId}\n` +
    `📦 ${producto.name} x${qty}\n💰 ${money(order?.total || 0)} USDT\n` +
    `🧾 #${order?.id || "-"}\n\n⏳ Esperando el dato del cliente...`
  );

  const ar = lang === "ar";
  await bot.sendMessage(
    chatId,
    `${tg("✅", ICON("CHECK"))} <b>${ar ? "تم تأكيد الدفع" : "Payment confirmed"}</b>\n\n` +
    `${tg("📦", ICON("STOCK"))} ${producto.name}\n` +
    `${tg("💰", ICON("MONEY"))} ${money(order?.total || 0)} USDT\n\n` +
    `${ar ? "يتم تفعيل خدمتك يدوياً. نحتاج بيانات إضافية:" : "Your service is activated manually. We need one more detail:"}`,
    { parse_mode: "HTML" }
  );

  return bot.sendMessage(chatId, textoPedirDato(producto.name, lang), { parse_mode: "HTML" });
}

async function editOrSend(chatId, messageId, text, keyboard) {
  const opts = { parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard: keyboard } };
  if (messageId) {
    try { return await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }); }
    catch (e) {
      // Telegram tira este error cuando el contenido es IDENTICO al que ya esta en pantalla
      // (ej. dar "actualizar" sin que haya cambiado nada) — no es un fallo real, no hay que
      // mandar un mensaje nuevo, la tarjeta ya esta al dia tal cual.
      if (/message is not modified/i.test(e.message || "")) return null;
      /* fallo real (mensaje borrado, etc.): enviar nuevo */
    }
  }
  return bot.sendMessage(chatId, text, opts);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
//  Agrupacion por marca (igual al bot principal)
// ============================================================
const BRAND_GROUPS = [
  ["directv", ["directv"]],
  ["hotmail", ["hotmail", "outlook"]],
  // Marcas que antes caian en el agrupador por defecto y quedaban separadas
  // aunque fueran el mismo producto de distintas fuentes.
  ["photoshop", ["photoshop"]],
  ["adobe", ["adobe"]],
  ["netflix", ["netflix"]],
  ["gmail", ["gmail"]],
  ["higgsfield", ["higgsfield"]],
  ["genie", ["genie"]],
  ["paramount", ["paramount"]],
  ["disney", ["disney"]],
  ["prime", ["prime"]],
  ["amazon", ["amazon"]],
  ["lovable", ["lovable"]],
  ["claude", ["claude"]],
  ["google ai", ["google ai"]],
  ["gemini", ["gemini"]],
  ["chatgpt", ["chatgpt", "gpt"]],
  ["grok", ["supergrok", "grok"]],
  ["nord", ["nord"]],
  ["youtube", ["youtube"]],
  ["surfshark", ["surfshark", "vpn key"]],
  ["express vpn", ["express"]],
  ["capcut", ["capcut"]],
  ["supabase", ["supabase"]],
  ["canva", ["canva"]],
  ["elevenlabs", ["elevenlabs"]],
  ["perplexity", ["perplexity"]],
  ["n8n", ["n8n"]],
  ["manus", ["manus"]],
  ["linkedin", ["linkedin"]],
  ["coursera", ["coursera"]],
  ["duolingo", ["duolingo"]],
  ["quillbot", ["quillbot"]],
  ["notion", ["notion"]],
  ["cursor", ["cursor"]],
  ["factory", ["factory"]],
  ["spotify", ["spotify"]],
  ["netflix", ["netflix"]],
  ["max plan", ["max plan"]],
  ["crunchyroll", ["crunchyroll"]]
];

const familyKey = (name) => {
  const clean = String(name || "").toLowerCase();
  for (const [key, words] of BRAND_GROUPS) {
    if (words.some(w => clean.includes(w))) return key;
  }
  // Sin marca conocida: usar el nombre sin la duración
  return clean
    .replace(/\b\d+\s*(meses|mes|months?|month|semanas?|weeks?|week|dias|días|days?|day|m|d|h)\b/g, "")
    .replace(/\d+/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

// ============================================================
//  Textos (ES / EN) — copiados del bot principal
// ============================================================
function L(lang) {
  const ar = {
    welcome: `مرحباً بك في ${SHOP_NAME}`, yourBalance: "رصيدك",
    shop: "المتجر", balance: "رصيدي", deposit: "شحن المحفظة",
    orders: "مشترياتي", language: "اللغة", support: "الدعم", channel: "القناة",
    back: "رجوع", backHome: "القائمة", refresh: "تحديث",
    chooseProduct: "اختر منتجك:", noProducts: "لا توجد منتجات متاحة حالياً.",
    availableProducts: "المنتجات المتاحة", officialProduct: "منتج رسمي من المتجر",
    instantDelivery: "تسليم تلقائي فوري", buyNow: "اشترِ الآن",
    from: "ابتداءً من", priceBase: "السعر الأساسي", availableStock: "المخزون المتاح",
    selectedQty: "الكمية المختارة", totalAmount: "المبلغ الإجمالي", selectQuantity: "اختر الكمية",
    volumeDiscounts: "خصومات الكمية", each: "للوحدة", unitsLabel: "وحدة",
    addMorePre: "أضف", addMoreMid: "أكثر للحصول على", addMoreSuf: "خصم",
    customQuantity: "كمية مخصصة", customQuantityPrompt: "أرسل الكمية التي تريد شراءها.",
    copyLink: "نسخ الرابط", viewNote: "عرض الملاحظة",
    backToStore: "العودة إلى المتجر",
    orderSummary: "ملخص الطلب", product: "المنتج", quantity: "الكمية",
    orderValue: "قيمة الطلب", wallet: "الرصيد", choosePaymentMethod: "اختر طريقة الدفع",
    buyBinance: "الدفع عبر Binance Pay", payBEP20: "الدفع عبر BEP20 (BSC)", payBalance: "الدفع من الرصيد",
    payWithBalanceTitle: "الدفع من الرصيد", confirmWallet: "هل تريد الدفع من رصيدك؟",
    yesPayBalance: "نعم، ادفع من الرصيد", insufficientBalanceShort: "الرصيد غير كافٍ.",
    topupToBuy: "اشحن محفظتك لإتمام هذا الشراء.", cancel: "إلغاء", reorderLabel: "إعادة الطلب",
    directPayment: "دفع مباشر", seller: "البائع", howToPay: "طريقة الدفع:",
    payStepOne: "أرسل المبلغ:", payStepTwo: "انسخ رقم طلب Binance (Order ID).", payStepThree: "الصق الـ Order ID هنا في المحادثة",
    autoVerification: "يتم التحقق من دفعتك تلقائياً خلال 5 ثوانٍ", deliveryAutomatic: "التسليم تلقائي بعد تأكيد الدفع.",
    changeQuantity: "تغيير الكمية", cancelOrder: "إلغاء الطلب", backToProduct: "العودة إلى المنتج",
    walletAddress: "عنوان المحفظة", sendExactUsdtBep20: "أرسل المبلغ بالضبط بعملة USDT إلى عنوان المحفظة أعلاه.",
    copyTxid: "انسخ رقم المعاملة (TXID) الخاص بك.", pasteTxid: "الصق رقم TXID هنا.",
    bscNetworkOnly: "فقط معاملات شبكة BSC (BEP20)", bep20ExactAmount: "يجب إرسال هذا المبلغ بالضبط ليتم الاعتماد تلقائياً",
    verifyingTransaction: "جارٍ التحقق من المعاملة...", checkingApis: "جارٍ التحقق من البلوكتشين وواجهات المنصات...",
    validatingOrderId: "جارٍ التحقق من رقم طلب Binance...", creditingWallet: "تم تأكيد الدفع. جارٍ معالجة الطلب...",
    processingOrder: "جارٍ معالجة طلبك...", secondsRemaining: "~5 ثوانٍ متبقية",
    waitConfirmPayment: "يرجى الانتظار بينما نؤكد دفعتك.", verificationFailed: "فشل التحقق من الدفع",
    paymentVerified: "تم التحقق من الدفع!", orderDelivered: "تم تسليم الطلب!", order: "الطلب", amount: "المبلغ",
    remainingBalance: "الرصيد المتبقي", yourProduct: "منتجك", yourProducts: "منتجاتك",
    insufficient: "الرصيد غير كافٍ. اشحن رصيدك للمتابعة.", deliveryFail: "تمت معالجة دفعتك لكن التسليم لا يزال معلقاً. تواصل مع الدعم.",
    depositTitle: "اختر طريقة الشحن:", binancePay: "Binance Pay", bep20: "BEP20 (BSC)",
    enterAmount: "كم دولار USDT تريد شحنه؟ (مثال: 10)", invalidAmount: "مبلغ غير صالح. أرسل رقماً (مثال: 10).",
    payId: "معرّف الدفع (Pay ID)", credited: "تم اعتماد الشحن", newBalance: "الرصيد الجديد",
    topupDeposit: "إيداع", bonusTiers: "مستويات المكافأة", getAmount: "احصل على", pickPayment: "اختر طريقة دفع أدناه للبدء.",
    binancePayDeposit: "إيداع Binance Pay", bep20Deposit: "إيداع BEP20", binanceName: "اسم Binance",
    sendExactUsdt: "أرسل المبلغ بالضبط بعملة USDT إلى Pay ID أعلاه.", copyOrderId: "انسخ رقم طلب Binance (Order ID).",
    pasteOrderId: "الصق رقم طلب Binance هنا.", onlyConfirmedPayId: "لن يتم اعتماد سوى الدفعات المؤكدة المرسلة إلى Binance Pay ID هذا.",
    sendOrderIdBelow: "أرسل رقم طلب Binance (Order ID) أدناه:", whereOrderId: "أين أجد رقم الطلب (Order ID)؟",
    whereOrderIdHelp: "افتح Binance -> Pay -> السجل -> اختر الدفعة -> انسخ الـ Order ID.",
    bep20EnterAmount: "كم دولار USDT تريد شحنه؟", bep20Example: "مثال: 100",
    bep20AmountToSend: "المبلغ المطلوب إرساله", sendTxidBelow: "يرجى إرسال رقم TXID أدناه:",
    noOrders: "ليس لديك أي مشتريات بعد.", myOrders: "مشترياتي", orderIdUsed: "تم استخدام هذا المعرف من قبل.",
    stDelivered: "تم التسليم", stCancelled: "ملغي", stProcessing: "قيد المعالجة", orderIdLabel: "رقم الطلب",
    typeLabel: "النوع", whenLabel: "التاريخ", statusLabel: "الحالة", receivedLabel: "المستلم",
    backToOrders: "العودة إلى مشترياتي", orderNotFound: "الطلب غير موجود.",
    cancelledNoContent: "تم إلغاء الطلب، بدون محتوى.", processingDelivery: "جارٍ معالجة التسليم...",
    binanceInstructions: "أرسل المبلغ إلى Pay ID ثم الصق رقم طلب Binance الخاص بك.",
    bep20Instructions: "أرسل هذا المبلغ بالضبط بعملة USDT (شبكة BSC/BEP20) إلى المحفظة:",
    exactAmount: "المبلغ المطلوب إرساله بالضبط", autoCredit: "سيتم الاعتماد تلقائياً عند اكتشاف الدفعة.",
    orSendTxid: "أو أرسل رقم TXID أدناه إذا كنت قد دفعت بالفعل.", langChoose: "اختر لغتك:", langSaved: "تم تحديث اللغة.",
    reportIssue: "⚠️ الإبلاغ عن مشكلة", reportIssuePrompt: "اكتب وصف المشكلة اللي حصلت في الطلب ده، وهنراجعها في أقرب وقت:",
    reportIssueReceived: "✅ تم استلام بلاغك، هنتواصل معاك قريبًا.", reportIssueTooShort: "اكتب وصف أوضح للمشكلة من فضلك."
  };
  const en = {
    welcome: `Welcome to ${SHOP_NAME}`, yourBalance: "Your balance",
    shop: "Shop", balance: "My Balance", deposit: "Top-up Wallet",
    orders: "My Orders", language: "Language", support: "Support", channel: "Channel",
    back: "Back", backHome: "Menu", refresh: "Refresh",
    chooseProduct: "Choose your product:", noProducts: "No products available right now.",
    availableProducts: "Available Products", officialProduct: "Official Store Product",
    instantDelivery: "Instant automatic delivery", buyNow: "BUY NOW",
    from: "From", priceBase: "Price Base", availableStock: "Available Stock",
    selectedQty: "Selected Qty", totalAmount: "Total Amount", selectQuantity: "Select quantity",
    volumeDiscounts: "Volume Discounts", each: "each", unitsLabel: "units",
    addMorePre: "Add", addMoreMid: "more to get", addMoreSuf: "discount",
    customQuantity: "Custom Quantity", customQuantityPrompt: "Send the quantity you want to buy.",
    copyLink: "Copy Link", viewNote: "View Note",
    backToStore: "Back to Store",
    orderSummary: "Order Summary", product: "Product", quantity: "Quantity",
    orderValue: "Order Value", wallet: "Wallet", choosePaymentMethod: "Choose payment method",
    buyBinance: "Buy with Binance Pay", payBEP20: "Pay with BEP20 (BSC)", payBalance: "Pay with Balance",
    payWithBalanceTitle: "Pay with Balance", confirmWallet: "Do you want to pay with your wallet balance?",
    yesPayBalance: "Yes, Pay with Balance", insufficientBalanceShort: "Insufficient balance.",
    topupToBuy: "Please top up your wallet to complete this purchase.", cancel: "Cancel", reorderLabel: "Reorder",
    directPayment: "Direct Payment", seller: "Seller", howToPay: "How to pay:",
    payStepOne: "Send the amount:", payStepTwo: "Copy your Binance Order ID.", payStepThree: "Paste the Order ID here in the chat",
    autoVerification: "Your payment is automatically verified in 5 seconds", deliveryAutomatic: "Delivery is automatic after payment confirmation.",
    changeQuantity: "Change Quantity", cancelOrder: "Cancel Order", backToProduct: "Back to Product",
    walletAddress: "Wallet Address", sendExactUsdtBep20: "Send the exact USDT amount to the wallet address above.",
    copyTxid: "Copy your Transaction Hash (TXID).", pasteTxid: "Paste your TXID here.",
    bscNetworkOnly: "Only BSC network transactions (BEP20)", bep20ExactAmount: "You must send exactly this amount for automatic credit",
    verifyingTransaction: "Verifying Transaction...", checkingApis: "Checking blockchain & exchange APIs...",
    validatingOrderId: "Validating Binance Order ID...", creditingWallet: "Payment confirmed. Processing order...",
    processingOrder: "Processing your order...", secondsRemaining: "~5 seconds remaining",
    waitConfirmPayment: "Please wait while we confirm your payment.", verificationFailed: "Payment verification failed",
    paymentVerified: "Payment Verified!", orderDelivered: "Order Delivered!", order: "Order", amount: "Amount",
    remainingBalance: "Remaining Balance", yourProduct: "Your Product", yourProducts: "Your Products",
    insufficient: "Insufficient balance. Top up to continue.", deliveryFail: "Your payment went through but delivery is pending. Contact support.",
    depositTitle: "Choose a top-up method:", binancePay: "Binance Pay", bep20: "BEP20 (BSC)",
    enterAmount: "How many USDT do you want to top up? (e.g. 10)", invalidAmount: "Invalid amount. Send a number (e.g. 10).",
    payId: "Pay ID", credited: "Top-up credited", newBalance: "New balance",
    topupDeposit: "Deposit", bonusTiers: "Bonus Tiers", getAmount: "get", pickPayment: "Pick a payment method below to get started.",
    binancePayDeposit: "Binance Pay Deposit", bep20Deposit: "BEP20 Deposit", binanceName: "Binance Name",
    sendExactUsdt: "Send the exact USDT amount to the Pay ID above.", copyOrderId: "Copy your Binance Order ID.",
    pasteOrderId: "Paste your Binance Order ID here.", onlyConfirmedPayId: "Only confirmed payments sent to this Binance Pay ID will be credited.",
    sendOrderIdBelow: "Please send your Binance Order ID below:", whereOrderId: "Where to find Order ID?",
    whereOrderIdHelp: "Open Binance app -> Pay -> History -> select payment -> copy Order ID.",
    bep20EnterAmount: "How many USDT would you like to recharge?", bep20Example: "Example: 100",
    bep20AmountToSend: "Amount to send", sendTxidBelow: "Please send your TXID below:",
    noOrders: "You have no orders yet.", myOrders: "My Orders", orderIdUsed: "That ID was already used.",
    stDelivered: "Delivered", stCancelled: "Cancelled", stProcessing: "Processing", orderIdLabel: "Order ID",
    typeLabel: "Type", whenLabel: "Date", statusLabel: "Status", receivedLabel: "Received",
    backToOrders: "Back to my orders", orderNotFound: "Order not found.",
    cancelledNoContent: "Order cancelled, no content.", processingDelivery: "Processing delivery...",
    binanceInstructions: "Send the amount to the Pay ID then paste your Binance Order ID.",
    bep20Instructions: "Send EXACTLY this amount in USDT (BSC/BEP20 network) to the wallet:",
    exactAmount: "Exact amount to send", autoCredit: "It will be credited automatically once detected.",
    orSendTxid: "Or send your TXID below if you already paid.", langChoose: "Choose your language:", langSaved: "Language updated.",
    reportIssue: "⚠️ Report a Problem", reportIssuePrompt: "Describe the problem with this order and we'll review it shortly:",
    reportIssueReceived: "✅ Your report was received, we'll get back to you soon.", reportIssueTooShort: "Please write a clearer description of the problem."
  };
  return lang === "en" ? en : ar;
}

// ============================================================
//  Usuarios / balance
// ============================================================
async function getUserProfile(chatId) {
  const { data } = await supabase.from("users").select("*").eq("id", chatId).maybeSingle();
  return data || { id: chatId, balance: 0, language: "ar" };
}
async function getUserLanguage(chatId) {
  const p = await getUserProfile(chatId);
  return p.language === "en" ? "en" : "ar";
}
function getUsername(chatId) { return global.usernames[chatId] || "sin_username"; }

async function syncUsername(chatId, from) {
  try {
    if (!chatId || !from) return;
    const live = from.username || null;
    global.usernames[chatId] = from.username || "sin_username";
    if (!live) return;
    if (global.usernameSynced[chatId] === live) return;
    const { data: user } = await supabase.from("users").select("username").eq("id", chatId).maybeSingle();
    if (user && user.username !== live) await supabase.from("users").update({ username: live }).eq("id", chatId);
    global.usernameSynced[chatId] = live;
  } catch (e) {}
}

async function deductBalance(chatId, amount) {
  const profile = await getUserProfile(chatId);
  const current = Number(profile.balance || 0);
  if (current < amount) return { success: false, insufficient: true, balance: current };
  const next = +(current - amount).toFixed(2);
  const { error } = await supabase.from("users").update({ balance: next }).eq("id", chatId).eq("balance", current);
  if (error) return { success: false, balance: current };
  await supabase.from("transactions").insert({ telegram_id: chatId, type: "purchase", amount: -amount, description: "Compra" }).then(() => {}).catch(() => {});
  return { success: true, balance: next };
}

async function creditBalance(chatId, amount, description = "Recarga") {
  const profile = await getUserProfile(chatId);
  const next = +(Number(profile.balance || 0) + Number(amount)).toFixed(2);
  const payload = { id: chatId, balance: next };
  const uname = getUsername(chatId);
  if (uname && uname !== "sin_username") payload.username = uname;
  await supabase.from("users").upsert(payload);
  await supabase.from("transactions").insert({ telegram_id: chatId, type: "deposit", amount: Number(amount), description }).then(() => {}).catch(() => {});
  return next;
}

// ============================================================
//  Productos / precio con markup
// ============================================================
function finalPrice(product) {
  const base = Number(product.price || 0);
  const markup = Number(product.markup != null ? product.markup : 30);
  if (product.markup_type === "fixed") return +(base + markup).toFixed(2);
  return +(base * (1 + markup / 100)).toFixed(2);
}

// Precio unitario segun la cantidad, usando los tramos bulk (ya con markup del revendedor).
// Si el producto no tiene bulk, devuelve el precio normal.
function unitPriceForQty(p, qty) {
  const tiers = Array.isArray(p.bulk_discounts) ? p.bulk_discounts : [];
  if (!tiers.length) return Number(p.price || 0);
  let best = Number(p.price || 0);
  let bestMin = 0;
  for (const tr of tiers) {
    const mq = Number(tr.min_qty);
    if (qty >= mq && mq >= bestMin) { best = Number(tr.unit_price); bestMin = mq; }
  }
  return best;
}
function lineTotal(p, qty) { return +(unitPriceForQty(p, qty) * qty).toFixed(2); }

// Precio MÁS BAJO del bulk (para el "Desde $X" en la lista). null si no tiene bulk real.
function lowestBulkPrice(p) {
  const tiers = Array.isArray(p.bulk_discounts) ? p.bulk_discounts : [];
  if (tiers.length <= 1) return null;
  return Math.min(...tiers.map(tr => Number(tr.unit_price)));
}

// Etiqueta de precio para los botones de la tienda: "Desde $X" si hay bulk o min_order>1.
function priceLabel(p, t) {
  const low = lowestBulkPrice(p);
  if (low != null) return `${t.from} $${money(low)}`;
  if (p.min_order > 1) return `${t.from} $${money(p.price)}`;
  return `$${money(p.price)}`;
}

// Bloque visual de "Descuentos por Volumen" (igual que el bot principal).
function bulkDiscountBlock(p, t) {
  const tiers = (Array.isArray(p.bulk_discounts) ? p.bulk_discounts : [])
    .slice().sort((a, b) => a.min_qty - b.min_qty);
  if (tiers.length <= 1) return "";  // sin descuento real
  let block = `\n\n${tg("🏠", ICON("HOME"))} <b>${t.volumeDiscounts}</b>`;
  for (let i = 0; i < tiers.length; i++) {
    const tr = tiers[i];
    const next = tiers[i + 1];
    const range = next ? `${tr.min_qty}-${next.min_qty - 1}` : `${tr.min_qty}+`;
    const disc = tr.discount_percent > 0 ? ` (-${Math.round(tr.discount_percent)}%)` : "";
    block += `\n${range} ${t.unitsLabel} → ${money(tr.unit_price)} USDT ${t.each}${disc}`;
  }
  return block;
}

// Mensaje dinamico "Agrega X más para obtener Y% descuento".
function nextBulkHint(p, qty, t) {
  const tiers = (Array.isArray(p.bulk_discounts) ? p.bulk_discounts : [])
    .slice().sort((a, b) => a.min_qty - b.min_qty);
  if (tiers.length <= 1) return "";
  for (const tr of tiers) {
    if (Number(tr.discount_percent) > 0 && qty < Number(tr.min_qty)) {
      const needed = Number(tr.min_qty) - qty;
      return `\n\n💡 <b>${t.addMorePre} ${needed} ${t.addMoreMid} ${Math.round(tr.discount_percent)}% ${t.addMoreSuf}</b>`;
    }
  }
  return "";
}

async function getShopProducts() {
  const out = [];
  const { data: apiProds } = await supabase.from("products").select("*").eq("enabled", true).gt("stock", 0).order("name");
  (apiProds || []).forEach(p => {
    const markup = Number(p.markup != null ? p.markup : 30);
    const isFixedMarkup = p.markup_type === "fixed";
    // Los tramos de la API traen el precio MAYORISTA por unidad; le aplicamos el markup
    // del revendedor (% o monto fijo) a cada tramo para obtener el precio final al cliente.
    const rawTiers = Array.isArray(p.bulk_discounts) ? p.bulk_discounts : [];
    const tiers = rawTiers.map(tr => ({
      min_qty: Number(tr.min_qty),
      unit_price: +(isFixedMarkup
        ? (Number(tr.unit_price || 0) + markup)
        : (Number(tr.unit_price || 0) * (1 + markup / 100))
      ).toFixed(2),
      discount_percent: Number(tr.discount_percent || 0)
    }));
    out.push({
      kind: "kokoro", id: String(p.id), name: (p.custom_name && p.custom_name.trim()) || p.name, price: finalPrice(p),
      stock: Number(p.stock || 0), min_order: Number(p.min_order || 1), emoji: p.emoji,
      description_es: p.description_es, description_en: p.description_en,
      bulk_discounts: tiers, providerId: p.provider_id, nativeId: p.native_id || String(p.id)
    });
  });
  const { data: manProds } = await supabase.from("products_manual").select("*").eq("enabled", true).order("name");
  for (const p of (manProds || [])) {
    const { count } = await supabase.from("stock_manual").select("*", { count: "exact", head: true }).eq("product_id", p.id).eq("is_sold", false);
    if ((count || 0) > 0) out.push({
      kind: "manual", id: `m${p.id}`, manualId: p.id, name: p.name, price: Number(p.price || 0),
      stock: count, min_order: Number(p.min_order || 1), emoji: p.emoji,
      description_es: p.description_es, description_en: p.description_en
    });
  }
  return out;
}
function sess(chatId) { global.sessions[chatId] = global.sessions[chatId] || {}; return global.sessions[chatId]; }
async function loadProducts(chatId) { const p = await getShopProducts(); sess(chatId).products = p; return p; }

// ============================================================
//  Pantalla: Menu principal (home)
// ============================================================
async function showHome(chatId, messageId) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const profile = await getUserProfile(chatId);
  const text = `${tg("🔥", ICON("LIGHTNING"))} <b>${t.welcome}!</b>\n\n${tg("💰", ICON("MONEY"))} ${t.yourBalance}: <b>$${money(profile.balance)}</b>`;

  const kb = [
    [styledButton(t.shop, "shop", "success", ICON("CART"))],
    [styledButton(t.deposit, "deposit", "primary", ICON("PLUS")), styledButton(t.balance, "balance", "primary", ICON("MONEY"))],
    [styledButton(t.orders, "orders", "primary", ICON("STOCK")), styledButton(t.language, "language", "primary", ICON("HOME"))]
  ];
  const bottom = [];
  if (process.env.SUPPORT_URL) bottom.push(styledUrlButton(t.support, process.env.SUPPORT_URL, "danger", ICON("BELL")));
  if (process.env.CHANNEL_URL) bottom.push(styledUrlButton(t.channel, process.env.CHANNEL_URL, "primary", ICON("HOME")));
  if (bottom.length) kb.push(bottom);

  return editOrSend(chatId, messageId, text, kb);
}

// ============================================================
//  Pantalla: Lista de productos (image 2)
// ============================================================
// Rayito animado de carga (mismo efecto que el bot principal): se muestra
// mientras se cargan los productos y se borra al terminar.
async function showLoadingSticker(chatId) {
  try {
    const res = await bot.sendMessage(chatId, tg("⚡", ICON("LIGHTNING")), { parse_mode: "HTML" });
    return res.message_id;
  } catch (err) {
    try {
      const res = await bot.sendMessage(chatId, "⏳", { parse_mode: "HTML" });
      return res.message_id;
    } catch (e) { return null; }
  }
}

async function showShop(chatId, messageId) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  // Mostrar rayito de carga mientras se traen los productos
  const loadingMsgId = await showLoadingSticker(chatId);
  let products = await loadProducts(chatId);
  // Borrar el rayito cuando los productos ya cargaron
  if (loadingMsgId) {
    try { await bot.deleteMessage(chatId, loadingMsgId); } catch (e) {}
  }
  if (products.length === 0) {
    return editOrSend(chatId, messageId, `${tg("🛍️", ICON("CART"))} ${t.noProducts}`, [[styledButton(t.backHome, "home", "danger", ICON("HOME"))]]);
  }

  // Ordenar productos por familia/marca (igual al bot principal)
  const familyOrder = [];
  products.forEach(p => {
    const k = familyKey(p.name);
    if (!familyOrder.includes(k)) familyOrder.push(k);
  });
  products.sort((a, b) => {
    const fa = familyOrder.indexOf(familyKey(a.name));
    const fb = familyOrder.indexOf(familyKey(b.name));
    if (fa !== fb) return fa - fb; // mantener orden de aparición de la familia
    // dentro de la misma familia, ordenar por nombre/duración numéricamente
    return String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
  });

  // Categorias agrupadas: el boton se coloca EN LA POSICION del primer producto
  // de esa marca (no al final), y el resto de esa marca se omite.
  // El indice `i` de los demas NO cambia, asi la compra sigue funcionando igual.
  const CATEGORIES = [
    { match: isApiTokenProduct,  label: "API Tokens Claude Y Codex", cb: "cat_api_tokens", icon: ICON("CLAUDE") },
    { match: isAdobeProduct,     label: "Adobe Creative Cloud",      cb: "cat_adobe",      icon: ICON("ADOBECREATIVE") },
    { match: isMicrosoftProduct, label: "Microsoft",                 cb: "cat_microsoft",  icon: ICON("MICROSOFT") },
    { match: isCursorProduct,    label: "Cursor",                    cb: "cat_cursor",     icon: ICON("CURSORPRO") },
    { match: isFollowersProduct, label: "Followers",                 cb: "cat_followers",  icon: ICON("INSTAGRAM") },
    { match: isDisneyProduct,    label: "Disney",                    cb: "cat_disney",     icon: ICON("DISNEY") },
    { match: isSpotifyProduct,   label: "Spotify",                   cb: "cat_spotify",    icon: ICON("SPOTIFY") },
    { match: isYoutubeProduct,   label: "YouTube",                   cb: "cat_youtube",    icon: ICON("YOUTUBE") },
    { match: isPrimeVideoProduct,label: "Prime Video",               cb: "cat_prime",      icon: ICON("PRIMEVIDEO") },
    { match: isLovableProduct,   label: "Lovable",                   cb: "cat_lovable",    icon: ICON("LOVABLE") },
    { match: isNotionProduct,    label: "Notion Business",          cb: "cat_notion",     icon: ICON("NOTION") }
  ];
  const catShown = {};

  // Agrupacion AUTOMATICA por marca: cualquier conjunto de 2 o mas productos
  // que compartan marca se junta, aunque no tenga una categoria propia arriba.
  // Asi los productos MANUALES tambien se agrupan con los de la API cuando
  // coinciden en el nombre, en vez de quedar sueltos al final.
  const familias = {};
  products.forEach(p => {
    // Los que ya tienen categoria fija no entran aqui
    if (CATEGORIES.some(c => c.match(p))) return;
    const k = familyKey(p.name);
    if (!k) return;
    (familias[k] = familias[k] || []).push(p);
  });
  const famShown = {};

  const kb = products.map((p, i) => {
    const cat = CATEGORIES.find(c => c.match(p));
    // Solo se agrupa si hay 2 o mas productos de esa marca
    const catItems = cat ? products.filter(cat.match) : [];
    if (cat && catItems.length > 1) {
      if (catShown[cat.cb]) return null;
      catShown[cat.cb] = true;
      const items = catItems;
      const catStock = items.reduce((sum, x) => sum + Number(x.stock || 0), 0);
      return [styledButton(`${cat.label} ▸ ${items.length} Plans (${catStock}) »`, cat.cb, "primary", cat.icon)];
    }

    // Sin categoria fija: agrupar por marca detectada del nombre
    if (!cat) {
      const k = familyKey(p.name);
      const items = familias[k] || [];
      if (items.length > 1) {
        if (famShown[k]) return null;
        famShown[k] = true;
        const stock = items.reduce((s, x) => s + Number(x.stock || 0), 0);
        const titulo = k.charAt(0).toUpperCase() + k.slice(1);
        const iconId = items[0].emoji || productIcon(items[0].name);
        return [styledButton(`${titulo} ▸ ${items.length} Plans (${stock}) »`, `cat_fam_${famSlug(k)}`, "primary", iconId)];
      }
    }

    const iconId = p.emoji || productIcon(p.name);
    const priceTxt = priceLabel(p, t);
    return [styledButton(`${p.name} | ${priceTxt} | ${stockEmoji(p.stock)} ${p.stock}`, `desc_${i}`, "primary", iconId)];
  }).filter(Boolean);

  kb.push([styledButton(t.refresh, "shop", "success", ICON("REFRESH"))]);
  kb.push([styledButton(t.backHome, "home", "danger", ICON("BACK"))]);
  return editOrSend(chatId, messageId, `${tg("📊", ICON("STOCK"))} <b>${t.chooseProduct}</b>`, kb);
}

// ============================================================
//  Pantalla: Categoria API TOKENS
//  Usa los MISMOS indices de sess(chatId).products, asi el callback
//  `desc_<i>` y todo el flujo de compra siguen funcionando igual.
// ============================================================
async function showCursorCategory(chatId, messageId = null) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const products = sess(chatId).products || await loadProducts(chatId);
  if (!products || !products.length) return showShop(chatId, messageId);

  const kb = [];
  products.forEach((p, i) => {
    if (!isCursorProduct(p)) return;
    const iconId = p.emoji || productIcon(p.name);
    const priceTxt = priceLabel(p, t);
    kb.push([styledButton(`${p.name} | ${priceTxt} | ${stockEmoji(p.stock)} ${p.stock}`, `desc_${i}`, "primary", iconId)]);
  });

  if (kb.length === 0) return showShop(chatId, messageId);
  kb.push([styledButton(t.back || t.backHome, "shop", "danger", ICON("BACK"))]);
  return editOrSend(chatId, messageId, `${tg("\uD83D\uDDB1\uFE0F", ICON("CURSORPRO"))} <b>Cursor</b>\n\n${t.chooseProduct}`, kb);
}

// Pantalla generica de categoria (Disney, Spotify, YouTube, Prime, Lovable, Notion)
// El callback_data de Telegram admite 64 bytes: la marca se recorta y se
// limpia para que quepa siempre.
function famSlug(key) {
  return String(key || "").replace(/[^a-z0-9]/gi, "").slice(0, 40);
}

// Pantalla de un grupo automatico (marca sin categoria propia).
// Lista todos los productos de esa marca, vengan de la API o sean manuales.
async function showFamilyCategory(chatId, messageId, slug) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const products = sess(chatId).products || await loadProducts(chatId);
  if (!products || !products.length) return showShop(chatId, messageId);

  const items = products.filter(p => famSlug(familyKey(p.name)) === slug);
  if (!items.length) return showShop(chatId, messageId);

  const kb = [];
  products.forEach((p, i) => {
    if (famSlug(familyKey(p.name)) !== slug) return;
    const iconId = p.emoji || productIcon(p.name);
    const priceTxt = priceLabel(p, t);
    kb.push([styledButton(`${p.name} | ${priceTxt} | ${stockEmoji(p.stock)} ${p.stock}`, `desc_${i}`, "primary", iconId)]);
  });

  kb.push([styledButton(t.back || t.backHome, "shop", "danger", ICON("BACK"))]);

  const titulo = familyKey(items[0].name);
  const bonito = titulo.charAt(0).toUpperCase() + titulo.slice(1);
  const iconId = items[0].emoji || productIcon(items[0].name);
  const cabecera = iconId
    ? `<tg-emoji emoji-id="${iconId}">🛍️</tg-emoji> <b>${bonito}</b>`
    : `🛍️ <b>${bonito}</b>`;

  return editOrSend(chatId, messageId, `${cabecera}\n\n${t.chooseProduct}`, kb);
}

async function showCategoryList(chatId, messageId, matchFn, titulo, emoji, iconKey) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const products = sess(chatId).products || await loadProducts(chatId);
  if (!products || !products.length) return showShop(chatId, messageId);

  const kb = [];
  products.forEach((p, i) => {
    if (!matchFn(p)) return;
    const iconId = p.emoji || productIcon(p.name);
    const priceTxt = priceLabel(p, t);
    kb.push([styledButton(`${p.name} | ${priceTxt} | ${stockEmoji(p.stock)} ${p.stock}`, `desc_${i}`, "primary", iconId)]);
  });

  if (kb.length === 0) return showShop(chatId, messageId);
  kb.push([styledButton(t.back || t.backHome, "shop", "danger", ICON("BACK"))]);
  return editOrSend(chatId, messageId, `${tg(emoji, ICON(iconKey))} <b>${titulo}</b>\n\n${t.chooseProduct}`, kb);
}

// Redes disponibles dentro de FOLLOWERS (para agregar otra, una linea aqui)
const FOLLOWERS_REDES = [
  { label: "Instagram", cb: "cat_followers_ig", icon: "INSTAGRAM", match: isFollowersIgProduct },
  { label: "TikTok",    cb: "cat_followers_tt", icon: "TIKTOK",    match: isFollowersTtProduct }
];

// FOLLOWERS (padre): botones de red en 2 columnas
async function showFollowersCategory(chatId, messageId = null) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const products = sess(chatId).products || await loadProducts(chatId);
  if (!products || !products.length) return showShop(chatId, messageId);

  const sum = arr => arr.reduce((a, x) => a + Number(x.stock || 0), 0);
  const disponibles = FOLLOWERS_REDES
    .map(red => ({ red, items: products.filter(red.match) }))
    .filter(x => x.items.length > 0);

  if (disponibles.length === 0) return showShop(chatId, messageId);

  const kb = [];
  for (let i = 0; i < disponibles.length; i += 2) {
    kb.push(disponibles.slice(i, i + 2).map(({ red, items }) =>
      styledButton(`${red.label} \u25B8 ${items.length} (${sum(items)})`, red.cb, "primary", ICON(red.icon))
    ));
  }
  kb.push([styledButton(t.back || t.backHome, "shop", "danger", ICON("BACK"))]);
  return editOrSend(chatId, messageId, `${tg("\uD83D\uDC65", ICON("INSTAGRAM"))} <b>Followers</b>\n\n${t.chooseProduct}`, kb);
}

// Paquetes de una red, en 2 columnas
async function showFollowersRed(chatId, messageId, matchFn, titulo, iconKey) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const products = sess(chatId).products || await loadProducts(chatId);
  if (!products || !products.length) return showShop(chatId, messageId);

  const btns = [];
  products.forEach((p, i) => {
    if (!matchFn(p)) return;
    const mCant = String(p.name || "").match(/(\d[\d.,]*\s*[kKmM]?)/);
    const corto = mCant ? mCant[1].toUpperCase().replace(/\s+/g, "") : p.name;
    const priceTxt = priceLabel(p, t);
    btns.push(styledButton(`${corto} | ${priceTxt}`, `desc_${i}`, "primary", p.emoji || productIcon(p.name)));
  });

  if (btns.length === 0) return showFollowersCategory(chatId, messageId);

  const filas = [];
  for (let i = 0; i < btns.length; i += 2) filas.push(btns.slice(i, i + 2));
  filas.push([styledButton(t.back || t.backHome, "cat_followers", "danger", ICON("BACK"))]);
  return editOrSend(chatId, messageId, `${tg("\uD83D\uDC65", ICON(iconKey))} <b>${titulo}</b>\n\n${t.chooseProduct}`, filas);
}

async function showAdobeCategory(chatId, messageId = null) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const products = sess(chatId).products || await loadProducts(chatId);
  if (!products || !products.length) return showShop(chatId, messageId);

  const kb = [];
  products.forEach((p, i) => {
    if (!isAdobeProduct(p)) return;
    const iconId = p.emoji || productIcon(p.name);
    const priceTxt = priceLabel(p, t);
    kb.push([styledButton(`${p.name} | ${priceTxt} | ${stockEmoji(p.stock)} ${p.stock}`, `desc_${i}`, "primary", iconId)]);
  });

  if (kb.length === 0) return showShop(chatId, messageId);

  kb.push([styledButton(t.back || t.backHome, "shop", "danger", ICON("BACK"))]);
  return editOrSend(chatId, messageId, `${tg("\uD83C\uDFA8", ICON("ADOBECREATIVE"))} <b>Adobe Creative Cloud</b>\n\n${t.chooseProduct}`, kb);
}

async function showMicrosoftCategory(chatId, messageId = null) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const products = sess(chatId).products || await loadProducts(chatId);
  if (!products || !products.length) return showShop(chatId, messageId);

  const kb = [];
  products.forEach((p, i) => {
    if (!isMicrosoftProduct(p)) return;
    const iconId = p.emoji || productIcon(p.name);
    const priceTxt = priceLabel(p, t);
    kb.push([styledButton(`${p.name} | ${priceTxt} | ${stockEmoji(p.stock)} ${p.stock}`, `desc_${i}`, "primary", iconId)]);
  });

  if (kb.length === 0) return showShop(chatId, messageId);

  kb.push([styledButton(t.back || t.backHome, "shop", "danger", ICON("BACK"))]);
  return editOrSend(chatId, messageId, `${tg("\u2B1C", ICON("MICROSOFT"))} <b>Microsoft</b>\n\n${t.chooseProduct}`, kb);
}

async function showApiTokensCategory(chatId, messageId = null) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const products = sess(chatId).products || await loadProducts(chatId);
  if (!products || !products.length) return showShop(chatId, messageId);

  const kb = [];
  products.forEach((p, i) => {
    if (!isApiTokenProduct(p)) return;
    const iconId = p.emoji || productIcon(p.name);
    const priceTxt = priceLabel(p, t);
    kb.push([styledButton(`${p.name} | ${priceTxt} | ${stockEmoji(p.stock)} ${p.stock}`, `desc_${i}`, "primary", iconId)]);
  });

  if (kb.length === 0) return showShop(chatId, messageId);

  kb.push([styledButton(t.back || t.backHome, "shop", "danger", ICON("BACK"))]);
  return editOrSend(chatId, messageId, `${tg("🔑", ICON("CLAUDE"))} <b>API Tokens Claude Y Codex</b>\n\n${t.chooseProduct}`, kb);
}

// Boton "comprar" de un aviso de stock nuevo (broadcast): carga el catalogo
// fresco (no depende de una sesion previa) y salta directo a ese producto.
async function goToProductFromBroadcast(chatId, messageId, key) {
  const [kind, rawId] = key.split(/_(.+)/); // "manual_5" -> ["manual", "5"]
  const products = await loadProducts(chatId);
  const index = products.findIndex(p =>
    kind === "manual" ? (p.kind === "manual" && String(p.manualId) === String(rawId))
      : (p.kind === "kokoro" && String(p.id) === String(rawId))
  );
  if (index === -1) {
    const lang = await getUserLanguage(chatId); const t = L(lang);
    return editOrSend(chatId, messageId, `${tg("😕", ICON("ATENTION"))} ${t.noProducts}`, [[styledButton(t.shop, "shop", "success", ICON("CART"))]]);
  }
  return showDescription(chatId, messageId, index);
}

// ============================================================
//  Pantalla: Descripcion del producto (image 3)
// ============================================================
async function showDescription(chatId, messageId, index) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const p = (sess(chatId).products || [])[index];
  if (!p) return showShop(chatId, messageId);
  sess(chatId).current = index;

  const pe = productTextEmoji(p.name);
  let descHtml = "";
  // KOKORO no provee descripcion en arabe: se usa la version en ingles (mas util que el español para clientes ar).
  if (p.kind === "kokoro") descHtml = p.description_en || p.description_es || "";
  else {
    // Manual: elegir idioma segun el cliente (con fallback al otro idioma disponible)
    const manualDesc = (lang === "ar" ? p.description_ar : p.description_en)
      || p.description_ar || p.description_en || p.description_es || "";
    if (manualDesc) descHtml = `<blockquote>${htmlEscape(manualDesc)}</blockquote>`;
  }
  // Reemplazar el nombre del proveedor por el nombre de la tienda del revendedor
  if (descHtml) descHtml = descHtml.replace(/KOKORO[\s_]SHOP/gi, htmlEscape(SHOP_NAME));

  const sellerInfo = `${tg("🏪", ICON("SUCCESS_NEW"))} <b>${t.officialProduct}</b>\n${tg("⚡", ICON("LIGHTNING"))} ${t.instantDelivery}`;
  const text = `${tg("🛍", ICON("PAID_RED"))} <b>${t.availableProducts}</b>\n\n`
    + `${tg(pe.emoji, pe.id)} <b>${htmlEscape(p.name)}</b>\n\n`
    + `${sellerInfo}`
    + bulkDiscountBlock(p, t)
    + (descHtml ? `\n\n${descHtml}` : "");

  const priceTxt = priceLabel(p, t);
  const kb = [
    [styledButton(`${t.buyNow} | ${priceTxt} | ${stockEmoji(p.stock)} ${p.stock}`, `qty_${index}_${p.min_order}`, "primary", p.emoji || productIcon(p.name))],
    [styledButton(t.refresh, `desc_${index}`, "success", ICON("REFRESH"))],
    [styledButton(t.backToStore, "shop", "danger", ICON("BACK"))]
  ];
  return editOrSend(chatId, messageId, text, kb);
}

// ============================================================
//  Pantalla: Seleccion de cantidad (image 4)
// ============================================================
async function showQuantity(chatId, messageId, index, qty) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const p = (sess(chatId).products || [])[index];
  if (!p) return showShop(chatId, messageId);

  const minOrder = p.min_order || 1;
  qty = Math.max(Number(qty || minOrder), minOrder);
  if (qty > p.stock) qty = p.stock;
  sess(chatId).current = index;
  sess(chatId).qty = qty;

  const total = lineTotal(p, qty);
  const pe = productTextEmoji(p.name);
  const minusQty = Math.max(minOrder, qty - 1);
  const plusQty = Math.min(p.stock, qty + 1);

  const text = `${tg(pe.emoji, pe.id)} <b>${htmlEscape(p.name)}</b>\n\n`
    + `${tg("💰", ICON("MONEY"))} ${t.priceBase}: ${money(unitPriceForQty(p, qty))} USDT\n`
    + `${tg("📊", ICON("STOCK"))} ${t.availableStock}: ${p.stock}`
    + bulkDiscountBlock(p, t)
    + `\n\n${tg("✅", ICON("CHECK"))} ${t.selectedQty}: ${qty}\n`
    + `${tg("🟡", ICON("YELLOW"))} ${t.totalAmount}: ${money(total)} USDT`
    + nextBulkHint(p, qty, t)
    + `\n\n${t.selectQuantity}`;

  const kb = [
    [styledButton("−", `qty_${index}_${minusQty}`, "danger", ICON("CANCEL")),
     styledButton(`${qty}`, `qty_${index}_${qty}`, "success", ICON("GREEN_CHECK")),
     styledButton("+", `qty_${index}_${plusQty}`, "success", ICON("PLUS"))],
    [styledButton(`🛒 ${t.buyNow} x${qty}`, `paymethods_${index}_${qty}`, "success", ICON("BUY"))],
    [styledButton(t.refresh, `qty_${index}_${qty}`, "success", ICON("REFRESH")),
     styledButton(t.customQuantity, `custom_${index}`, "primary", ICON("CUSTOM_QTY"))],
    [styledButton(t.back, `desc_${index}`, "primary", ICON("BACK"))]
  ];
  return editOrSend(chatId, messageId, text, kb);
}

// ============================================================
//  Pantalla: Resumen de orden / metodos de pago (image 5)
// ============================================================
async function showPaymentMethods(chatId, messageId, index, qty) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const p = (sess(chatId).products || [])[index];
  if (!p) return showShop(chatId, messageId);
  sess(chatId).current = index;
  sess(chatId).qty = qty;

  const total = lineTotal(p, qty);
  const profile = await getUserProfile(chatId);
  const walletBalance = Number(profile.balance || 0);
  const pe = productTextEmoji(p.name);

  const text = `${tg("📦", ICON("STOCK"))} <b>${t.orderSummary}</b>\n\n`
    + `${tg(pe.emoji, pe.id)} ${t.product}: ${htmlEscape(p.name)}\n`
    + `${tg("✅", ICON("CHECK"))} ${t.quantity}: <b>${qty}</b>\n`
    + `${tg("💰", ICON("MONEY"))} ${t.orderValue}: <b>${money(total)} USDT</b>\n`
    + `${tg("🏦", ICON("MONEY"))} ${t.wallet}: <b>${money(walletBalance)} USDT</b>\n\n`
    + `<b>${t.choosePaymentMethod}</b>`;

  const kb = [
    [styledButton(t.buyBinance, `paybinance_${index}_${qty}`, "success", ICON("BINANCE_PAY"))]
  ];
  if (BEP20_WALLET) kb.push([styledButton(t.payBEP20, `paybep20_${index}_${qty}`, "success", ICON("BEP20"))]);
  kb.push([styledButton(t.payBalance, `paybalance_${index}_${qty}`, "primary", ICON("MONEY"))]);
  kb.push([styledButton(t.back, `qty_${index}_${qty}`, "danger", ICON("BACK"))]);
  return editOrSend(chatId, messageId, text, kb);
}

// ============================================================
//  Codigo de orden publico: EXE-7K3F9A (letras+numeros al azar,
//  se genera una sola vez al crear la orden y se guarda en orders.order_code
//  — a proposito NO correlativo, para no revelar volumen de ventas).
// ============================================================
const ORDER_CODE_PREFIX = "EXE";
const ORDER_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin O,0,I,1,L (se confunden)
function randomOrderCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += ORDER_CODE_CHARS[Math.floor(Math.random() * ORDER_CODE_CHARS.length)];
  return `${ORDER_CODE_PREFIX}-${s}`;
}
// Devuelve un codigo listo para usar, o null si la columna order_code todavia
// no existe (falta correr setup.sql) — en ese caso el insert simplemente
// omite el campo en vez de fallar la orden entera por esto.
async function generateUniqueOrderCode() {
  for (let i = 0; i < 6; i++) {
    const code = randomOrderCode();
    const { data, error } = await supabase.from("orders").select("id").eq("order_code", code).maybeSingle();
    if (error) {
      console.error("[ORDER CODE] no se pudo verificar (¿falta correr setup.sql?):", error.message);
      return null;
    }
    if (!data) return code;
  }
  return `${ORDER_CODE_PREFIX}-${Date.now().toString(36).toUpperCase().slice(-6)}`; // fallback ultra raro
}
// order puede ser el objeto completo (usa su order_code real) o solo el id numerico
// (ordenes viejas sin codigo asignado todavia: se muestra un formato de respaldo).
function orderCode(order) {
  if (order && typeof order === "object") return order.order_code || `${ORDER_CODE_PREFIX}-${String(order.id).padStart(6, "0")}`;
  return `${ORDER_CODE_PREFIX}-${String(order).padStart(6, "0")}`;
}

// Manda el contenido entregado tambien como archivo .txt adjunto (ademas del
// mensaje de texto), para pedidos con varias cuentas/codigos donde un archivo
// es mas comodo de guardar/copiar que un mensaje largo.
async function sendDeliveryFile(chatId, order, content) {
  try {
    const buffer = Buffer.from(String(content || "").trim(), "utf-8");
    if (!buffer.length) return; // nada que adjuntar
    await bot.sendDocument(chatId, buffer, {}, { filename: `${orderCode(order)}.txt`, contentType: "text/plain" });
  } catch (e) {
    console.error("[DELIVERY FILE]", e.message);
    sendAdminLog(`⚠️ <b>لم يتم إرسال ملف التسليم</b>\n\n🧾 الطلب <code>${orderCode(order)}</code>\n👤 ${chatId}\n❌ ${htmlEscape(e.message)}`).catch(() => {});
  }
}

// ============================================================
//  Entrega — pantalla premium con el codigo de orden bien visible
// ============================================================
function buildDeliveryText(t, order, content, remainingBalance) {
  const pe = productTextEmoji(order.product_name);
  let text = `${tg("✅", ICON("SUCCESS_NEW"))} <b>${t.orderDelivered}</b>\n`
    + `━━━━━━━━━━━━━━━\n\n`
    + `${tg(pe.emoji, pe.id)} <b>${htmlEscape(order.product_name)}</b>\n\n`
    + `${tg("🧾", ICON("NOTE"))} ${t.order}: <code>${orderCode(order)}</code>\n`
    + `${tg("💰", ICON("MONEY"))} ${t.amount}: <b>${money(order.total)} USDT</b>\n`;
  if (remainingBalance != null) text += `${tg("🔷", ICON("BLUE"))} ${t.remainingBalance}: <b>${money(remainingBalance)} USDT</b>\n`;
  else text += `${tg("🌟", ICON("STAR"))} ${t.seller}: <b>${SHOP_NAME}</b>\n`;
  text += `\n${tg("⚡", ICON("LIGHTNING"))} <b>${Number(order.quantity || 1) > 1 ? t.yourProducts : t.yourProduct}:</b>\n\n`
    + `${formatDeliveredProducts(content)}`;
  return text;
}

// Mensaje con boton de reorder tras la entrega (igual al bot principal)
async function sendReorderButton(chatId, t, order, unitPrice) {
  sess(chatId).lastOrder = { productId: String(order.product_id), productName: order.product_name, qty: Number(order.quantity || 1) };
  const label = `${t.reorderLabel} ${order.product_name} - $${money(unitPrice)}`;
  try {
    await bot.sendMessage(chatId, `${tg("✅", ICON("SUCCESS_NEW"))} <b>${t.orderDelivered}</b>`, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[styledButton(label, "reorder", "primary", productIcon(order.product_name))]] }
    });
  } catch (e) {}
}

// Reabrir el ultimo producto comprado
async function reorder(chatId) {
  const last = sess(chatId).lastOrder;
  if (!last) return showShop(chatId, null);
  const products = await loadProducts(chatId);
  let idx = products.findIndex(p => String(p.id) === last.productId);
  if (idx === -1) idx = products.findIndex(p => p.name === last.productName);
  if (idx === -1) return showShop(chatId, null);
  const p = products[idx];
  const qty = Math.min(Math.max(last.qty || p.min_order, p.min_order), p.stock || p.min_order);
  return showQuantity(chatId, null, idx, qty);
}

// Busca el proveedor de un producto (por id de products.provider_id). Si no tiene
// (datos viejos antes del multi-proveedor), cae al proveedor default del .env.
async function resolveProvider(providerId) {
  if (providerId) {
    const { data } = await supabase.from("api_providers").select("*").eq("id", providerId).maybeSingle();
    if (data) return data;
  }
  return defaultProviderFromEnv();
}

// Cumplir la entrega (API del proveedor correspondiente, o stock manual)
async function fulfillOrder(p, qty, chatId, orderId) {
  if (p.kind === "manual") return fulfillManual(p.manualId, qty, chatId, orderId);
  const provider = await resolveProvider(p.providerId);
  const res = await purchaseKokoro(provider, p.nativeId || p.id, qty, `LITE-${orderId}`);
  // res.orderId = número de orden del proveedor (para reclamar si algo pasa)
  return res.success
    ? { success: true, content: res.credentials, kokoroOrderId: res.orderId || null }
    : { success: false, message: res.error || res.message || "Delivery failed" };
}
async function fulfillManual(manualId, qty, chatId, orderId) {
  const { data: rows } = await supabase.from("stock_manual").select("*").eq("product_id", manualId).eq("is_sold", false).order("created_at").limit(qty);
  if (!rows || rows.length < qty) return { success: false, message: "Sin stock suficiente" };
  const ids = rows.map(r => r.id);
  // Guardamos también el número de orden en el stock (para saber qué orden consumió qué unidad)
  await supabase.from("stock_manual").update({ is_sold: true, sold_to: chatId, sold_at: new Date().toISOString(), order_id: orderId }).in("id", ids);
  return { success: true, content: rows.map(r => r.content).join("\n") };
}

// ============================================================
//  Confirmacion antes de pagar con BALANCE (igual al bot principal)
// ============================================================
async function showBalanceConfirm(chatId, messageId, index, qty) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const p = (sess(chatId).products || [])[index];
  if (!p) return showShop(chatId, messageId);
  const total = lineTotal(p, qty);
  const profile = await getUserProfile(chatId);
  const balance = Number(profile.balance || 0);
  const enough = balance + 0.000001 >= total;
  const pe = productTextEmoji(p.name);

  const text = `${tg("💰", ICON("MONEY"))} <b>${t.payWithBalanceTitle}</b>\n\n`
    + `${tg(pe.emoji, pe.id)} ${t.product}: <b>${htmlEscape(p.name)}</b>\n`
    + `${tg("⭐", ICON("STAR"))} ${t.seller}: <b>${SHOP_NAME}</b>\n`
    + `${tg("✅", ICON("CHECK"))} ${t.quantity}: <b>${qty}</b>\n`
    + `${tg("🟡", ICON("YELLOW"))} ${t.totalAmount}: <b>${money(total)} USDT</b>\n`
    + `${tg("🔷", ICON("BLUE"))} ${t.yourBalance}: <b>${money(balance)} USDT</b>\n\n`
    + (enough ? `<b>${t.confirmWallet}</b>` : `${tg("❌", ICON("CANCEL"))} <b>${t.insufficientBalanceShort}</b>\n${t.topupToBuy}`);

  const kb = enough
    ? [[styledButton(t.yesPayBalance, `balconfirm_${index}_${qty}`, "success", ICON("CHECK"))],
       [styledButton(t.cancel, `paymethods_${index}_${qty}`, "danger", ICON("CANCEL"))]]
    : [[styledButton(t.deposit, "deposit", "success", ICON("PLUS"))],
       [styledButton(t.back, `paymethods_${index}_${qty}`, "primary", ICON("BACK"))]];
  return editOrSend(chatId, messageId, text, kb);
}

// ============================================================
//  Compra con BALANCE
// ============================================================
async function buyWithBalance(chatId, messageId, index, qty) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const p = (sess(chatId).products || [])[index];
  if (!p) return showShop(chatId, messageId);
  const total = lineTotal(p, qty);

  const debit = await deductBalance(chatId, total);
  if (!debit.success) {
    if (debit.insufficient) return editOrSend(chatId, messageId, `${tg("⚠️", ICON("ATENTION"))} ${t.insufficient}`, [[styledButton(t.deposit, "deposit", "success", ICON("PLUS"))], [styledButton(t.back, `qty_${index}_${qty}`, "danger", ICON("BACK"))]]);
    return editOrSend(chatId, messageId, "Error, intenta de nuevo.", [[styledButton(t.back, `qty_${index}_${qty}`, "danger", ICON("BACK"))]]);
  }

  await editOrSend(chatId, messageId, `${tg("🔄", ICON("REFRESH"))} <b>${t.processingOrder}</b>`, []);

  const newOrderCode = await generateUniqueOrderCode();
  const { data: order, error: orderErr } = await supabase.from("orders").insert({
    telegram_id: chatId, product_id: String(p.id), product_name: p.name, quantity: qty,
    price: p.price, total, status: "paid", payment_method: "balance", source: p.kind === "manual" ? "manual" : "kokoro_api",
    ...(newOrderCode ? { order_code: newOrderCode } : {})
  }).select().single();

  if (!order) {
    // No se pudo crear la orden (ej. columna faltante, DB caida): reembolsar YA
    // y avisar, en vez de seguir con una compra sin registro en la base.
    await creditBalance(chatId, total, "Reembolso: no se pudo crear la orden");
    console.error("[ORDER INSERT]", orderErr?.message);
    await sendAdminLog(`🛑 <b>FALLO AL CREAR ORDEN (Balance)</b>\n\n👤 @${getUsername(chatId)}\n🆔 ${chatId}\n📦 ${p.name}\n❌ ${htmlEscape(orderErr?.message || "sin detalle")}`);
    return editOrSend(chatId, messageId, `${tg("⚠️", ICON("ATENTION"))} Error, intenta de nuevo.`, [[styledButton(t.back, `qty_${index}_${qty}`, "danger", ICON("BACK"))]]);
  }

  // Productos de activacion manual: en vez de entregar, se le pide el correo
  // (o el @usuario) al cliente. La orden queda pagada, no entregada.
  if (await productNeedsEmail(p.name)) {
    return startEmailActivationFlow(chatId, order, p, qty, t, lang);
  }

  const delivery = await fulfillOrder(p, qty, chatId, order?.id || Date.now());

  if (delivery.success) {
    if (order) await supabase.from("orders").update({ status: "delivered", delivery_message: String(delivery.content), delivered_at: new Date().toISOString(), kokoro_order_id: delivery.kokoroOrderId || null }).eq("id", order.id);
    const profile = await getUserProfile(chatId);
    const deliveredText = buildDeliveryText(t, { ...order, total, quantity: qty, product_name: p.name }, String(delivery.content), profile.balance);
    // Editar el mismo mensaje con la entrega (igual que el bot principal). Si es muy largo, enviar aparte.
    try {
      if (deliveredText.length <= 4000) await bot.editMessageText(deliveredText, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", disable_web_page_preview: true });
      else throw new Error("too_long");
    } catch (e) {
      await bot.sendMessage(chatId, deliveredText, { parse_mode: "HTML", disable_web_page_preview: true }).catch(async () => {
        await bot.sendMessage(chatId, buildDeliveryText(t, { ...order, total, quantity: qty, product_name: p.name }, "", profile.balance), { parse_mode: "HTML" });
        await bot.sendMessage(chatId, formatDeliveredProducts(String(delivery.content)), { parse_mode: "HTML", disable_web_page_preview: true });
      });
    }
    if (order?.id) await sendDeliveryFile(chatId, order, delivery.content);
    await sendAdminLog(`✅ COMPRA CONFIRMADA (Balance)\n\n👤 @${getUsername(chatId)}\n🆔 ${chatId}\n📦 ${p.name}\n🔢 ${qty}\n💰 ${money(total)} USDT\n🧾 #${order?.id || "-"}`);
    await sendReorderButton(chatId, t, { product_id: p.id, product_name: p.name, quantity: qty }, p.price);
    return;
  }

  await creditBalance(chatId, total, "Reembolso: entrega fallida");
  if (order) await supabase.from("orders").update({ status: "cancelled", delivery_message: delivery.message }).eq("id", order.id);
  await sendAdminLog(`⚠️ ERROR ENTREGA — REEMBOLSADO\n\n👤 @${getUsername(chatId)}\n🆔 ${chatId}\n📦 ${p.name} x${qty}\n❌ ${delivery.message}`);
  await bot.sendMessage(chatId, `${tg("⚠️", ICON("ATENTION"))} ${t.deliveryFail}`, { parse_mode: "HTML" });
}

// ============================================================
//  Pago DIRECTO con Binance Pay (image 6)
// ============================================================
async function showBinancePayment(chatId, messageId, index, qty) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const p = (sess(chatId).products || [])[index];
  if (!p) return showShop(chatId, messageId);
  const total = lineTotal(p, qty);
  const pe = productTextEmoji(p.name);

  // Cancelar ordenes viejas en espera de este usuario, y crear la orden AHORA (waiting_payment)
  await supabase.from("orders").update({ status: "cancelled" }).eq("telegram_id", chatId).eq("status", "waiting_payment");
  const newOrderCode = await generateUniqueOrderCode();
  const { data: order } = await supabase.from("orders").insert({
    telegram_id: chatId, product_id: String(p.id), product_name: p.name, quantity: qty,
    price: p.price, total, status: "waiting_payment", payment_method: "binance_pay", source: p.kind === "manual" ? "manual" : "kokoro_api",
    ...(newOrderCode ? { order_code: newOrderCode } : {})
  }).select().single();

  sess(chatId).awaiting = "purchase_binance_orderid";
  sess(chatId).pendingPurchase = { index, qty, total, method: "binance", orderId: order?.id };

  const text = `${tg("🔷", ICON("BLUE"))} <b>${t.directPayment}</b>\n\n`
    + `${tg(pe.emoji, pe.id)} ${t.product}: ${htmlEscape(p.name)}\n`
    + `${tg("🌟", ICON("STAR"))} ${t.seller}: ${SHOP_NAME}\n`
    + `${tg("✅", ICON("CHECK"))} ${t.quantity}: ${qty}\n`
    + `${tg("💰", ICON("MONEY"))} ${t.orderValue}: ${money(total)} USDT\n\n`
    + `${tg("📜", ICON("NOTE"))} Binance Pay ID: ${SHOP_NAME}\n<code>${htmlEscape(process.env.BINANCE_PAY_ID || "")}</code>\n\n`
    + `${tg("⚡", ICON("LIGHTNING"))} ${t.howToPay}\n1. ${t.payStepOne} <b>${money(total)} USDT</b>\n2. ${t.payStepTwo}\n3. ${t.payStepThree}\n\n`
    + `${tg("🔻", ICON("SUCCESS_NEW"))} ${t.autoVerification}\n\n`
    + `<blockquote>${t.deliveryAutomatic}</blockquote>`;

  const kb = [
    [styledButton(t.changeQuantity, `qty_${index}_${qty}`, "primary", ICON("CUSTOM_QTY"))],
    [styledButton(t.cancelOrder, `desc_${index}`, "danger", ICON("CANCEL"))],
    [styledButton(t.backToProduct, `desc_${index}`, "primary", ICON("BACK"))]
  ];
  return editOrSend(chatId, messageId, text, kb);
}

// ============================================================
//  Pago DIRECTO con BEP20 (monto unico)
// ============================================================
async function showBep20PaymentDirect(chatId, messageId, index, qty) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const p = (sess(chatId).products || [])[index];
  if (!p) return showShop(chatId, messageId);
  const total = lineTotal(p, qty);
  const pe = productTextEmoji(p.name);

  // Crear orden pendiente + pendiente BEP20 con monto unico
  const newOrderCode = await generateUniqueOrderCode();
  const { data: order } = await supabase.from("orders").insert({
    telegram_id: chatId, product_id: String(p.id), product_name: p.name, quantity: qty,
    price: p.price, total, status: "processing", payment_method: "bep20", source: p.kind === "manual" ? "manual" : "kokoro_api",
    ...(newOrderCode ? { order_code: newOrderCode } : {})
  }).select().single();

  const { montoUnico } = await payments.createBep20Pending(supabase, { telegram_id: chatId, type: "purchase", order_id: order?.id, base: total });

  sess(chatId).awaiting = "purchase_bep20_txid";
  sess(chatId).pendingPurchase = { index, qty, total, method: "bep20", orderId: order?.id, montoUnico };

  const text = `${tg("🔷", ICON("BLUE"))} <b>${t.directPayment}</b>\n\n`
    + `${tg(pe.emoji, pe.id)} ${t.product}: ${htmlEscape(p.name)}\n`
    + `${tg("🌟", ICON("STAR"))} ${t.seller}: ${SHOP_NAME}\n`
    + `${tg("✅", ICON("CHECK"))} ${t.quantity}: ${qty}\n`
    + `${tg("💰", ICON("MONEY"))} ${t.orderValue}: <b>${montoUnico} USDT</b>\n\n`
    + `${tg("📜", ICON("NOTE"))} ${t.walletAddress}:\n<code>${htmlEscape(BEP20_WALLET)}</code>\n\n`
    + `${tg("⚡", ICON("LIGHTNING"))} ${t.howToPay}\n1. ${t.sendExactUsdtBep20}\n2. ${t.copyTxid}\n3. ${t.pasteTxid}\n\n`
    + `${tg("⚠️", ICON("ATENTION"))} <i>${t.bscNetworkOnly}</i>\n\n`
    + `${tg("✅", ICON("SUCCESS_NEW"))} <b>${t.bep20ExactAmount}</b>\n\n`
    + `${tg("🔻", ICON("SUCCESS_NEW"))} ${t.autoVerification}\n\n`
    + `<blockquote>${t.deliveryAutomatic}</blockquote>`;

  const kb = [
    [styledButton(t.changeQuantity, `qty_${index}_${qty}`, "primary", ICON("CUSTOM_QTY"))],
    [styledButton(t.cancelOrder, `desc_${index}`, "danger", ICON("CANCEL"))],
    [styledButton(t.backToProduct, `desc_${index}`, "primary", ICON("BACK"))]
  ];
  return editOrSend(chatId, messageId, text, kb);
}

// ============================================================
//  Animacion de verificacion (barra de progreso) — IDENTICA
// ============================================================
function verifyingText(t, id, percent, message) {
  const filled = Math.round(percent / 10);
  const bar = "🟩".repeat(filled) + "⬜".repeat(10 - filled);
  return `⏳ <b>${t.verifyingTransaction}</b>\n\n`
    + `<blockquote>🔗 TxID: <code>${htmlEscape(id)}</code></blockquote>\n\n`
    + `${bar} ${percent}%\n\n`
    + `${tg("🔄", ICON("REFRESH"))} ${message}\n⏱ ${t.secondsRemaining}\n\n`
    + `<i>${t.waitConfirmPayment}</i>`;
}

// Verificar compra directa por Binance Order ID + entregar
async function confirmPurchaseBinance(chatId, orderId) {
  const lang = await getUserLanguage(chatId);
  const t = L(lang);
  const pp = sess(chatId).pendingPurchase;
  if (!pp) return;
  const clean = String(orderId).trim();
  if (!/^\d{15,25}$/.test(clean)) return;

  const { data: used } = await supabase.from("binance_payments").select("id").eq("transaction_id", clean).maybeSingle();
  if (used) return bot.sendMessage(chatId, `${tg("❌", ICON("CANCEL"))} ${t.orderIdUsed}`, { parse_mode: "HTML" });

  const checkingMsg = await bot.sendMessage(chatId, verifyingText(t, clean, 20, t.checkingApis), { parse_mode: "HTML" });
  await sleep(700);
  await bot.editMessageText(verifyingText(t, clean, 50, t.validatingOrderId), { chat_id: chatId, message_id: checkingMsg.message_id, parse_mode: "HTML" }).catch(() => {});

  const pay = await payments.verifyBinancePayOrder(clean);
  if (!pay.success) {
    return bot.editMessageText(`${tg("❌", ICON("CANCEL"))} <b>${t.verificationFailed}</b>\n\n${htmlEscape(pay.message)}`, { chat_id: chatId, message_id: checkingMsg.message_id, parse_mode: "HTML" }).catch(() => {});
  }
  if (process.env.BINANCE_PAY_ID && pay.receiverBinanceId && String(pay.receiverBinanceId) !== String(process.env.BINANCE_PAY_ID)) {
    return bot.editMessageText(`${tg("❌", ICON("CANCEL"))} <b>${t.verificationFailed}</b>`, { chat_id: chatId, message_id: checkingMsg.message_id, parse_mode: "HTML" }).catch(() => {});
  }
  if (String(pay.currency).toUpperCase() !== "USDT" || Number(pay.amount) + 0.001 < pp.total) {
    return bot.editMessageText(`${tg("❌", ICON("CANCEL"))} <b>${t.verificationFailed}</b>`, { chat_id: chatId, message_id: checkingMsg.message_id, parse_mode: "HTML" }).catch(() => {});
  }

  await payments.markTxidUsed(supabase, { telegram_id: chatId, txid: clean, amount: pay.amount, type: "purchase" });
  await bot.editMessageText(verifyingText(t, clean, 80, t.creditingWallet), { chat_id: chatId, message_id: checkingMsg.message_id, parse_mode: "HTML" }).catch(() => {});

  sess(chatId).awaiting = null;
  const p = (sess(chatId).products || [])[pp.index];
  // Actualizar la orden ya creada (waiting_payment -> paid); si no existe, crearla como fallback
  let order = null;
  if (pp.orderId) {
    const { data } = await supabase.from("orders").update({ status: "paid", payment_order_id: clean }).eq("id", pp.orderId).select().single();
    order = data;
  }
  if (!order) {
    const newOrderCode = await generateUniqueOrderCode();
    const { data } = await supabase.from("orders").insert({
      telegram_id: chatId, product_id: String(p.id), product_name: p.name, quantity: pp.qty,
      price: p.price, total: pp.total, status: "paid", payment_method: "binance_pay", source: p.kind === "manual" ? "manual" : "kokoro_api", payment_order_id: clean,
      ...(newOrderCode ? { order_code: newOrderCode } : {})
    }).select().single();
    order = data;
  }

  // Activacion manual: se pide el correo al cliente en vez de entregar.
  if (await productNeedsEmail(p.name)) {
    try { await bot.deleteMessage(chatId, checkingMsg.message_id); } catch (e) {}
    return startEmailActivationFlow(chatId, order, p, pp.qty, t, lang);
  }

  const delivery = await fulfillOrder(p, pp.qty, chatId, order?.id || Date.now());
  await finishDelivery(chatId, checkingMsg.message_id, t, order, p, pp.qty, pp.total, delivery, null);
}

// Entrega final compartida (edita el mensaje de verificacion con el resultado)
async function finishDelivery(chatId, messageId, t, order, p, qty, total, delivery, remainingBalance) {
  if (delivery.success) {
    if (order) await supabase.from("orders").update({ status: "delivered", delivery_message: String(delivery.content), delivered_at: new Date().toISOString(), kokoro_order_id: delivery.kokoroOrderId || null }).eq("id", order.id);
    const text = buildDeliveryText(t, { id: order?.id || "-", order_code: order?.order_code, product_name: p.name, total, quantity: qty }, String(delivery.content), remainingBalance);
    try { await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML" }); }
    catch (e) { await bot.sendMessage(chatId, text, { parse_mode: "HTML" }); }
    if (order?.id) await sendDeliveryFile(chatId, order, delivery.content);
    await sendAdminLog(`✅ COMPRA CONFIRMADA\n\n👤 @${getUsername(chatId)}\n🆔 ${chatId}\n📦 ${p.name}\n🔢 ${qty}\n💰 ${money(total)} USDT\n🧾 #${order?.id || "-"}`);
    await sendReorderButton(chatId, t, { product_id: (order?.product_id || p.id), product_name: p.name, quantity: qty }, qty > 0 ? total / qty : total);
    return;
  }
  if (order) await supabase.from("orders").update({ status: "paid", delivery_message: `Pendiente: ${delivery.message}` }).eq("id", order.id);
  await sendAdminLog(`⚠️ ERROR ENTREGA API — REQUIERE MANUAL\n\n👤 @${getUsername(chatId)}\n🆔 ${chatId}\n📦 ${p.name} x${qty}\n❌ ${delivery.message}\n🧾 #${order?.id || "-"}`);
  await bot.editMessageText(`${tg("⚠️", ICON("ATENTION"))} ${t.deliveryFail}`, { chat_id: chatId, message_id: messageId, parse_mode: "HTML" }).catch(() => {});
}

// ============================================================
//  Recargas (Top-up wallet)
// ============================================================
// Menu de recarga con niveles de bonus (igual al bot principal)
async function showDeposit(chatId, messageId) {
  const lang = await getUserLanguage(chatId); const t = L(lang);
  const text = `\n${tg("💰", ICON("MONEY"))} <b>${t.topupDeposit}</b>\n\n`
    + `<blockquote>\n${tg("🎁", ICON("GIFT"))} <b>${t.bonusTiers}</b>\n`
    + `└ $50 → +2% · ${t.getAmount} $51.00\n`
    + `└ $100 → +5% · ${t.getAmount} $105.00\n</blockquote>\n\n`
    + `<i>${t.pickPayment}</i>`;
  const kb = [
    [styledButton(t.binancePayDeposit, "dep_binance", "success", ICON("BINANCE_PAY"))]
  ];
  if (BEP20_WALLET) kb.push([styledButton(t.bep20Deposit, "dep_bep20", "success", ICON("BEP20"))]);
  kb.push([styledButton(t.backHome, "home", "danger", ICON("BACK"))]);
  return editOrSend(chatId, messageId, text, kb);
}

// Pantalla de deposito Binance Pay (NO pide monto; el monto lo lee la verificacion)
async function showBinanceDeposit(chatId, messageId) {
  const lang = await getUserLanguage(chatId); const t = L(lang);
  sess(chatId).awaiting = "topup_binance_orderid";
  const text = `\n${tg("💰", ICON("MONEY"))} <b>${t.binancePayDeposit}</b>\n\n`
    + `<b>${t.payId}:</b> <code>${htmlEscape(process.env.BINANCE_PAY_ID || "")}</code>\n`
    + `<b>${t.binanceName}:</b> <code>${htmlEscape(process.env.BINANCE_PAY_NAME || SHOP_NAME)}</code>\n\n`
    + `${tg("1️⃣", ICON("CHECK"))} ${t.sendExactUsdt}\n`
    + `${tg("2️⃣", ICON("CHECK"))} ${t.copyOrderId}\n`
    + `${tg("3️⃣", ICON("CHECK"))} ${t.pasteOrderId}\n\n`
    + `${tg("⚠️", ICON("ATENTION"))} <i>${t.onlyConfirmedPayId}</i>\n\n`
    + `${tg("🎁", ICON("GIFT"))} <b>Bonus:</b>\n\n$50+ → +2%\n$100+ → +5%\n\n`
    + `<b>${t.sendOrderIdBelow}</b>`;
  const kb = [
    [styledButton(`🆔 ${t.whereOrderId}`, "where_order_id", "primary", ICON("NOTE"))],
    [styledButton(`❌ ${t.cancel}`, "deposit", "danger", ICON("CANCEL"))]
  ];
  return editOrSend(chatId, messageId, text, kb);
}

// Paso 1 BEP20: pedir monto
async function showBep20AskAmount(chatId, messageId) {
  const lang = await getUserLanguage(chatId); const t = L(lang);
  sess(chatId).awaiting = "amount_bep20";
  const text = `${tg("💰", ICON("MONEY"))} <b>${t.bep20Deposit}</b>\n\n${t.bep20EnterAmount}\n\n<i>${t.bep20Example}</i>`;
  return editOrSend(chatId, messageId, text, [[styledButton(`❌ ${t.cancel}`, "deposit", "danger", ICON("CANCEL"))]]);
}

// Paso 2 BEP20: mostrar monto unico + instrucciones
async function handleDepositAmount(chatId, method, amountStr) {
  const lang = await getUserLanguage(chatId); const t = L(lang);
  const base = parseFloat(String(amountStr).replace(",", "."));
  if (!isFinite(base) || base <= 0) return bot.sendMessage(chatId, `${tg("⚠️", ICON("ATENTION"))} ${t.invalidAmount}`, { parse_mode: "HTML" });
  const { montoUnico } = await payments.createBep20Pending(supabase, { telegram_id: chatId, type: "topup", base });
  sess(chatId).awaiting = "bep20_txid";
  const text = `${tg("💰", ICON("MONEY"))} <b>${t.bep20Deposit}</b>\n\n`
    + `<b>${t.bep20AmountToSend}:</b> <code>${montoUnico} USDT</code>\n\n`
    + `<b>${t.walletAddress}:</b>\n<code>${htmlEscape(BEP20_WALLET)}</code>\n\n`
    + `${tg("💛", ICON("CHECK"))} ${t.sendExactUsdtBep20}\n`
    + `${tg("💛", ICON("CHECK"))} ${t.copyTxid}\n`
    + `${tg("💛", ICON("CHECK"))} ${t.pasteTxid}\n\n`
    + `${tg("⚠️", ICON("ATENTION"))} <i>${t.bscNetworkOnly}</i>\n\n`
    + `${tg("🎁", ICON("PERCENT"))} <b>Bonus:</b>\n$50+ → +2%\n$100+ → +5%\n\n`
    + `${tg("✅", ICON("SUCCESS_NEW"))} <b>${t.bep20ExactAmount}</b>\n\n`
    + `<b>${t.sendTxidBelow}</b>`;
  return bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[styledButton(`❌ ${t.cancel}`, "deposit", "danger", ICON("CANCEL"))]] } });
}
async function confirmTopupBep20(chatId, txid) {
  const lang = await getUserLanguage(chatId); const t = L(lang);
  const clean = String(txid).trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(clean)) return;
  const { data: used } = await supabase.from("binance_payments").select("id").eq("transaction_id", clean).maybeSingle();
  if (used) return bot.sendMessage(chatId, `${tg("❌", ICON("CANCEL"))} ${t.orderIdUsed}`, { parse_mode: "HTML" });
  const deposits = await payments.getRecentBEP20Deposits();
  const dep = deposits.find(d => d.txid === clean && d.confirmed);
  if (!dep) return bot.sendMessage(chatId, `${tg("⏳", ICON("LIGHTNING"))} ${t.waitConfirmPayment}`, { parse_mode: "HTML" });
  const { data: pendings } = await supabase.from("bep20_pending").select("*").eq("telegram_id", chatId).eq("type", "topup").eq("status", "pending");
  const match = (pendings || []).find(pp => payments.bep20AmountMatches(dep.amount, pp.monto_unico));
  const amount = match ? Number(match.monto_base || match.monto_unico) : dep.amount;
  await payments.markTxidUsed(supabase, { telegram_id: chatId, txid: clean, amount: dep.amount, type: "topup" });
  if (match) await supabase.from("bep20_pending").update({ status: "completed" }).eq("id", match.id);
  const bonus = topupBonus(amount);
  const newBal = await creditBalance(chatId, bonus.credit, `Recarga BEP20 ${clean.slice(0, 10)}${bonus.percent ? ` (+${bonus.percent}%)` : ""}`);
  sess(chatId).awaiting = null;
  await bot.sendMessage(chatId, `${tg("✅", ICON("SUCCESS_NEW"))} <b>${t.credited}</b>\n\n${tg("💰", ICON("MONEY"))} ${t.newBalance}: <b>${money(newBal)} USDT</b>`, { parse_mode: "HTML" });
  await sendAdminLog(`💵 RECARGA BEP20\n\n👤 @${getUsername(chatId)}\n🆔 ${chatId}\n💰 ${money(amount)} USDT${bonus.percent ? ` (+${bonus.percent}% = ${money(bonus.credit)})` : ""}\n🔗 ${clean}`);
  return showHome(chatId, null);
}
async function confirmTopupBinance(chatId, orderId) {
  const lang = await getUserLanguage(chatId); const t = L(lang);
  const clean = String(orderId).trim();
  if (!/^\d{15,25}$/.test(clean)) return;
  const { data: used } = await supabase.from("binance_payments").select("id").eq("transaction_id", clean).maybeSingle();
  if (used) return bot.sendMessage(chatId, `${tg("❌", ICON("CANCEL"))} ${t.orderIdUsed}`, { parse_mode: "HTML" });
  const checkingMsg = await bot.sendMessage(chatId, verifyingText(t, clean, 20, t.checkingApis), { parse_mode: "HTML" });
  await sleep(700);
  await bot.editMessageText(verifyingText(t, clean, 50, t.validatingOrderId), { chat_id: chatId, message_id: checkingMsg.message_id, parse_mode: "HTML" }).catch(() => {});
  const pay = await payments.verifyBinancePayOrder(clean);
  if (!pay.success) return bot.editMessageText(`${tg("❌", ICON("CANCEL"))} <b>${t.verificationFailed}</b>\n\n${htmlEscape(pay.message)}`, { chat_id: chatId, message_id: checkingMsg.message_id, parse_mode: "HTML" }).catch(() => {});
  if (process.env.BINANCE_PAY_ID && pay.receiverBinanceId && String(pay.receiverBinanceId) !== String(process.env.BINANCE_PAY_ID)) return bot.editMessageText(`${tg("❌", ICON("CANCEL"))} <b>${t.verificationFailed}</b>`, { chat_id: chatId, message_id: checkingMsg.message_id, parse_mode: "HTML" }).catch(() => {});
  if (String(pay.currency).toUpperCase() !== "USDT") return bot.editMessageText(`${tg("❌", ICON("CANCEL"))} <b>${t.verificationFailed}</b>`, { chat_id: chatId, message_id: checkingMsg.message_id, parse_mode: "HTML" }).catch(() => {});
  await payments.markTxidUsed(supabase, { telegram_id: chatId, txid: clean, amount: pay.amount, type: "topup" });
  await bot.editMessageText(verifyingText(t, clean, 80, t.creditingWallet), { chat_id: chatId, message_id: checkingMsg.message_id, parse_mode: "HTML" }).catch(() => {});
  const bonus = topupBonus(pay.amount);
  const newBal = await creditBalance(chatId, bonus.credit, `Recarga Binance Pay ${clean}${bonus.percent ? ` (+${bonus.percent}%)` : ""}`);
  sess(chatId).awaiting = null;
  await bot.editMessageText(`${tg("✅", ICON("SUCCESS_NEW"))} <b>${t.credited}</b>\n\n${tg("💰", ICON("MONEY"))} ${t.newBalance}: <b>${money(newBal)} USDT</b>`, { chat_id: chatId, message_id: checkingMsg.message_id, parse_mode: "HTML" }).catch(() => {});
  await sendAdminLog(`💵 RECARGA BINANCE PAY\n\n👤 @${getUsername(chatId)}\n🆔 ${chatId}\n💰 ${money(pay.amount)} USDT${bonus.percent ? ` (+${bonus.percent}% = ${money(bonus.credit)})` : ""}\n🧾 ${clean}`);
  return showHome(chatId, null);
}

// ============================================================
//  Balance / Ordenes / Idioma
// ============================================================
async function showBalance(chatId, messageId) {
  const lang = await getUserLanguage(chatId); const t = L(lang);
  const profile = await getUserProfile(chatId);
  return editOrSend(chatId, messageId, `${tg("💰", ICON("MONEY"))} <b>${t.yourBalance}</b>\n\n<b>${money(profile.balance)} USDT</b>`, [[styledButton(t.deposit, "deposit", "success", ICON("PLUS"))], [styledButton(t.backHome, "home", "danger", ICON("HOME"))]]);
}
function orderStatusLabel(t, status) {
  const v = String(status || "").toLowerCase();
  if (v === "delivered") return t.stDelivered;
  if (v === "cancelled") return t.stCancelled;
  return t.stProcessing;
}
function orderStatusStyle(status) {
  const v = String(status || "").toLowerCase();
  if (v === "cancelled") return "danger";
  if (v === "delivered") return "success";
  return "primary";
}
function orderStatusIcon(status) {
  const v = String(status || "").toLowerCase();
  if (v === "cancelled") return ICON("CANCEL");
  if (v === "delivered") return ICON("CHECK");
  return ICON("REFRESH");
}
function orderPaymentLabel(method) {
  const v = String(method || "").toLowerCase();
  if (v === "balance") return "Balance";
  if (v === "binance_pay") return "Binance Pay";
  if (v === "bep20") return "BEP20";
  return method || "-";
}

async function showOrders(chatId, messageId) {
  const lang = await getUserLanguage(chatId); const t = L(lang);
  const { data: orders } = await supabase.from("orders").select("*").eq("telegram_id", chatId).order("created_at", { ascending: false }).limit(20);
  if (!orders || orders.length === 0) return editOrSend(chatId, messageId, `${tg("📦", ICON("STOCK"))} <b>${t.myOrders}</b>\n\n${t.noOrders}`, [[styledButton(t.backHome, "home", "danger", ICON("HOME"))]]);
  const kb = orders.map(o => [
    styledButton(o.product_name || "Order", `order_${o.id}`, "primary", productIcon(o.product_name)),
    styledButton(orderStatusLabel(t, o.status), `order_${o.id}`, orderStatusStyle(o.status), orderStatusIcon(o.status))
  ]);
  kb.push([styledButton(t.backHome, "home", "danger", ICON("HOME"))]);
  return editOrSend(chatId, messageId, `${tg("📦", ICON("STOCK"))} <b>${t.myOrders}</b>`, kb);
}

async function showOrderDetail(chatId, messageId, orderId) {
  const lang = await getUserLanguage(chatId); const t = L(lang);
  const { data: order } = await supabase.from("orders").select("*").eq("telegram_id", chatId).eq("id", orderId).maybeSingle();
  if (!order) return editOrSend(chatId, messageId, `${tg("❌", ICON("CANCEL"))} ${t.orderNotFound}`, [[styledButton(t.backToOrders, "orders", "primary", ICON("BACK"))]]);

  const pe = productTextEmoji(order.product_name);
  const status = orderStatusLabel(t, order.status);
  const content = order.delivery_message || "";
  let received;
  if (content) received = formatDeliveredProducts(content);
  else if (String(order.status).toLowerCase() === "cancelled") received = `<i>${t.cancelledNoContent}</i>`;
  else received = `${tg("🔄", ICON("REFRESH"))} <i>${t.processingDelivery}</i>`;

  const header = `${tg("📦", ICON("PAID_RED"))} <b>${t.myOrders}</b>\n\n`
    + `${tg("🆔", ICON("BLUE"))} <b>${t.orderIdLabel}:</b> <code>${orderCode(order)}</code>\n`
    + `${tg(pe.emoji, pe.id)} <b>${t.product}:</b> ${htmlEscape(order.product_name || "-")}\n`
    + `${tg("🌟", ICON("STAR"))} <b>${t.seller}:</b> ${SHOP_NAME}\n`
    + `${tg("⭐", ICON("STAR"))} <b>${t.typeLabel}:</b> ${orderPaymentLabel(order.payment_method)}\n`
    + `${tg("📦", ICON("STOCK"))} <b>${t.quantity}:</b> ${Number(order.quantity || 1)}\n`
    + `${tg("💰", ICON("MONEY"))} <b>${t.totalAmount}:</b> ${money(order.total)} USDT\n`
    + `${tg("✅", ICON("CHECK"))} <b>${t.statusLabel}:</b> ${status}\n\n`
    + `<b>${t.receivedLabel}:</b>`;

  const back = [
    [styledButton(t.reportIssue, `report_${order.id}`, "danger", ICON("ATENTION"))],
    [styledButton(t.backToOrders, "orders", "primary", ICON("BACK"))]
  ];
  const full = `${header}\n\n${received}`;
  if (full.length > 4000) {
    await editOrSend(chatId, messageId, header, back);
    return bot.sendMessage(chatId, received, { parse_mode: "HTML", disable_web_page_preview: true });
  }
  return editOrSend(chatId, messageId, full, back);
}

// ============================================================
//  Reportar un problema con una orden (crea un ticket de soporte)
// ============================================================
async function startReportIssue(chatId, messageId, orderId) {
  const lang = await getUserLanguage(chatId); const t = L(lang);
  const { data: order } = await supabase.from("orders").select("*").eq("telegram_id", chatId).eq("id", orderId).maybeSingle();
  if (!order) return editOrSend(chatId, messageId, `${tg("❌", ICON("CANCEL"))} ${t.orderNotFound}`, [[styledButton(t.backToOrders, "orders", "primary", ICON("BACK"))]]);
  sess(chatId).awaiting = "report_issue";
  sess(chatId).reportOrderId = orderId;
  return editOrSend(chatId, messageId, `${tg("⚠️", ICON("ATENTION"))} <b>${t.reportIssue}</b>\n\n${t.reportIssuePrompt}`,
    [[styledButton(t.back, `order_${orderId}`, "danger", ICON("BACK"))]]);
}

async function submitReportIssue(chatId, text) {
  const lang = await getUserLanguage(chatId); const t = L(lang);
  const desc = String(text || "").trim();
  const orderId = sess(chatId).reportOrderId;
  if (desc.length < 4) return bot.sendMessage(chatId, t.reportIssueTooShort);

  sess(chatId).awaiting = null;
  sess(chatId).reportOrderId = null;

  const { data: ticket, error } = await supabase.from("support_tickets").insert({
    order_id: orderId || null, telegram_id: chatId, description: desc
  }).select().single();
  if (error) { console.error("[TICKET] insert error:", error.message); return; }

  let orderCodeLine = "";
  if (orderId) {
    const { data: relatedOrder } = await supabase.from("orders").select("id, order_code").eq("id", orderId).maybeSingle();
    if (relatedOrder) orderCodeLine = `🧾 الطلب <code>${orderCode(relatedOrder)}</code>\n`;
  }

  await bot.sendMessage(chatId, t.reportIssueReceived);
  await sendAdminLog(
    `⚠️ <b>تذكرة دعم جديدة #${ticket.id}</b>\n\n` +
    `👤 @${getUsername(chatId)}\n🆔 <code>${chatId}</code>\n` +
    orderCodeLine +
    `📝 ${htmlEscape(desc)}`
  );
}
async function showLanguage(chatId, messageId) {
  const lang = await getUserLanguage(chatId); const t = L(lang);
  const kb = [[styledButton("🇺🇸 English", "setlang_en", "success"), styledButton("🇸🇦 العربية", "setlang_ar", "primary")], [styledButton(t.backHome, "home", "danger", ICON("HOME"))]];
  return editOrSend(chatId, messageId, `${tg("🌐", ICON("HOME"))} <b>${t.langChoose}</b>`, kb);
}
async function showLangSelection(chatId, messageId) {
  const kb = [[styledButton("🇺🇸 English", "setlang_en", "success"), styledButton("🇸🇦 العربية", "setlang_ar", "primary")]];
  return editOrSend(chatId, messageId, `${tg("🌐", ICON("HOME"))} <b>Choose your language / اختر لغتك</b>`, kb);
}

// ============================================================
//  Handlers
// ============================================================
// ============================================================
//  Comandos del dueño de la tienda para la lista de activacion manual.
//  Solo responden en el chat/grupo de logs (ADMIN_LOG_GROUP).
// ============================================================
function esAdminBotlite(chatId) {
  return ADMIN_LOG_GROUP && String(chatId) === String(ADMIN_LOG_GROUP);
}

bot.onText(/^\/correos_add(?:\s+([\s\S]+))?$/, async msg => {
  const chatId = msg.chat.id;
  if (!esAdminBotlite(chatId)) return;
  const txt = (msg.text.match(/^\/correos_add\s+([\s\S]+)$/) || [])[1];
  if (!txt) {
    return bot.sendMessage(chatId,
      "Uso: /correos_add <NOMBRE EXACTO del producto>\n\n" +
      "Ejemplo: /correos_add Photoshop 6M\n\n" +
      "Debe ser el nombre COMPLETO (coincidencia exacta, para no confundir productos parecidos).");
  }
  const nombre = txt.trim();
  const { error } = await supabase.from("email_activation_products").insert({ name_contains: nombre });
  if (error) return bot.sendMessage(chatId, "No se pudo agregar: " + error.message);
  global.emailActivationListTime = 0;   // forzar recarga
  return bot.sendMessage(chatId, `✅ Agregado: <b>${nombre}</b>\n\nAhora ese producto pedira el correo al cliente en vez de entregarse solo.`, { parse_mode: "HTML" });
});

bot.onText(/^\/entregar$/, async msg => {
  const chatId = msg.chat.id;
  if (!esAdminBotlite(chatId)) return;
  return iniciarEntregaManual(chatId);
});

bot.onText(/^\/cancelar$/, async msg => {
  const chatId = msg.chat.id;
  if (!esAdminBotlite(chatId)) return;
  if (!global.entregaSessions[chatId]) return;
  delete global.entregaSessions[chatId];
  return bot.sendMessage(chatId, "❌ Entrega manual cancelada.");
});

bot.onText(/^\/correos_list$/, async msg => {
  const chatId = msg.chat.id;
  if (!esAdminBotlite(chatId)) return;
  const lista = await loadEmailActivationList(true);
  if (!lista.length) return bot.sendMessage(chatId, "No hay productos con activacion por correo.\n\nAgrega uno con /correos_add <nombre>");
  return bot.sendMessage(chatId, "📧 <b>Productos que piden correo:</b>\n\n" + lista.map((x, i) => `${i + 1}. ${x}`).join("\n"), { parse_mode: "HTML" });
});

bot.onText(/^\/correos_del(?:\s+([\s\S]+))?$/, async msg => {
  const chatId = msg.chat.id;
  if (!esAdminBotlite(chatId)) return;
  const txt = (msg.text.match(/^\/correos_del\s+([\s\S]+)$/) || [])[1];
  if (!txt) return bot.sendMessage(chatId, "Uso: /correos_del <NOMBRE EXACTO>\n\nVe la lista con /correos_list");
  const nombre = txt.trim();
  const { error } = await supabase.from("email_activation_products").delete().eq("name_contains", nombre);
  if (error) return bot.sendMessage(chatId, "No se pudo quitar: " + error.message);
  global.emailActivationListTime = 0;
  return bot.sendMessage(chatId, `✅ Quitado: <b>${nombre}</b>\n\nVuelve a entregarse automaticamente.`, { parse_mode: "HTML" });
});

bot.onText(/\/start/, async msg => {
  const chatId = msg.chat.id;
  await syncUsername(chatId, msg.from);
  const { data: user } = await supabase.from("users").select("*").eq("id", chatId).maybeSingle();
  await sendAdminLog(`🚀 CLICK START\n\n👤 ${msg.from.first_name || "-"}\n📛 @${msg.from.username || "sin_username"}\n🆔 ${chatId}`);

  // GATE de canal: solo se aplica si CHANNEL_URL está configurado en el .env
  const gateLang = (user && user.language) ? user.language : ((msg.from.language_code || "en").startsWith("ar") ? "ar" : "en");
  if (!(await isUserInChannel(chatId))) {
    return showJoinChannelGate(chatId, gateLang, null);
  }

  // Usuario nuevo o sin idioma -> mostrar selector (ahi se crea/guarda en Supabase)
  if (!user || !user.language) return showLangSelection(chatId, null);
  return showHome(chatId, null);
});

// ============================================================
//  Atajos de comandos (/shop, /balance, /deposit, /orders, /language,
//  /support, /help) — mismo gate de canal/idioma que /start antes de
//  saltar directo a la pantalla pedida.
// ============================================================
async function ensureReadyForShortcut(chatId, msg) {
  await syncUsername(chatId, msg.from);
  const { data: user } = await supabase.from("users").select("*").eq("id", chatId).maybeSingle();
  const gateLang = (user && user.language) ? user.language : ((msg.from.language_code || "en").startsWith("ar") ? "ar" : "en");
  if (!(await isUserInChannel(chatId))) { await showJoinChannelGate(chatId, gateLang, null); return false; }
  if (!user || !user.language) { await showLangSelection(chatId, null); return false; }
  return true;
}

bot.onText(/^\/shop$/, async msg => {
  const chatId = msg.chat.id;
  if (await ensureReadyForShortcut(chatId, msg)) return showShop(chatId, null);
});
bot.onText(/^\/balance$/, async msg => {
  const chatId = msg.chat.id;
  if (await ensureReadyForShortcut(chatId, msg)) return showBalance(chatId, null);
});
bot.onText(/^\/deposit$/, async msg => {
  const chatId = msg.chat.id;
  if (await ensureReadyForShortcut(chatId, msg)) return showDeposit(chatId, null);
});
bot.onText(/^\/orders$/, async msg => {
  const chatId = msg.chat.id;
  if (await ensureReadyForShortcut(chatId, msg)) return showOrders(chatId, null);
});
bot.onText(/^\/language$/, async msg => {
  const chatId = msg.chat.id;
  if (await ensureReadyForShortcut(chatId, msg)) return showLanguage(chatId, null);
});
bot.onText(/^\/support$/, async msg => {
  const chatId = msg.chat.id;
  if (!(await ensureReadyForShortcut(chatId, msg))) return;
  const lang = await getUserLanguage(chatId); const t = L(lang);
  const url = String(process.env.SUPPORT_URL || "").trim();
  if (!url) return bot.sendMessage(chatId, lang === "ar" ? "الدعم غير مفعّل حاليًا." : "Support is not configured yet.");
  return bot.sendMessage(chatId, `${tg("🆘", ICON("BELL"))} <b>${t.support}</b>`, {
    parse_mode: "HTML", reply_markup: { inline_keyboard: [[styledUrlButton(t.support, url, "danger", ICON("BELL"))]] }
  });
});
bot.onText(/^\/help$/, async msg => {
  const chatId = msg.chat.id;
  if (!(await ensureReadyForShortcut(chatId, msg))) return;
  const lang = await getUserLanguage(chatId);
  const helpText = lang === "ar"
    ? `<b>📋 الأوامر المتاحة</b>\n\n/start — القائمة الرئيسية\n/shop — المتجر\n/balance — رصيدي\n/deposit — شحن المحفظة\n/orders — مشترياتي\n/language — تغيير اللغة\n/support — الدعم\n/help — هذه القائمة`
    : `<b>📋 Available commands</b>\n\n/start — Main menu\n/shop — Shop\n/balance — My balance\n/deposit — Top-up wallet\n/orders — My orders\n/language — Change language\n/support — Support\n/help — This list`;
  return bot.sendMessage(chatId, helpText, { parse_mode: "HTML" });
});

bot.on("callback_query", async query => {
  try {
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;
    const data = query.data;
    syncUsername(chatId, query.from);
    if (data !== "where_order_id") { try { await bot.answerCallbackQuery(query.id); } catch (e) {} }
    if (data === "noop") return;

    if (data === "setlang_en" || data === "setlang_ar") {
      const language = data === "setlang_ar" ? "ar" : "en";
      const { data: existing } = await supabase.from("users").select("*").eq("id", chatId).maybeSingle();
      const liveUsername = query.from.username || null;
      global.usernames[chatId] = query.from.username || "sin_username";
      await supabase.from("users").upsert({ id: chatId, language, username: liveUsername, balance: existing?.balance || 0 });
      if (!existing || !existing.language) {
        try { const { count } = await supabase.from("users").select("*", { count: "exact", head: true }); await sendAdminLog(`😍 NUEVO USUARIO REGISTRADO\n\n👤 ${query.from.first_name || "-"}\n📛 @${query.from.username || "sin_username"}\n🆔 ${chatId}\n👥 Usuario #${count || "?"}`); } catch (e) {}
      }
      return showHome(chatId, messageId);
    }

    // Verificación del canal ("Ya me uní")
    if (data === "check_channel") {
      const langChk = await getUserLanguage(chatId);
      if (!(await isUserInChannel(chatId))) {
        try { await bot.answerCallbackQuery(query.id, { text: langChk === "ar" ? "لم تنضم إلى القناة بعد" : "You haven't joined yet", show_alert: true }); } catch (e) {}
        return;
      }
      const { data: u } = await supabase.from("users").select("*").eq("id", chatId).maybeSingle();
      if (!u || !u.language) return showLangSelection(chatId, messageId);
      return showHome(chatId, messageId);
    }

    if (data === "home") return showHome(chatId, messageId);
    if (data === "shop") return showShop(chatId, messageId);
    if (data === "cat_api_tokens") return showApiTokensCategory(chatId, messageId);
    if (data === "cat_microsoft") return showMicrosoftCategory(chatId, messageId);
    if (data === "cat_adobe") return showAdobeCategory(chatId, messageId);
    if (data === "cat_followers") return showFollowersCategory(chatId, messageId);
    if (data === "cat_followers_ig") return showFollowersRed(chatId, messageId, isFollowersIgProduct, "Instagram Followers", "INSTAGRAM");
    if (data === "cat_followers_tt") return showFollowersRed(chatId, messageId, isFollowersTtProduct, "TikTok Followers", "TIKTOK");
    // Grupo automatico por marca (productos sin categoria propia, incluidos
    // los manuales). Va antes que las categorias fijas por ser mas general.
    if (data.startsWith("cat_fam_")) return showFamilyCategory(chatId, messageId, data.replace("cat_fam_", ""));

    if (data === "cat_disney") return showCategoryList(chatId, messageId, isDisneyProduct, "Disney", "\uD83C\uDFAC", "DISNEY");
    if (data === "cat_spotify") return showCategoryList(chatId, messageId, isSpotifyProduct, "Spotify", "\uD83C\uDFB5", "SPOTIFY");
    if (data === "cat_youtube") return showCategoryList(chatId, messageId, isYoutubeProduct, "YouTube", "\u25B6\uFE0F", "YOUTUBE");
    if (data === "cat_prime") return showCategoryList(chatId, messageId, isPrimeVideoProduct, "Prime Video", "\uD83D\uDCFA", "PRIMEVIDEO");
    if (data === "cat_lovable") return showCategoryList(chatId, messageId, isLovableProduct, "Lovable", "\uD83D\uDCAC", "LOVABLE");
    if (data === "cat_notion") return showCategoryList(chatId, messageId, isNotionProduct, "Notion Business", "\uD83D\uDCD4", "NOTION");
    if (data === "cat_cursor") return showCursorCategory(chatId, messageId);
    if (data === "balance") return showBalance(chatId, messageId);
    if (data === "deposit") return showDeposit(chatId, messageId);
    if (data === "orders") return showOrders(chatId, messageId);
    if (data.startsWith("order_")) return showOrderDetail(chatId, messageId, parseInt(data.split("_")[1]));
    if (data.startsWith("report_")) return startReportIssue(chatId, messageId, parseInt(data.split("_")[1]));
    if (data === "language") return showLanguage(chatId, messageId);
    if (data === "dep_binance") return showBinanceDeposit(chatId, messageId);
    if (data === "dep_bep20") return showBep20AskAmount(chatId, messageId);
    if (data === "where_order_id") { const t = L(await getUserLanguage(chatId)); return bot.answerCallbackQuery(query.id, { text: t.whereOrderIdHelp, show_alert: true }).catch(() => {}); }

    if (data.startsWith("desc_")) return showDescription(chatId, messageId, parseInt(data.split("_")[1]));
    if (data.startsWith("buyprod_")) return goToProductFromBroadcast(chatId, messageId, data.replace("buyprod_", ""));
    if (data.startsWith("qty_")) { const [, i, q] = data.split("_"); return showQuantity(chatId, messageId, parseInt(i), parseInt(q)); }
    if (data.startsWith("paymethods_")) { const [, i, q] = data.split("_"); return showPaymentMethods(chatId, messageId, parseInt(i), parseInt(q)); }
    if (data.startsWith("paybinance_")) { const [, i, q] = data.split("_"); return showBinancePayment(chatId, messageId, parseInt(i), parseInt(q)); }
    if (data.startsWith("paybep20_")) { const [, i, q] = data.split("_"); return showBep20PaymentDirect(chatId, messageId, parseInt(i), parseInt(q)); }
    if (data.startsWith("paybalance_")) { const [, i, q] = data.split("_"); return showBalanceConfirm(chatId, messageId, parseInt(i), parseInt(q)); }
    if (data.startsWith("balconfirm_")) { const [, i, q] = data.split("_"); return buyWithBalance(chatId, messageId, parseInt(i), parseInt(q)); }
    if (data === "reorder") return reorder(chatId);
    if (data.startsWith("custom_")) {
      const i = parseInt(data.split("_")[1]);
      sess(chatId).awaiting = "custom_qty";
      sess(chatId).customIndex = i;
      sess(chatId).customMsgId = messageId;
      const t = L(await getUserLanguage(chatId));
      const p = (sess(chatId).products || [])[i];
      const backQty = sess(chatId).qty || (p?.min_order || 1);
      return editOrSend(
        chatId,
        messageId,
        `${tg("➕", ICON("PLUS"))} <b>${t.customQuantity}</b>\n\n${t.customQuantityPrompt}`,
        [[styledButton(t.back, `qty_${i}_${backQty}`, "primary", ICON("BACK"))]]
      );
    }
  } catch (err) {
    console.error("[CALLBACK] error:", err.message);
  }
});

bot.on("message", async msg => {
  try {
    const chatId = msg.chat.id;
    const text = String(msg.text || "").trim();
    if (msg.from) syncUsername(chatId, msg.from);
    if (!text || text.startsWith("/")) return;

    // Entrega manual en curso desde el grupo de logs (/entregar).
    if (global.entregaSessions[chatId]) {
      return entregaManualPaso(chatId, text);
    }

    // Cliente enviando el correo / @usuario para activar su servicio.
    // Va antes que los demas flujos: no usa `awaiting`, tiene su propia sesion.
    if (global.emailSessions[chatId]) {
      return recibirDatoActivacion(chatId, text);
    }

    const s = sess(chatId);
    const awaiting = s.awaiting;
    if (!awaiting) return;

    if (awaiting === "report_issue") return submitReportIssue(chatId, text);
    if (awaiting === "amount_bep20") return handleDepositAmount(chatId, "bep20", text);
    if (awaiting === "bep20_txid") return confirmTopupBep20(chatId, text);
    if (awaiting === "topup_binance_orderid") return confirmTopupBinance(chatId, text);
    if (awaiting === "purchase_binance_orderid") return confirmPurchaseBinance(chatId, text);
    if (awaiting === "purchase_bep20_txid") return confirmPurchaseBep20(chatId, text);
    if (awaiting === "custom_qty") {
      const q = parseInt(text.replace(/[^\d]/g, ""));
      s.awaiting = null;
      if (!q || q < 1) return;
      const editId = s.customMsgId || null;
      s.customMsgId = null;
      return showQuantity(chatId, editId, s.customIndex, q);
    }
  } catch (err) {
    console.error("[MESSAGE] error:", err.message);
  }
});

// Confirmar compra directa BEP20 por TXID manual
async function confirmPurchaseBep20(chatId, txid) {
  const lang = await getUserLanguage(chatId); const t = L(lang);
  const pp = sess(chatId).pendingPurchase;
  if (!pp) return;
  const clean = String(txid).trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(clean)) return;
  const { data: used } = await supabase.from("binance_payments").select("id").eq("transaction_id", clean).maybeSingle();
  if (used) return bot.sendMessage(chatId, `${tg("❌", ICON("CANCEL"))} ${t.orderIdUsed}`, { parse_mode: "HTML" });
  const deposits = await payments.getRecentBEP20Deposits();
  const dep = deposits.find(d => d.txid === clean && d.confirmed && payments.bep20AmountMatches(d.amount, pp.montoUnico));
  if (!dep) return bot.sendMessage(chatId, `${tg("⏳", ICON("LIGHTNING"))} ${t.waitConfirmPayment}`, { parse_mode: "HTML" });
  await deliverDirectBep20Purchase(chatId, clean);
}

// Entrega de compra directa BEP20 (usada por TXID manual y por el poller)
async function deliverDirectBep20Purchase(chatId, txid, orderIdFromPoller) {
  const lang = await getUserLanguage(chatId); const t = L(lang);
  const pp = sess(chatId).pendingPurchase || {};
  const orderId = pp.orderId || orderIdFromPoller;
  const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order || order.status === "delivered") return;

  await payments.markTxidUsed(supabase, { telegram_id: chatId, txid, amount: order.total, type: "purchase" }).catch(() => {});
  await supabase.from("orders").update({ status: "paid", payment_order_id: txid }).eq("id", order.id);

  const products = sess(chatId).products || await loadProducts(chatId);
  let p = products[pp.index];
  if (!p) {
    p = { kind: order.source === "manual" ? "manual" : "kokoro", id: order.product_id, name: order.product_name, manualId: String(order.product_id).replace(/^m/, "") };
    // Sesion perdida: recuperar provider_id/native_id reales desde la tabla products
    // para no mandar el ID equivocado al proveedor equivocado si hay mas de uno activo.
    if (p.kind === "kokoro") {
      const { data: prow } = await supabase.from("products").select("provider_id, native_id").eq("id", order.product_id).maybeSingle();
      if (prow) { p.providerId = prow.provider_id; p.nativeId = prow.native_id; }
    }
  }

  const checkingMsg = await bot.sendMessage(chatId, verifyingText(t, txid, 80, t.creditingWallet), { parse_mode: "HTML" });
  // Activacion manual: se pide el correo al cliente en vez de entregar.
  if (await productNeedsEmail(p.name || order.product_name)) {
    try { await bot.deleteMessage(chatId, checkingMsg.message_id); } catch (e) {}
    sess(chatId).awaiting = null;
    return startEmailActivationFlow(chatId, order, { ...p, name: p.name || order.product_name }, order.quantity, t, lang);
  }

  const delivery = await fulfillOrder(p, order.quantity, chatId, order.id);
  sess(chatId).awaiting = null;
  await finishDelivery(chatId, checkingMsg.message_id, t, order, { kind: p.kind, name: order.product_name, id: order.product_id }, order.quantity, order.total, delivery, null);
}

// ============================================================
//  Arranque
// ============================================================
// Menu de "/" en Telegram: aparecen como sugerencias al escribir "/".
// Telegram solo permite un idioma de descripciones por comando, se usan en ingles+arabe combinados.
bot.setMyCommands([
  { command: "start", description: "القائمة الرئيسية / Main menu" },
  { command: "shop", description: "المتجر / Shop" },
  { command: "balance", description: "رصيدي / My balance" },
  { command: "deposit", description: "شحن المحفظة / Top-up wallet" },
  { command: "orders", description: "مشترياتي / My orders" },
  { command: "language", description: "تغيير اللغة / Change language" },
  { command: "support", description: "الدعم / Support" },
  { command: "help", description: "قائمة الأوامر / List of commands" }
]).catch(e => console.error("[COMMANDS] no se pudieron registrar:", e.message));

startProductSync(supabase);

payments.startBep20Poller(supabase, {
  onTopup: async (telegram_id, amount, txid) => {
    await payments.markTxidUsed(supabase, { telegram_id, txid, amount, type: "topup" });
    const bonus = topupBonus(amount);
    const newBal = await creditBalance(telegram_id, bonus.credit, `Recarga BEP20 auto ${String(txid).slice(0, 10)}${bonus.percent ? ` (+${bonus.percent}%)` : ""}`);
    const t = L(await getUserLanguage(telegram_id));
    try { await bot.sendMessage(telegram_id, `${tg("✅", ICON("SUCCESS_NEW"))} <b>${t.credited}</b>\n\n${tg("💰", ICON("MONEY"))} ${t.newBalance}: <b>${money(newBal)} USDT</b>`, { parse_mode: "HTML" }); } catch (e) {}
    await sendAdminLog(`💵 RECARGA BEP20 (auto)\n\n👤 @${getUsername(telegram_id)}\n🆔 ${telegram_id}\n💰 ${money(amount)} USDT${bonus.percent ? ` (+${bonus.percent}% = ${money(bonus.credit)})` : ""}\n🔗 ${txid}`);
  },
  onPurchase: async (order_id, telegram_id, txid) => {
    try { await deliverDirectBep20Purchase(telegram_id, txid, order_id); }
    catch (e) { console.error("[BEP20] onPurchase error:", e.message); }
  }
});

(async () => {
  // Espera un momento a que termine la primera sincronizacion (crea el proveedor
  // default si hace falta) antes de listar los proveedores activos.
  await sleep(1500);
  const providers = await getActiveProviders(supabase);
  if (!providers.length) { console.log("[KOKORO] No hay proveedores de API activos configurados."); return; }
  for (const provider of providers) {
    const bal = await fetchKokoroBalance(provider);
    if (bal.success) console.log(`[KOKORO] Saldo prepago (${provider.name}): ${money(bal.balance)} USDT`);
    else console.log(`[KOKORO] No se pudo leer el saldo de "${provider.name}": ${bal.error}`);
  }
})();

// Servidor HTTP minimo: solo para que Railway (u otro host) detecte un puerto
// abierto y marque el deploy como sano. No sirve ninguna pagina real.
if (process.env.PORT) {
  require("http").createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`${SHOP_NAME} bot esta corriendo.`);
  }).listen(process.env.PORT, () => console.log(`[HTTP] Healthcheck activo en el puerto ${process.env.PORT}`));
}

console.log(`✅ ${SHOP_NAME} LITE iniciado.`);
