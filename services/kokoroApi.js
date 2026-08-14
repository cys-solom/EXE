// ============================================================
//  Cliente de la API KOKORO (proveedor mayorista)
//  El bot Lite consume estos endpoints con la API Key del revendedor.
//  Docs: https://api.shopdigital.app/docs
// ============================================================
require("dotenv").config();

const API_URL = (process.env.KOKORO_API_URL || "https://api.shopdigital.app").replace(/\/+$/, "");
const API_KEY = process.env.KOKORO_API_KEY || "";

function authHeaders() {
  return {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json"
  };
}

// GET /api/products -> catalogo mayorista (precio, stock, min_order)
async function fetchKokoroProducts() {
  try {
    const res = await fetch(`${API_URL}/api/products`, { headers: authHeaders() });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      console.error("[KOKORO API] products error:", res.status, json.error || "");
      return { success: false, products: [], error: json.error || `HTTP ${res.status}` };
    }
    return { success: true, products: json.products || [] };
  } catch (err) {
    console.error("[KOKORO API] products exception:", err.message);
    return { success: false, products: [], error: err.message };
  }
}

// GET /api/balance -> saldo prepago del revendedor con KOKORO
async function fetchKokoroBalance() {
  try {
    const res = await fetch(`${API_URL}/api/balance`, { headers: authHeaders() });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      return { success: false, balance: 0, error: json.error || `HTTP ${res.status}` };
    }
    return { success: true, balance: Number(json.balance || 0) };
  } catch (err) {
    return { success: false, balance: 0, error: err.message };
  }
}

// POST /api/purchase -> compra + entrega. Devuelve las credenciales entregadas.
// externalOrderId da idempotencia: si se reintenta con el mismo id, no cobra doble.
async function purchaseKokoro(productId, quantity, externalOrderId) {
  try {
    const res = await fetch(`${API_URL}/api/purchase`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        product_id: String(productId),
        quantity: Number(quantity) || 1,
        external_order_id: String(externalOrderId || "")
      })
    });
    const json = await res.json().catch(() => ({}));

    if (res.ok && json.success) {
      return {
        success: true,
        credentials: String(json.credentials || ""),
        orderId: json.order_id,
        total: Number(json.total || 0),
        remainingBalance: Number(json.remaining_balance || 0)
      };
    }

    // 202 = pago recibido pero entrega pendiente (revision manual del lado KOKORO)
    if (res.status === 202) {
      return { success: false, pending: true, orderId: json.order_id, message: json.message || "Pending fulfillment" };
    }

    // 402 = saldo insuficiente del revendedor con KOKORO
    if (res.status === 402) {
      return { success: false, insufficientProviderBalance: true, error: json.error || "Insufficient provider balance" };
    }

    return { success: false, error: json.error || `HTTP ${res.status}` };
  } catch (err) {
    console.error("[KOKORO API] purchase exception:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  API_URL,
  fetchKokoroProducts,
  fetchKokoroBalance,
  purchaseKokoro
};
