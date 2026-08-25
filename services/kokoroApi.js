// ============================================================
//  Cliente de API para proveedores mayoristas tipo KOKORO.
//  Cada funcion recibe un "provider" ({ base_url, api_key }) para
//  poder hablar con MAS DE UN proveedor a la vez.
//  Docs del contrato: https://api.shopdigital.app/docs
// ============================================================
require("dotenv").config();
const API_TIMEOUT_MS = Number(process.env.KOKORO_API_TIMEOUT_MS || 15000);

// Proveedor "default": el que viene configurado por variables de entorno
// (KOKORO_API_URL / KOKORO_API_KEY). Se usa como fallback y para crear
// automaticamente la primera fila de api_providers.
function defaultProviderFromEnv() {
  return {
    name: "Default (.env)",
    base_url: (process.env.KOKORO_API_URL || "https://api.shopdigital.app").replace(/\/+$/, ""),
    api_key: process.env.KOKORO_API_KEY || ""
  };
}

function authHeaders(provider) {
  return {
    "Authorization": `Bearer ${provider.api_key}`,
    "Content-Type": "application/json"
  };
}

function fetchOptions(options = {}) {
  return {
    ...options,
    signal: AbortSignal.timeout(API_TIMEOUT_MS)
  };
}

// GET /api/products -> catalogo mayorista (precio, stock, min_order)
async function fetchKokoroProducts(provider) {
  const base = String(provider.base_url || "").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/products`, fetchOptions({ headers: authHeaders(provider) }));
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      console.error(`[API ${provider.name || base}] products error:`, res.status, json.error || "");
      return { success: false, products: [], error: json.error || `HTTP ${res.status}` };
    }
    return { success: true, products: json.products || [] };
  } catch (err) {
    console.error(`[API ${provider.name || base}] products exception:`, err.message);
    return { success: false, products: [], error: err.message };
  }
}

// GET /api/balance -> saldo prepago del revendedor con este proveedor
async function fetchKokoroBalance(provider) {
  const base = String(provider.base_url || "").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/balance`, fetchOptions({ headers: authHeaders(provider) }));
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
async function purchaseKokoro(provider, productId, quantity, externalOrderId) {
  const base = String(provider.base_url || "").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/purchase`, fetchOptions({
      method: "POST",
      headers: authHeaders(provider),
      body: JSON.stringify({
        product_id: String(productId),
        quantity: Number(quantity) || 1,
        external_order_id: String(externalOrderId || "")
      })
    }));
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

    // 202 = pago recibido pero entrega pendiente (revision manual del lado del proveedor)
    if (res.status === 202) {
      return { success: false, pending: true, orderId: json.order_id, message: json.message || "Pending fulfillment" };
    }

    // 402 = saldo insuficiente del revendedor con el proveedor
    if (res.status === 402) {
      return { success: false, insufficientProviderBalance: true, error: json.error || "Insufficient provider balance" };
    }

    return { success: false, error: json.error || `HTTP ${res.status}` };
  } catch (err) {
    console.error(`[API ${provider.name || base}] purchase exception:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  defaultProviderFromEnv,
  fetchKokoroProducts,
  fetchKokoroBalance,
  purchaseKokoro
};
