// ============================================================
//  Pagos: Binance Pay (Order ID) + BEP20 (monto unico via Binance).
//  Portado del bot KOKORO. Proveedor BEP20 = Binance (deposit history).
//
//  El bot inyecta los callbacks de acreditacion:
//    onTopup(telegram_id, amount, txid)   -> acreditar recarga
//    onPurchase(order_id, telegram_id, txid) -> confirmar compra
// ============================================================
require("dotenv").config();
const crypto = require("crypto");

const BINANCE_BASE_URL = "https://api.binance.com";

// ---------- Firma Binance ----------
function signBinance(query) {
  return crypto
    .createHmac("sha256", process.env.BINANCE_SECRET_KEY)
    .update(query)
    .digest("hex");
}

async function signedBinanceGet(path, params = {}) {
  const query = new URLSearchParams({
    ...params,
    timestamp: Date.now().toString(),
    recvWindow: 60000
  }).toString();
  const signature = signBinance(query);
  const url = `${BINANCE_BASE_URL}${path}?${query}&signature=${signature}`;
  const res = await fetch(url, { headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY } });
  return await res.json();
}

// ---------- Utilidades de tiempo/monto ----------
function getBinanceTxTime(tx) {
  const rawTime = tx?.createTime ?? tx?.transactionTime ?? tx?.createdTime ?? tx?.time ?? null;
  if (rawTime == null) return null;
  if (typeof rawTime === "number") return rawTime < 1e12 ? rawTime * 1000 : rawTime;
  const parsed = Date.parse(rawTime);
  return Number.isFinite(parsed) ? parsed : null;
}

// Monto unico: base + 3 decimales aleatorios (identificador anti-fraude)
function generateUniqueAmount(base) {
  const cents = Math.floor(Math.random() * 900 + 100); // 100..999 -> .001..0.009 approx
  const unique = parseFloat(base) + (cents / 100000);
  return parseFloat(unique.toFixed(4));
}

// Coincidencia de monto tolerante al fee de red
function bep20AmountMatches(received, expected) {
  const r = parseFloat(received);
  const e = parseFloat(expected);
  if (!isFinite(r) || !isFinite(e)) return false;
  if (e <= 0) return true;
  const fee = parseFloat(process.env.BEP20_FEE || "0.01");
  const eps = parseFloat(process.env.BEP20_AMOUNT_EPSILON || "0.0001");
  return Math.abs(r - e) <= eps || Math.abs(r - (e - fee)) <= eps;
}

// ---------- Binance Pay: verificar por Order ID ----------
async function verifyBinancePayOrder(binanceOrderId) {
  const payHistory = await signedBinanceGet("/sapi/v1/pay/transactions", { limit: 100 });
  const rows = Array.isArray(payHistory) ? payHistory : (payHistory.data || payHistory.rows || []);
  const targetId = String(binanceOrderId || "").trim().replace(/^#/, "");
  const ignoreWindow = String(process.env.BINANCE_IGNORE_WINDOW || "") === "1";

  const matchesTarget = tx => {
    const candidates = [tx?.orderId, tx?.merchantTradeNo, tx?.transactionId, tx?.billOrderId, tx?.billOrderNo]
      .map(v => String(v || "").trim().replace(/^#/, "")).filter(Boolean);
    return candidates.includes(targetId);
  };

  const match = rows.find(tx => {
    if (!matchesTarget(tx)) return false;
    const txTime = getBinanceTxTime(tx);
    if (txTime == null) return false;
    const ageMs = Date.now() - txTime;
    const thirtyMin = 30 * 60 * 1000;
    return ignoreWindow || (ageMs >= 0 && ageMs <= thirtyMin);
  });

  if (!match) {
    return { success: false, message: "Binance Order ID no encontrado en los ultimos 30 minutos." };
  }
  return {
    success: true,
    orderId: String(match.orderId),
    transactionId: String(match.transactionId || ""),
    amount: Number(match.amount || 0),
    currency: match.currency || "USDT",
    receiverBinanceId: String(match.receiverInfo?.binanceId || "")
  };
}

// ---------- BEP20: depositos recientes via Binance ----------
async function getRecentBEP20Deposits() {
  try {
    const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
    const deposits = await signedBinanceGet("/sapi/v1/capital/deposit/hisrec", {
      startTime: twoHoursAgo, limit: 100, offset: 0
    });
    if (!Array.isArray(deposits)) return [];
    return deposits.map(d => ({
      txid: String(d.txId || "").toLowerCase(),
      amount: parseFloat(d.amount),
      confirmed: d.status === 1 && d.network && String(d.network).toLowerCase().includes("bsc")
    })).filter(d => d.txid && isFinite(d.amount));
  } catch (err) {
    console.error("[BEP20] getRecentBEP20Deposits error:", err.message);
    return [];
  }
}

// ---------- Crear un pendiente BEP20 (recarga o compra) ----------
async function createBep20Pending(supabase, { telegram_id, type = "topup", order_id = null, base }) {
  const montoUnico = generateUniqueAmount(base);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min
  const { data, error } = await supabase.from("bep20_pending").insert({
    telegram_id, type, order_id,
    monto_base: parseFloat(base),
    monto_unico: montoUnico,
    status: "pending",
    expires_at: expiresAt
  }).select().single();
  if (error) throw error;
  return { pending: data, montoUnico };
}

// ---------- Poller BEP20 en segundo plano ----------
let pollerRunning = false;
async function bep20PollerTick(supabase, { onTopup, onPurchase }) {
  if (pollerRunning) return;
  pollerRunning = true;
  try {
    // Expirar vencidos
    await supabase.from("bep20_pending").update({ status: "expired" })
      .eq("status", "pending").lt("expires_at", new Date().toISOString()).then(() => {}).catch(() => {});

    // Pendientes activos
    const { data: pendings } = await supabase.from("bep20_pending")
      .select("*").eq("status", "pending").gt("expires_at", new Date().toISOString());
    if (!pendings || pendings.length === 0) return;

    const deposits = await getRecentBEP20Deposits();
    if (!deposits.length) return;

    const eps = parseFloat(process.env.BEP20_AMOUNT_EPSILON || "0.0001");

    for (const dep of deposits) {
      if (!dep.confirmed) continue;

      // ¿TXID ya usado?
      const { data: used } = await supabase.from("binance_payments")
        .select("transaction_id").eq("transaction_id", dep.txid).maybeSingle();
      if (used) continue;

      // Buscar pendiente que coincida (exacto, luego con fee)
      let match = pendings.find(p => p._taken !== true && Math.abs(parseFloat(p.monto_unico) - dep.amount) <= eps);
      if (!match) match = pendings.find(p => p._taken !== true && bep20AmountMatches(dep.amount, p.monto_unico));
      if (!match) continue;

      match._taken = true;
      try {
        if (match.type === "topup") {
          await onTopup(match.telegram_id, parseFloat(match.monto_base || match.monto_unico), dep.txid);
        } else {
          await onPurchase(match.order_id, match.telegram_id, dep.txid);
        }
        await supabase.from("bep20_pending").update({ status: "completed" }).eq("id", match.id);
      } catch (err) {
        console.error(`[BEP20] error procesando pendiente ${match.id}:`, err.message);
        match._taken = false;
      }
    }
  } catch (err) {
    console.error("[BEP20] poller error:", err.message);
  } finally {
    pollerRunning = false;
  }
}

function startBep20Poller(supabase, callbacks, intervalSec = 20) {
  setInterval(() => bep20PollerTick(supabase, callbacks), intervalSec * 1000);
  console.log(`[BEP20] Poller activo cada ${intervalSec}s.`);
}

// Marcar un TXID como usado (dedup)
async function markTxidUsed(supabase, { telegram_id, txid, amount, type }) {
  return supabase.from("binance_payments").insert({
    telegram_id, transaction_id: String(txid).toLowerCase(), amount, type
  });
}

module.exports = {
  signedBinanceGet,
  verifyBinancePayOrder,
  getRecentBEP20Deposits,
  bep20AmountMatches,
  generateUniqueAmount,
  createBep20Pending,
  startBep20Poller,
  markTxidUsed
};
