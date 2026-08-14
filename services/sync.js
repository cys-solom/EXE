// ============================================================
//  Sincronizacion de productos con la API KOKORO.
//  Corre cada SYNC_INTERVAL_MINUTES (default 5).
//  Preserva SIEMPRE el markup y el toggle (enabled) del revendedor:
//  solo actualiza nombre, precio mayorista, stock y min_order.
// ============================================================
require("dotenv").config();
const { fetchKokoroProducts } = require("./kokoroApi.js");

const SYNC_MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES || 5);

async function syncProductsOnce(supabase) {
  const { success, products, error } = await fetchKokoroProducts();
  if (!success) {
    console.error(`[SYNC] No se pudieron traer productos de KOKORO: ${error}`);
    return { success: false, error };
  }

  const apiIds = [];
  let updated = 0;

  for (const p of products) {
    const id = String(p.id);
    apiIds.push(id);

    // Leer lo que ya existe para preservar markup y enabled del revendedor
    const { data: existing } = await supabase
      .from("products")
      .select("markup, enabled, emoji")
      .eq("id", id)
      .maybeSingle();

    const row = {
      id,
      name: p.name,
      price: Number(p.price || 0),          // precio MAYORISTA
      stock: Number(p.stock || 0),
      min_order: Number(p.min_order || 1),
      description_es: p.description_es || null,
      description_en: p.description_en || null,
      bulk_discounts: Array.isArray(p.bulk_discounts) ? p.bulk_discounts : [],
      updated_at: new Date().toISOString()
    };

    if (existing) {
      // Producto ya existente: NO tocar markup ni enabled ni emoji
      row.markup = existing.markup;
      row.enabled = existing.enabled;
      row.emoji = existing.emoji;
    } else {
      // Producto nuevo: valores por defecto
      row.markup = 30;
      row.enabled = true;
      row.emoji = null;
    }

    const { error: upErr } = await supabase.from("products").upsert(row);
    if (upErr) {
      console.error(`[SYNC] Error guardando ${p.name}:`, upErr.message);
    } else {
      updated++;
    }
  }

  // Poner stock 0 a los productos que ya no vengan en la API (para que no se vendan)
  if (apiIds.length > 0) {
    const { data: allLocal } = await supabase.from("products").select("id");
    const toZero = (allLocal || []).map(r => r.id).filter(id => !apiIds.includes(id));
    for (const id of toZero) {
      await supabase.from("products").update({ stock: 0, updated_at: new Date().toISOString() }).eq("id", id);
    }
  }

  console.log(`[SYNC] Productos sincronizados: ${updated}/${products.length}`);
  return { success: true, count: updated };
}

function startProductSync(supabase) {
  // Sincroniza al arrancar y luego cada SYNC_MINUTES
  syncProductsOnce(supabase).catch(e => console.error("[SYNC] error inicial:", e.message));
  setInterval(() => {
    syncProductsOnce(supabase).catch(e => console.error("[SYNC] error:", e.message));
  }, SYNC_MINUTES * 60 * 1000);
  console.log(`[SYNC] Sincronizacion activa cada ${SYNC_MINUTES} min.`);
}

module.exports = { syncProductsOnce, startProductSync };
