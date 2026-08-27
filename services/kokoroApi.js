// ============================================================
//  Cliente de API para proveedores mayoristas tipo KOKORO.
//  Cada funcion recibe un "provider" ({ base_url, api_key }) para
//  poder hablar con MAS DE UN proveedor a la vez.
//  Docs del contrato: https://api.shopdigital.app/docs
// ============================================================
require("dotenv").config();
const API_TIMEOUT_MS = Number(process.env.KOKORO_API_TIMEOUT_MS || 6000);

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\u26a0\ufe0f?/g, "").replace(/\/+$/, "");
}

function normalizeProviderType(provider) {
  const raw = String(provider.provider_type || provider.type || "").trim().toLowerCase();
  if (raw === "xpro" || raw === "kokoro") return raw;
  const base = cleanBaseUrl(provider.base_url).toLowerCase();
  return base.includes("/api/partner/v1") || base.includes("paid2.daki.cc") ? "xpro" : "kokoro";
}

// Proveedor "default": el que viene configurado por variables de entorno
// (KOKORO_API_URL / KOKORO_API_KEY). Se usa como fallback y para crear
// automaticamente la primera fila de api_providers.
function defaultProviderFromEnv() {
  return {
    name: "Default (.env)",
    base_url: cleanBaseUrl(process.env.KOKORO_API_URL || "https://api.shopdigital.app"),
    api_key: process.env.KOKORO_API_KEY || "",
    provider_type: "kokoro"
  };
}

function xproProviderFromEnv() {
  return {
    name: "XPro (.env)",
    base_url: cleanBaseUrl(process.env.XPRO_API_URL || "http://paid2.daki.cc:4153/api/partner/v1"),
    api_key: process.env.XPRO_API_KEY || "",
    provider_type: "xpro"
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
  const base = cleanBaseUrl(provider.base_url);
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

function xproError(json, fallback) {
  const err = json && json.error;
  if (!err) return fallback;
  if (typeof err === "string") return err;
  return [err.code, err.message].filter(Boolean).join(": ") || fallback;
}

async function fetchXproProducts(provider) {
  const base = cleanBaseUrl(provider.base_url);
  const all = [];
  const limit = 100;
  let offset = 0;
  try {
    for (let page = 0; page < 20; page++) {
      const url = new URL(`${base}/catalog/products`);
      url.searchParams.set("inStock", "true");
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      const res = await fetch(url, fetchOptions({ headers: authHeaders(provider) }));
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        const error = xproError(json, `HTTP ${res.status}`);
        console.error(`[API ${provider.name || base}] xpro products error:`, res.status, error);
        return { success: false, products: [], error };
      }
      const products = Array.isArray(json.products) ? json.products : [];
      all.push(...products.map(p => ({
        id: String(p.id),
        name: p.name,
        price: Number(p.price || 0),
        stock: Number(p.stock || 0),
        min_order: 1,
        description_es: p.description || null,
        description_en: p.description || null,
        bulk_discounts: []
      })));
      offset += products.length;
      if (products.length < limit || (Number(json.total || 0) && offset >= Number(json.total))) break;
    }
    return { success: true, products: all };
  } catch (err) {
    console.error(`[API ${provider.name || base}] xpro products exception:`, err.message);
    return { success: false, products: [], error: err.message };
  }
}

// GET /api/balance -> saldo prepago del revendedor con este proveedor
async function fetchKokoroBalance(provider) {
  const base = cleanBaseUrl(provider.base_url);
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

async function fetchXproBalance(provider) {
  const base = cleanBaseUrl(provider.base_url);
  try {
    const res = await fetch(`${base}/balance`, fetchOptions({ headers: authHeaders(provider) }));
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      return { success: false, balance: 0, error: xproError(json, `HTTP ${res.status}`) };
    }
    return { success: true, balance: Number(json.balance || json.walletBalance || json.amount || 0) };
  } catch (err) {
    return { success: false, balance: 0, error: err.message };
  }
}

// POST /api/purchase -> compra + entrega. Devuelve las credenciales entregadas.
// externalOrderId da idempotencia: si se reintenta con el mismo id, no cobra doble.
async function purchaseKokoro(provider, productId, quantity, externalOrderId) {
  const base = cleanBaseUrl(provider.base_url);
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

async function purchaseXpro(provider, productId, quantity, externalOrderId) {
  const base = cleanBaseUrl(provider.base_url);
  try {
    const res = await fetch(`${base}/orders`, fetchOptions({
      method: "POST",
      headers: authHeaders(provider),
      body: JSON.stringify({
        productId: Number(productId),
        quantity: Number(quantity) || 1,
        externalOrderId: String(externalOrderId || "")
      })
    }));
    const json = await res.json().catch(() => ({}));

    if (res.ok && json.ok) {
      const lines = json.delivery && Array.isArray(json.delivery.lines) ? json.delivery.lines : [];
      return {
        success: true,
        credentials: lines.join("\n"),
        orderId: json.order && json.order.orderId,
        total: json.order ? Number(json.order.total || 0) : 0,
        remainingBalance: Number(json.balanceAfter || 0)
      };
    }

    const error = xproError(json, `HTTP ${res.status}`);
    if (res.status === 402 || /INSUFFICIENT_BALANCE/i.test(error)) {
      return { success: false, insufficientProviderBalance: true, error };
    }
    if (res.status === 409 || /OUT_OF_STOCK/i.test(error)) {
      return { success: false, outOfStock: true, error };
    }
    return { success: false, error };
  } catch (err) {
    console.error(`[API ${provider.name || base}] xpro purchase exception:`, err.message);
    return { success: false, error: err.message };
  }
}

async function fetchProviderProducts(provider) {
  return normalizeProviderType(provider) === "xpro" ? fetchXproProducts(provider) : fetchKokoroProducts(provider);
}

async function fetchProviderBalance(provider) {
  return normalizeProviderType(provider) === "xpro" ? fetchXproBalance(provider) : fetchKokoroBalance(provider);
}

async function purchaseProvider(provider, productId, quantity, externalOrderId) {
  return normalizeProviderType(provider) === "xpro"
    ? purchaseXpro(provider, productId, quantity, externalOrderId)
    : purchaseKokoro(provider, productId, quantity, externalOrderId);
}

module.exports = {
  defaultProviderFromEnv,
  xproProviderFromEnv,
  normalizeProviderType,
  fetchKokoroProducts,
  fetchKokoroBalance,
  purchaseKokoro,
  fetchProviderProducts,
  fetchProviderBalance,
  purchaseProvider
};
