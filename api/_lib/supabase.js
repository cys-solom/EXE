require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

let client = null;
const SUPABASE_TIMEOUT_MS = Number(process.env.ADMIN_SUPABASE_TIMEOUT_MS || 8000);

function env(name) {
  return String(process.env[name] || "").trim();
}

function getSupabaseConfig() {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_KEY") || env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_ANON_KEY") || env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { url, key };
}

function getSupabaseStatus() {
  const { url, key } = getSupabaseConfig();
  let host = "";
  try { host = url ? new URL(url).host : ""; } catch (e) {}
  return {
    configured: !!(url && key),
    hasUrl: !!url,
    hasKey: !!key,
    host,
    timeoutMs: SUPABASE_TIMEOUT_MS
  };
}

async function supabaseFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    const msg = err && err.name === "AbortError"
      ? `Supabase timeout after ${SUPABASE_TIMEOUT_MS}ms`
      : `Supabase connection failed: ${err.message || err}`;
    const e = new Error(msg);
    e.code = "SUPABASE_FETCH_FAILED";
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function getSupabase() {
  if (!client) {
    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
      throw new Error("Supabase env missing. Set SUPABASE_URL and SUPABASE_KEY or SUPABASE_SERVICE_ROLE_KEY.");
    }
    client = createClient(url, key, {
      global: { fetch: supabaseFetch },
      auth: { persistSession: false }
    });
  }
  return client;
}

module.exports = { getSupabase, getSupabaseStatus };
