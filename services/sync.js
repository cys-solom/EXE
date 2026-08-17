// ============================================================
//  Sincronizacion de productos con TODOS los proveedores de API activos.
//  Corre cada SYNC_INTERVAL_MINUTES (default 5).
//  Preserva SIEMPRE el markup, el toggle (enabled), el emoji, el nombre
//  propio y el tipo de markup del revendedor para cada producto.
// ============================================================
require("dotenv").config();
const { fetchKokoroProducts, defaultProviderFromEnv } = require("./kokoroApi.js");

const SYNC_MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES || 5);

// Devuelve los proveedores activos. Si no hay ninguno en la tabla todavia,
// crea automaticamente el proveedor "default" con los valores del .env
// (asi el bot sigue funcionando igual que antes sin configuracion extra).
async function getActiveProviders(supabase) {
  const { data: existing } = await supabase.from("api_providers").select("*").eq("active", true);
  if (existing && existing.length) return existing;

  const { data: anyRow } = await supabase.from("api_providers").select("id").limit(1);
  if (anyRow && anyRow.length) return []; // hay proveedores pero ninguno activo: respeta esa decision

  const def = defaultProviderFromEnv();
  if (!def.api_key) return []; // sin .env y sin proveedores configurados: nada que sincronizar

  const { data: created, error } = await supabase.from("api_providers").insert({
    name: def.name, base_url: def.base_url, api_key: def.api_key, active: true, is_default: true
  }).select().single();
  if (error) {
    // Otro proceso ya lo creo en paralelo (choque con el indice unico de is_default): releer.
    const { data: race } = await supabase.from("api_providers").select("*").eq("active", true);
    if (race && race.length) return race;
    console.error("[SYNC] No se pudo crear el proveedor default:", error.message);
    return [];
  }
  return [created];
}

async function syncProductsOnce(supabase) {
  const providers = await getActiveProviders(supabase);
  if (!providers.length) {
    console.error("[SYNC] No hay proveedores de API activos configurados.");
    return { success: false, error: "no active providers" };
  }

  const allApiIds = [];
  let totalFetched = 0, totalUpdated = 0;

  for (const provider of providers) {
    const { success, products, error } = await fetchKokoroProducts(provider);
    if (!success) {
      console.error(`[SYNC] No se pudieron traer productos de "${provider.name}": ${error}`);
      continue;
    }
    totalFetched += products.length;

    for (const p of products) {
      const nativeId = String(p.id);
      // El proveedor default conserva IDs sin prefijo (compatibilidad con datos existentes);
      // los demas proveedores se prefijan para evitar choques de ID entre proveedores distintos.
      const id = provider.is_default ? nativeId : `p${provider.id}_${nativeId}`;
      allApiIds.push(id);

      // Leer lo que ya existe para preservar las configuraciones del revendedor
      const { data: existing } = await supabase
        .from("products")
        .select("markup, markup_type, enabled, emoji, custom_name")
        .eq("id", id)
        .maybeSingle();

      const row = {
        id,
        provider_id: provider.id,
        native_id: nativeId,
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
        // Producto ya existente: NO tocar markup, tipo de markup, enabled, emoji ni nombre propio
        row.markup = existing.markup;
        row.markup_type = existing.markup_type || "percent";
        row.enabled = existing.enabled;
        row.emoji = existing.emoji;
        row.custom_name = existing.custom_name;
      } else {
        // Producto nuevo: valores por defecto
        row.markup = 30;
        row.markup_type = "percent";
        row.enabled = true;
        row.emoji = null;
        row.custom_name = null;
      }

      const { error: upErr } = await supabase.from("products").upsert(row);
      if (upErr) console.error(`[SYNC] Error guardando ${p.name}:`, upErr.message);
      else totalUpdated++;
    }
  }

  // Poner stock 0 a los productos que ya no vengan en NINGUN proveedor activo
  // (recorre todos los proveedores antes de decidir esto, para no borrar por error
  // el stock de un producto que solo no vino en la pasada de OTRO proveedor).
  if (allApiIds.length > 0) {
    const { data: allLocal } = await supabase.from("products").select("id").not("provider_id", "is", null);
    const toZero = (allLocal || []).map(r => r.id).filter(id => !allApiIds.includes(id));
    for (const id of toZero) {
      await supabase.from("products").update({ stock: 0, updated_at: new Date().toISOString() }).eq("id", id);
    }
  }

  console.log(`[SYNC] Productos sincronizados: ${totalUpdated}/${totalFetched} (${providers.length} proveedor${providers.length > 1 ? "es" : ""})`);
  return { success: true, count: totalUpdated };
}

function startProductSync(supabase) {
  // Sincroniza al arrancar y luego cada SYNC_MINUTES
  syncProductsOnce(supabase).catch(e => console.error("[SYNC] error inicial:", e.message));
  setInterval(() => {
    syncProductsOnce(supabase).catch(e => console.error("[SYNC] error:", e.message));
  }, SYNC_MINUTES * 60 * 1000);
  console.log(`[SYNC] Sincronizacion activa cada ${SYNC_MINUTES} min.`);
}

module.exports = { syncProductsOnce, startProductSync, getActiveProviders };
