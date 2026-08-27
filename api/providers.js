// CRUD de proveedores de API (mayoristas tipo KOKORO). Permite tener mas de uno activo.
const { requireAuth } = require("./_lib/auth.js");
const { getSupabase } = require("./_lib/supabase.js");
const { logActivity } = require("./_lib/activity.js");
const { fetchProviderBalance } = require("../services/kokoroApi.js");
const BALANCE_TIMEOUT_MS = Number(process.env.ADMIN_BALANCE_TIMEOUT_MS || 1500);

function maskKey(key) {
  const s = String(key || "");
  if (s.length <= 8) return "****";
  return s.slice(0, 4) + "…" + s.slice(-4);
}

function withTimeout(promise, ms, fallback) {
  let timer = null;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); })
  ]);
}

function normalizeProviderType(input, baseUrl) {
  const raw = String(input || "").trim().toLowerCase();
  if (raw === "xpro" || raw === "kokoro") return raw;
  const url = String(baseUrl || "").toLowerCase();
  return url.includes("/api/partner/v1") || url.includes("paid2.daki.cc") ? "xpro" : "kokoro";
}

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\u26a0\ufe0f?/g, "").replace(/\/+$/, "");
}

module.exports = requireAuth(async (req, res) => {
  const supabase = getSupabase();

  if (req.method === "GET") {
    const { data, error } = await supabase.from("api_providers").select("*").order("created_at");
    if (error) return res.status(500).json({ error: error.message });

    const withBalance = await Promise.all((data || []).map(async p => {
      let balance = null, balanceError = null;
      if (p.active) {
        const bal = await withTimeout(fetchProviderBalance(p), BALANCE_TIMEOUT_MS, { success: false, balance: 0, error: "balance timeout" });
        if (bal.success) balance = bal.balance; else balanceError = bal.error;
      }
      return { id: p.id, name: p.name, provider_type: p.provider_type || "kokoro", base_url: p.base_url, api_key_masked: maskKey(p.api_key), active: p.active, is_default: p.is_default, created_at: p.created_at, balance, balanceError };
    }));
    return res.status(200).json({ providers: withBalance });
  }

  if (req.method === "POST") {
    const { name, base_url, api_key, provider_type } = req.body || {};
    if (!name || !base_url || !api_key) return res.status(400).json({ error: "name, base_url y api_key مطلوبين" });
    const { data, error } = await supabase.from("api_providers").insert({
      name: String(name).trim(),
      provider_type: normalizeProviderType(provider_type, base_url),
      base_url: cleanBaseUrl(base_url),
      api_key: String(api_key).trim(),
      active: true
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    logActivity(supabase, "provider_add", `إضافة مزوّد جديد: ${data.name}`, { id: data.id });
    return res.status(200).json({ ok: true, id: data.id });
  }

  if (req.method === "PATCH") {
    const { id, name, base_url, api_key, active, provider_type } = req.body || {};
    if (!id) return res.status(400).json({ error: "id مطلوب" });
    const patch = {};
    if (name !== undefined) patch.name = String(name).trim();
    if (base_url !== undefined) patch.base_url = cleanBaseUrl(base_url);
    if (api_key !== undefined && String(api_key).trim()) patch.api_key = String(api_key).trim();
    if (provider_type !== undefined || base_url !== undefined) patch.provider_type = normalizeProviderType(provider_type, patch.base_url || base_url);
    if (active !== undefined) patch.active = !!active;
    if (!Object.keys(patch).length) return res.status(400).json({ error: "nada que actualizar" });
    const { error } = await supabase.from("api_providers").update(patch).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    logActivity(supabase, "provider_update", `تعديل مزوّد #${id}`, { id, patch: { ...patch, api_key: patch.api_key ? "***" : undefined } });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const id = req.query.id || (req.body || {}).id;
    if (!id) return res.status(400).json({ error: "id مطلوب" });
    const { data: provider } = await supabase.from("api_providers").select("name, is_default").eq("id", id).maybeSingle();
    if (provider && provider.is_default) return res.status(400).json({ error: "لا يمكن حذف المزوّد الافتراضي (عطّله بدل ما تحذفه)" });
    const { error } = await supabase.from("api_providers").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    logActivity(supabase, "provider_delete", `حذف مزوّد: ${(provider && provider.name) || id}`, { id });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ error: "method not allowed" });
});
